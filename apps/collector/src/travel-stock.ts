/**
 * Travel-stock recorder — the data engine behind foreign-stock forecasting.
 *
 * Polls YATA on a fixed cadence and appends observations to the immutable
 * `stock_observations` ledger (idempotent: deduped on the source update ts).
 * Periodically re-derives per-item model params into `forecast_params` (the
 * web reads those to serve arrival predictions), and prunes old observations.
 *
 * Cold-start safe and self-contained: it just needs a Postgres pool. Until
 * history accrues the params stay low-confidence and the web falls back to the
 * current-stock heuristic.
 */

import { TornClient, computeForecastParams, fetchItems, fetchYataExport, type ObsPoint } from "@torn/shared";
import type { Pool } from "pg";

const RECORD_MS = 90_000; // poll cadence; fast vs the ~15min restock cycle
const REFRESH_EVERY = 7; // re-derive params ~every 10.5 min
const PRUNE_EVERY = 320; // prune ~every 8h
const RETENTION_DAYS = 90;
const MODEL_WINDOW_HOURS = 48; // history window used to fit params

export class TravelStockRecorder {
  constructor(private readonly pool: Pool) {}

  start(signal: AbortSignal): void {
    let cycle = 0;
    const tick = async () => {
      try {
        await this.record();
      } catch (err) {
        console.warn("[stock] record failed:", String(err));
      }
      if (cycle % REFRESH_EVERY === 0) {
        try {
          const n = await this.refreshParams();
          console.log(`[stock] refreshed forecast params for ${n} item(s).`);
        } catch (err) {
          console.warn("[stock] refresh failed:", String(err));
        }
        try {
          await this.recordItemPrices();
        } catch (err) {
          console.warn("[stock] item-price refresh failed:", String(err));
        }
      }
      if (cycle % PRUNE_EVERY === PRUNE_EVERY - 1) {
        try {
          await this.prune();
        } catch (err) {
          console.warn("[stock] prune failed:", String(err));
        }
      }
      cycle++;
    };

    void tick();
    const timer = setInterval(() => {
      if (signal.aborted) {
        clearInterval(timer);
        return;
      }
      void tick();
    }, RECORD_MS);
    signal.addEventListener("abort", () => clearInterval(timer));
    console.log(`[stock] recorder started (every ${Math.round(RECORD_MS / 1000)}s).`);
  }

  /** Append the current YATA snapshot (one idempotent insert per country). */
  private async record(): Promise<void> {
    const countries = await fetchYataExport();
    if (countries.length === 0) return;
    let inserted = 0;
    for (const c of countries) {
      if (!c.items.length || !c.updatedAt) continue;
      const ids = c.items.map((i) => i.id);
      const qtys = c.items.map((i) => i.quantity);
      const costs = c.items.map((i) => i.cost);
      const res = await this.pool.query(
        `insert into stock_observations (source, country_code, item_id, quantity, cost, source_update_ts)
         select 'yata', $1, u.item_id, u.qty, u.cost, $2
           from unnest($3::bigint[], $4::int[], $5::bigint[]) as u(item_id, qty, cost)
         on conflict do nothing`,
        [c.countryCode, c.updatedAt, ids, qtys, costs],
      );
      inserted += res.rowCount ?? 0;
    }
    if (inserted) console.log(`[stock] recorded ${inserted} new observation(s).`);
  }

  /** Re-derive forecast params for every item seen in the model window. */
  private async refreshParams(): Promise<number> {
    const { rows } = await this.pool.query<{
      country_code: string;
      item_id: string;
      quantity: number;
      source_update_ts: string;
    }>(
      `select country_code, item_id, quantity, source_update_ts
         from stock_observations
        where ingest_ts > now() - ($1::int * interval '1 hour')
        order by country_code, item_id, source_update_ts`,
      [MODEL_WINDOW_HOURS],
    );
    if (rows.length === 0) return 0;

    // Group observations per (country, item).
    const groups = new Map<string, { country: string; item: number; obs: ObsPoint[] }>();
    for (const r of rows) {
      const key = `${r.country_code}:${r.item_id}`;
      let g = groups.get(key);
      if (!g) {
        g = { country: r.country_code, item: Number(r.item_id), obs: [] };
        groups.set(key, g);
      }
      g.obs.push({ quantity: Number(r.quantity), ts: Number(r.source_update_ts) });
    }

    for (const g of groups.values()) {
      const m = computeForecastParams(g.obs);
      await this.pool.query(
        `insert into forecast_params
           (country_code, item_id, depletion_rate_per_min, rate_var, restock_interval_min,
            restock_amount, last_restock_ts, sample_count, span_minutes, confidence, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
         on conflict (country_code, item_id) do update set
           depletion_rate_per_min = excluded.depletion_rate_per_min,
           rate_var = excluded.rate_var,
           restock_interval_min = excluded.restock_interval_min,
           restock_amount = excluded.restock_amount,
           last_restock_ts = excluded.last_restock_ts,
           sample_count = excluded.sample_count,
           span_minutes = excluded.span_minutes,
           confidence = excluded.confidence,
           updated_at = now()`,
        [
          g.country, g.item, m.depletionRatePerMin, m.rateVar, m.restockIntervalMin,
          m.restockAmount, m.lastRestockTs, m.sampleCount, m.spanMinutes, m.confidence,
        ],
      );
    }
    return groups.size;
  }

  /** Refresh the item-price reference table from /torn/items (any key works). */
  private async recordItemPrices(): Promise<void> {
    const key = process.env.TORN_API_KEY;
    if (!key) {
      console.warn("[stock] TORN_API_KEY not set — skipping item-price refresh.");
      return;
    }
    const items = await fetchItems(new TornClient(key));
    if (items.length === 0) return;
    const ids = items.map((i) => i.id);
    const names = items.map((i) => i.name);
    const vals = items.map((i) => i.marketValue);
    const types = items.map((i) => i.type);
    await this.pool.query(
      `insert into item_prices (item_id, name, market_value, type, updated_at)
       select u.id, u.name, u.val, u.type, now()
         from unnest($1::bigint[], $2::text[], $3::bigint[], $4::text[]) as u(id, name, val, type)
       on conflict (item_id) do update set
         name = excluded.name, market_value = excluded.market_value,
         type = excluded.type, updated_at = now()`,
      [ids, names, vals, types],
    );
    console.log(`[stock] refreshed ${items.length} item prices.`);
  }

  private async prune(): Promise<void> {
    const res = await this.pool.query(
      `delete from stock_observations where ingest_ts < now() - ($1::int * interval '1 day')`,
      [RETENTION_DAYS],
    );
    if (res.rowCount) console.log(`[stock] pruned ${res.rowCount} old observation(s).`);
  }
}
