-- Close the RLS gap on the finance/forecast tables (and the migrations ledger).
--
-- These were created without RLS, leaving them readable/writable via Supabase's
-- public REST API (anon key). The app reads them only through the service-level
-- connection string, which bypasses RLS, so enabling RLS with NO policies locks
-- them to everyone EXCEPT the backend — matching the posture in 0002_rls.sql
-- (all snapshot/ingest writes go through the service role; no client policies).

-- Per-user financial data — the sensitive ones.
alter table user_finance_prefs       enable row level security;
alter table user_networth_snapshots  enable row level security;
alter table user_cashflow_daily      enable row level security;

-- Foreign-stock forecasting (not sensitive, but no reason to expose).
alter table stock_observations       enable row level security;
alter table forecast_params          enable row level security;

-- Internal migrations ledger.
alter table _migrations              enable row level security;
