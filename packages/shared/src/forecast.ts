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
  /** Variance of the observed restock intervals (min²) — measured timing jitter. */
  restockIntervalVar: number;
  /** Number of restock intervals observed (restock events − 1). */
  restockCycles: number;
  lastRestockTs: number | null;
  sampleCount: number;
  spanMinutes: number;
  /** Highest stock level ever observed — a physical ceiling for predictions. */
  maxObservedQty: number;
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
    // variance() needs ≥2 samples; returns 0 otherwise (also 0 for perfectly
    // regular restocks — restockCycles disambiguates the two at predict time).
    restockIntervalVar: variance(intervals),
    restockCycles: intervals.length,
    lastRestockTs,
    sampleCount: pts.length,
    spanMinutes,
    maxObservedQty: pts.length ? Math.max(...pts.map((p) => p.quantity)) : 0,
    confidence,
  };
}

/**
 * Restock-timing jitter (std, minutes): how much a restock's arrival drifts off
 * its median schedule. Uses the MEASURED variance of observed restock intervals,
 * shrunk toward a heuristic prior (20% of the interval) by a pseudo-count so a
 * couple of noisy cycles can't dominate. Falls back to the pure heuristic until
 * at least two intervals (≥3 restocks) have been seen.
 */
function restockJitterMin(m: ForecastModel, interval: number): number {
  const heurStd = Math.max(2, 0.2 * interval);
  if (m.restockCycles < 2) return heurStd;
  // Blend variances with a pseudo-count of K0 heuristic "cycles"; measured wins
  // as real cycles accrue. A genuinely regular item (var≈0) shrinks toward 0.
  const K0 = 4;
  const blendedVar = (m.restockCycles * m.restockIntervalVar + K0 * heurStd * heurStd) / (m.restockCycles + K0);
  return Math.max(1, Math.sqrt(blendedVar));
}

/**
 * Expected restock units arriving within `horizonMin`, AND the variance from
 * restock-TIMING uncertainty. `restockIntervalMin` is a median, so a restock
 * scheduled near arrival may not have landed yet — we weight each scheduled
 * restock by P(it has occurred by arrival) and add its Bernoulli variance, so
 * odds that hinge on a just-in-time restock aren't reported as near-certain.
 *
 * `nowSec` enables phase alignment to the observed restock clock (via
 * `lastRestockTs`); pass null for the legacy phase-blind count (back-compat).
 */
function restockStats(
  m: ForecastModel,
  horizonMin: number,
  nowSec: number | null,
): { units: number; variance: number } {
  const interval = m.restockIntervalMin;
  const amount = m.restockAmount;
  if (!interval || interval <= 0 || amount == null || horizonMin <= 0) return { units: 0, variance: 0 };

  // No phase reference → deterministic "every interval" count, no timing variance.
  if (nowSec == null || m.lastRestockTs == null) {
    return { units: Math.floor(horizonMin / interval) * amount, variance: 0 };
  }

  const jitterMin = restockJitterMin(m, interval);
  const intervalSec = interval * 60;
  const arrivalSec = nowSec + horizonMin * 60;
  let units = 0;
  let variance = 0;
  // Walk scheduled restocks from the first after now; a restock scheduled up to
  // ~4σ past arrival could still have landed early, so don't stop right at it.
  let k = Math.floor((nowSec - m.lastRestockTs) / intervalSec) + 1;
  for (let guard = 0; guard < 100000; guard++) {
    const tSec = m.lastRestockTs + k * intervalSec;
    const marginMin = (arrivalSec - tSec) / 60; // +ve: scheduled before arrival
    if (marginMin < -4 * jitterMin) break;
    const p = clamp01(normalCdf(marginMin / jitterMin));
    units += amount * p;
    variance += amount * amount * p * (1 - p);
    k++;
  }
  return { units, variance };
}

/** Shared prediction core: stock + P(stock ≥ needed) at `horizonMin` ahead. */
function predictCore(
  m: ForecastModel,
  currentQty: number,
  horizonMin: number,
  neededUnits: number,
  nowSec: number | null,
): { predictedQty: number; pSuccess: number; expDepletion: number; expRestock: number } {
  const expDepletion = m.depletionRatePerMin * horizonMin;
  const { units: expRestock, variance: restockVar } = restockStats(m, horizonMin, nowSec);
  // Stock can't exceed the highest level ever observed (nor drop below 0). This
  // caps the unbounded accumulation that long horizons would otherwise produce.
  const ceiling = m.maxObservedQty > 0 ? Math.max(m.maxObservedQty, currentQty) : Number.POSITIVE_INFINITY;
  const predictedQty = Math.min(ceiling, Math.max(0, currentQty - expDepletion + expRestock));
  const sigma = Math.sqrt(Math.max(expDepletion, m.rateVar * horizonMin, 1) + restockVar);
  const pSuccess = clamp01(normalCdf((predictedQty - neededUnits) / sigma));
  return { predictedQty: Math.round(predictedQty), pSuccess, expDepletion, expRestock };
}

/**
 * Predict stock at arrival and the probability of getting `neededUnits`.
 * `oneWayMin` is the flight time to the destination. Cold-start safe.
 * Pass `nowSec` to phase-align restocks to the observed clock (recommended);
 * omit it for the legacy phase-blind estimate.
 */
export function predictArrival(
  m: ForecastModel | null,
  currentQty: number,
  oneWayMin: number,
  neededUnits: number,
  nowSec?: number,
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
  const { predictedQty, pSuccess, expDepletion, expRestock } = predictCore(
    m,
    currentQty,
    oneWayMin,
    neededUnits,
    nowSec ?? null,
  );
  const trend: ArrivalPrediction["trend"] =
    expRestock > expDepletion ? "rising" : expDepletion > currentQty * 0.25 ? "falling" : "stable";
  return { predictedQty, pSuccess, confidence: m.confidence, trend };
}

// ===========================================================================
// Timing window — how arrival odds change with WHEN you depart.
//
// predictArrival answers "if I leave now". But the odds swing over the restock
// cycle: stock is highest just after a restock and bleeds down until the next.
// forecastDepartureWindow sweeps departure times so the co-pilot can say "wait
// ~12 min for the next restock and your odds jump from 49% to 86%", PHASE-ALIGNED
// to the observed restock clock so a recommended departure maps to a real moment.
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
  /** Restock cadence (minutes) — lets callers project restocks beyond the next. */
  restockIntervalMin: number | null;
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
    if (!m || m.confidence <= 0 || m.sampleCount < 3) {
      return { departInMin: Math.round(departInMin), predictedQty: currentQty, pSuccess: currentQty >= neededUnits ? 0.55 : 0.25 };
    }
    const { predictedQty, pSuccess } = predictCore(m, currentQty, departInMin + oneWayMin, neededUnits, nowSec);
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
    restockIntervalMin: m?.restockIntervalMin ?? null,
    samples,
    confidence: m?.confidence ?? 0.1,
  };
}
