-- Measured restock-timing jitter, recorded by the collector. Previously the
-- forecast used a fixed heuristic (std = 20% of the restock interval) for how
-- much a restock drifts off schedule; that jitter sets how confident the arrival
-- odds can get near a restock boundary. We now persist the observed variance of
-- restock intervals (and the cycle count behind it) so the model can use the
-- measured spread, shrinking toward the heuristic until enough cycles accrue.
-- Defaulted so existing rows degrade to the heuristic until the collector
-- re-derives params and backfills.

alter table forecast_params
  add column restock_interval_var numeric not null default 0,
  add column restock_cycles       int     not null default 0;
