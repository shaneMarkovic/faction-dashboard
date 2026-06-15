-- Travel run optimizer: per-user flight-time reduction (business class, perks,
-- education, job bonuses, etc.). 0 = standard flight times. Used to compute
-- profit-per-real-minute on the Flying tab.

alter table user_finance_prefs
  add column travel_time_reduction int not null default 0;
