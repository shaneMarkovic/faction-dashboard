-- Highest stock level ever observed per item, recorded by the collector. Acts
-- as a physical ceiling for arrival predictions: without it, summing restocks
-- over a long flight horizon lets predicted stock grow unbounded (and odds spike
-- to a spurious ~100%). Nullable + defaulted so existing rows degrade to "no
-- ceiling" until the collector next re-derives params and backfills the value.

alter table forecast_params
  add column max_observed_qty numeric not null default 0;
