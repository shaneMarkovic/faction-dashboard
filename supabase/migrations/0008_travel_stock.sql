-- Foreign-stock forecasting (Flying optimizer, phase 1).
--
-- Append-only ledger of observed foreign shop stock over time + a small,
-- per-item model-params table the web serving layer reads. The model itself
-- lives in @torn/shared (computeForecastParams / predictArrival); these tables
-- are just durable storage. Cold-start safe: with zero rows the serving layer
-- falls back to the current-stock heuristic.

-- Immutable observation ledger. Provenance kept (source + source_update_ts) so
-- everything downstream can be re-derived, and dedupe is idempotent.
create table stock_observations (
  id               bigint generated always as identity primary key,
  source           text not null default 'yata',
  country_code     text not null,
  item_id          bigint not null,
  quantity         int not null,
  cost             bigint not null,
  -- The SOURCE's update time (YATA `update`), not our fetch time — timestamping
  -- by fetch time manufactures phantom changes and ruins rate estimates.
  source_update_ts bigint not null,
  ingest_ts        timestamptz not null default now()
);
-- Idempotent ingest: a country snapshot whose update ts hasn't changed is skipped.
create unique index stock_obs_dedupe
  on stock_observations (source, country_code, item_id, source_update_ts);
create index stock_obs_lookup
  on stock_observations (country_code, item_id, source_update_ts);
create index stock_obs_prune on stock_observations (ingest_ts);

-- Current per-item model parameters, refreshed periodically by the collector.
create table forecast_params (
  country_code           text not null,
  item_id                bigint not null,
  depletion_rate_per_min numeric not null default 0,
  rate_var               numeric not null default 0,
  restock_interval_min   numeric,
  restock_amount         numeric,
  last_restock_ts        bigint,
  sample_count           int not null default 0,
  span_minutes           numeric not null default 0,
  confidence             numeric not null default 0,   -- 0..1
  updated_at             timestamptz not null default now(),
  primary key (country_code, item_id)
);
