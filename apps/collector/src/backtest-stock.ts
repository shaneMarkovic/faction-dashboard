/**
 * Forecast accuracy backtest — `pnpm --filter @torn/collector backtest:stock`.
 *
 * Replays the observation ledger with POINT-IN-TIME correctness: at each
 * decision moment it fits the model only on data available then, predicts stock
 * a flight-time later, and scores against what actually happened. Reports MAE
 * (point accuracy) and Brier score + a calibration table (probabilistic
 * accuracy — does "70%" actually happen ~70% of the time?).
 *
 * Meaningless until history accrues; ship it so accuracy is measurable the
 * moment there's data, and so model changes can be compared before promotion.
 */

import { computeForecastParams, predictArrival, type ObsPoint } from "@torn/shared";
import { closePool, getPool } from "./db/pool";

const HORIZONS_MIN = [26, 134, 271]; // short / medium / long flights
const NEEDED_UNITS = 19; // a typical full trip
const TOLERANCE_MIN = 5; // how close an actual obs must be to the target time

interface Row { country_code: string; item_id: string; quantity: number; source_update_ts: string }

async function main(): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query<Row>(
    `select country_code, item_id, quantity, source_update_ts
       from stock_observations order by country_code, item_id, source_update_ts`,
  );

  const groups = new Map<string, ObsPoint[]>();
  for (const r of rows) {
    const k = `${r.country_code}:${r.item_id}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push({
      quantity: Number(r.quantity),
      ts: Number(r.source_update_ts),
    });
  }

  let n = 0;
  let absErr = 0;
  let brier = 0;
  const bins = Array.from({ length: 10 }, () => ({ pSum: 0, hits: 0, n: 0 }));

  for (const obs of groups.values()) {
    if (obs.length < 10) continue;
    obs.sort((a, b) => a.ts - b.ts);
    for (let i = 5; i < obs.length; i++) {
      const decision = obs[i]!;
      const history = obs.slice(0, i + 1); // point-in-time: only past+present
      const model = computeForecastParams(history);
      for (const T of HORIZONS_MIN) {
        const targetTs = decision.ts + T * 60;
        const actual = obs.find((o) => Math.abs(o.ts - targetTs) <= TOLERANCE_MIN * 60);
        if (!actual) continue;
        const pred = predictArrival(model, decision.quantity, T, NEEDED_UNITS, decision.ts);
        absErr += Math.abs(pred.predictedQty - actual.quantity);
        const outcome = actual.quantity >= NEEDED_UNITS ? 1 : 0;
        brier += (pred.pSuccess - outcome) ** 2;
        const b = bins[Math.min(9, Math.floor(pred.pSuccess * 10))]!;
        b.pSum += pred.pSuccess;
        b.hits += outcome;
        b.n += 1;
        n += 1;
      }
    }
  }

  if (n === 0) {
    console.log("No scorable predictions yet — need more observation history. Try again after the recorder has run a while.");
    return;
  }
  console.log(`Backtest over ${n} predictions across ${groups.size} items:`);
  console.log(`  MAE (stock units):  ${(absErr / n).toFixed(1)}`);
  console.log(`  Brier score:        ${(brier / n).toFixed(4)}  (lower is better; 0.25 = coin flip)`);
  console.log("  Calibration (predicted vs actual):");
  for (let i = 0; i < bins.length; i++) {
    const b = bins[i]!;
    if (b.n === 0) continue;
    console.log(
      `    p≈${(i * 10).toString().padStart(2)}–${i * 10 + 10}%: predicted ${(100 * b.pSum / b.n).toFixed(0)}% | actual ${(100 * b.hits / b.n).toFixed(0)}%  (n=${b.n})`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closePool);
