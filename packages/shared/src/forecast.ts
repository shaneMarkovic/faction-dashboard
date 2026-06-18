/**
 * Foreign-stock forecasting model (pure functions, no I/O).
 *
 * Used by the collector (to compute & persist per-item params), the web (to
 * serve arrival predictions), and the backtest harness (to score accuracy) —
 * one implementation, three callers.
 *
 * Design: we observe stock levels at intervals; demand between observations is
 * latent and confounded by restocks. We separate restock jumps (stock up) from
 * depletion runs (stock down), estimate a depletion rate + its variance, and
 * infer the restock cadence/amount. Predictions are PROBABILISTIC — a normal
 * approximation gives P(stock ≥ needed) at arrival. Tiers degrade gracefully:
 * with little/no history we return a low-confidence "assume stable" prior.
 */

/** A single stock observation. ts is unix seconds (source update time). */
export interface ObsPoint {
  quantity: number;
  ts: number;
}

/** Per-item model parameters, persisted in forecast_params. */
export interface ForecastModel {
  depletionRatePerMin: number;
  /** Variance of per-interval depletion rate (over-dispersion signal). */
  rateVar: number;
  restockIntervalMin: number | null;
  restockAmount: number | null;
  lastRestockTs: number | null;
  sampleCount: number;
  spanMinutes: number;
  /** 0..1 — how much to trust the model vs the cold-start prior. */
  confidence: number;
}

export interface ArrivalPrediction {
  /** Expected units in stock when you land. */
  predictedQty: number;
  /** P(stock ≥ neededUnits at arrival), 0..1. */
  pSuccess: number;
  confidence: number;
  trend: "falling" | "stable" | "rising" | "unknown";
}

/** Don't attribute a stock change across a gap longer than this (stale data). */
const MAX_GAP_MIN = 30;

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Abramowitz–Stegun erf approximation → standard normal CDF. */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-(z * z) / 2);
  const p =
    d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

/** Fit model parameters from an item's observation history. */
export function computeForecastParams(obs: ObsPoint[]): ForecastModel {
  const pts = [...obs].sort((a, b) => a.ts - b.ts);
  let totalSold = 0;
  let totalDepMin = 0;
  const rateSamples: number[] = [];
  const restockAmts: number[] = [];
  const restockTimes: number[] = [];
  let lastRestockTs: number | null = null;

  for (let i = 1; i < pts.length; i++) {
    const dtMin = (pts[i]!.ts - pts[i - 1]!.ts) / 60;
    if (dtMin <= 0 || dtMin > MAX_GAP_MIN) continue;
    const delta = pts[i]!.quantity - pts[i - 1]!.quantity;
    if (delta > 0) {
      restockAmts.push(delta);
      restockTimes.push(pts[i]!.ts);
      lastRestockTs = pts[i]!.ts;
    } else if (delta < 0) {
      const sold = -delta;
      totalSold += sold;
      totalDepMin += dtMin;
      rateSamples.push(sold / dtMin);
    }
  }

  const depletionRatePerMin = totalDepMin > 0 ? totalSold / totalDepMin : 0;
  const intervals: number[] = [];
  for (let i = 1; i < restockTimes.length; i++) {
    intervals.push((restockTimes[i]! - restockTimes[i - 1]!) / 60);
  }
  const spanMinutes = pts.length >= 2 ? (pts[pts.length - 1]!.ts - pts[0]!.ts) / 60 : 0;
  // Confidence rises with both sample count and time span; needs ~a day and a
  // few hundred samples to approach 1. Stays low (cold start) until then.
  const confidence = clamp01(Math.min(pts.length / 200, spanMinutes / (60 * 24)));

  return {
    depletionRatePerMin,
    rateVar: variance(rateSamples),
    restockIntervalMin: intervals.length >= 1 ? median(intervals) : null,
    restockAmount: restockAmts.length >= 1 ? median(restockAmts) : null,
    lastRestockTs,
    sampleCount: pts.length,
    spanMinutes,
    confidence,
  };
}

/**
 * Predict stock at arrival and the probability of getting `neededUnits`.
 * `oneWayMin` is the flight time to the destination. Cold-start safe.
 */
export function predictArrival(
  m: ForecastModel | null,
  currentQty: number,
  oneWayMin: number,
  neededUnits: number,
): ArrivalPrediction {
  // Tier 0: too little history → assume roughly stable, low confidence.
  if (!m || m.confidence <= 0 || m.sampleCount < 3) {
    return {
      predictedQty: currentQty,
      pSuccess: currentQty >= neededUnits ? 0.55 : 0.25,
      confidence: 0.1,
      trend: "unknown",
    };
  }

  const expDepletion = m.depletionRatePerMin * oneWayMin;
  const expRestock =
    m.restockIntervalMin && m.restockAmount
      ? Math.floor(oneWayMin / m.restockIntervalMin) * m.restockAmount
      : 0;
  const predictedQty = Math.max(0, currentQty - expDepletion + expRestock);

  // Uncertainty: at least Poisson (var ≥ mean), plus measured over-dispersion.
  const sigma = Math.sqrt(Math.max(expDepletion, m.rateVar * oneWayMin, 1));
  const pSuccess = clamp01(normalCdf((predictedQty - neededUnits) / sigma));

  const trend: ArrivalPrediction["trend"] =
    expRestock > expDepletion ? "rising" : expDepletion > currentQty * 0.25 ? "falling" : "stable";

  return { predictedQty: Math.round(predictedQty), pSuccess, confidence: m.confidence, trend };
}

