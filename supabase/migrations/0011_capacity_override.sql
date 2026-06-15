-- Travel capacity becomes an OPTIONAL manual override.
--   NULL  → auto-detect from the user's perks (best-effort), fall back to default
--   value → user's explicit override (always wins)
-- (No existing rows depend on the old default, so this is a clean change.)

alter table user_finance_prefs alter column travel_capacity drop default;
alter table user_finance_prefs alter column travel_capacity drop not null;