// ===========================================================================
// Timing window — how arrival odds change with WHEN you depart.
//
// predictArrival answers "if I leave now". But the odds swing over the restock
// cycle: stock is highest just after a restock and bleeds down until the next.
// These helpers sweep departure times so the co-pilot can say "wait ~12 min for
// the next restock and your odds jump from 49% to 86%". Unlike predictArrival
// (which counts restocks naively from t=0), this is PHASE-ALIGNED to the item's
// observed restock clock via lastRestockTs — so a recommended departure maps to
// a real wall-clock moment.
// ===========================================================================

/** Minutes until the next restock from `nowSec`, or null if cadence unknown. */
export function minutesToNextRestock(m: ForecastModel | null, nowSec: number): number | null {
  if (!m || !m.restockIntervalMin || m.restockAmount == null || m.lastRestockTs == null) return null;
  const intervalSec = m.restockIntervalMin * 60;
  if (intervalSec <= 0) return null;
  const intoCycleSec = (((nowSec - m.lastRestockTs) % intervalSec) + intervalSec) % intervalSec;
  const remainingSec = intoCycleSec === 0 ? 0 : intervalSec - intoCycleSec;
  return remainingSec / 60;
}

/** Phase-aligned count of restocks landing in (nowSec, nowSec + horizonMin]. */
function restocksWithin(m: ForecastModel, nowSec: number, horizonMin: number): number {
  if (!m.restockIntervalMin || m.restockAmount == null || horizonMin <= 0) return 0;
  const intervalSec = m.restockIntervalMin * 60;
  if (intervalSec <= 0) return 0;
  const endSec = nowSec + horizonMin * 60;
  if (m.lastRestockTs == null) {
    // No phase reference: fall back to the naive "every interval" count.
    return Math.floor(horizonMin / m.restockIntervalMin) * m.restockAmount;
  }
  // First restock strictly after now, then every interval up to the horizon end.
  const firstK = Math.floor((nowSec - m.lastRestockTs) / intervalSec) + 1;
  const lastK = Math.floor((endSec - m.lastRestockTs) / intervalSec);
  const count = Math.max(0, lastK - firstK + 1);
  return count * m.restockAmount;
}

/** P(stock ≥ needed) when arriving `arriveInMin` from now — phase-aligned. */
function predictAhead(
  m: ForecastModel | null,
  currentQty: number,
  arriveInMin: number,
  neededUnits: number,
  nowSec: number,
): { predictedQty: number; pSuccess: number } {
  if (!m || m.confidence <= 0 || m.sampleCount < 3) {
    return { predictedQty: currentQty, pSuccess: currentQty >= neededUnits ? 0.55 : 0.25 };
  }
  const expDepletion = m.depletionRatePerMin * arriveInMin;
  const expRestock = restocksWithin(m, nowSec, arriveInMin);
  const predictedQty = Math.max(0, currentQty - expDepletion + expRestock);
  const sigma = Math.sqrt(Math.max(expDepletion, m.rateVar * arriveInMin, 1));
  const pSuccess = clamp01(normalCdf((predictedQty - neededUnits) / sigma));
  return { predictedQty: Math.round(predictedQty), pSuccess };
}

/** One sampled "depart in N minutes" point on the odds curve. */
export interface DepartureSample {
  /** Minutes from now to depart. */
  departInMin: number;
  /** Predicted stock when you'd land. */
  predictedQty: number;
  /** P(a full capacity still in stock on arrival), 0..1. */
  pSuccess: number;
}

export interface DepartureWindow {
  /** Leaving right now. */
  now: DepartureSample;
  /** The departure within the horizon with the best odds. */
  best: DepartureSample;
  /** Minutes until the next restock, or null if cadence unknown. */
  nextRestockInMin: number | null;
  /** Sampled odds curve, soonest → latest departure. */
  samples: DepartureSample[];
  /** 0..1 trust in the underlying forecast. */
  confidence: number;
}

/**
 * Sweep departure times over the next few hours and report how arrival odds
 * change. `oneWayMin` is the (reduced) one-way flight time; `neededUnits` is the
 * carrying capacity you want filled.
 */
export function forecastDepartureWindow(
  m: ForecastModel | null,
  currentQty: number,
  oneWayMin: number,
  neededUnits: number,
  nowSec: number,
  opts: { horizonMin?: number; samples?: number } = {},
): DepartureWindow {
  const cycle = m?.restockIntervalMin && m.restockIntervalMin > 0 ? m.restockIntervalMin : 60;
  // Cover ~2.5 restock cycles so at least one post-restock peak is visible.
  const horizonMin = opts.horizonMin ?? Math.min(360, Math.max(120, Math.round(cycle * 2.5)));
  const n = Math.max(2, Math.min(60, opts.samples ?? 24));
  const step = horizonMin / (n - 1);

  const at = (departInMin: number): DepartureSample => {
    const { predictedQty, pSuccess } = predictAhead(m, currentQty, departInMin + oneWayMin, neededUnits, nowSec);
    return { departInMin: Math.round(departInMin), predictedQty, pSuccess };
  };

  const samples: DepartureSample[] = [];
  for (let i = 0; i < n; i++) samples.push(at(i * step));
  const now = samples[0]!;
  // Best odds; on ties prefer the soonest departure (samples are time-ordered).
  let best = now;
  for (const s of samples) if (s.pSuccess > best.pSuccess) best = s;

  return {
    now,
    best,
    nextRestockInMin: minutesToNextRestock(m, nowSec),
    samples,
    confidence: m?.confidence ?? 0.1,
  };
}
