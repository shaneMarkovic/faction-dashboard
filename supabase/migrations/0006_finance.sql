-- Personal Finance & Flying feature.
--
-- Adds per-user "personal" API keys (distinct from the pooled faction keys) so
-- the web app can read each member's own money/networth/log/travel data, plus
-- the persistence tables that back the net-worth and cash-flow history charts.

-- ---------------------------------------------------------------------------
-- Personal keys: distinguish per-user finance keys from pooled faction keys.
-- The collector must NEVER pool a 'personal' key as a faction poller.
-- ---------------------------------------------------------------------------

alter table api_keys
  add column purpose text not null default 'faction'
    check (purpose in ('faction', 'personal'));

-- At most one live personal key per member.
create unique index api_keys_personal_member_uniq
  on api_keys (member_id) where purpose = 'personal' and not revoked;

-- Keep the faction pool index scoped to faction keys only.
drop index if exists api_keys_faction_idx;
create index api_keys_faction_idx on api_keys (faction_id)
  where not revoked and purpose = 'faction';

-- Fast per-user lookup for the web's per-request client builder.
create index api_keys_personal_lookup on api_keys (member_id)
  where not revoked and purpose = 'personal';

-- ---------------------------------------------------------------------------
-- Per-user preferences. Travel capacity has no API source — manual, default 19.
-- ---------------------------------------------------------------------------

create table user_finance_prefs (
  member_id       bigint primary key,
  travel_capacity int not null default 19,
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Net-worth breakdown over time (one row per throttled snapshot write).
-- ---------------------------------------------------------------------------

create table user_networth_snapshots (
  id          bigint generated always as identity primary key,
  member_id   bigint not null,
  total       bigint not null,
  wallet      bigint not null default 0,
  bank        bigint not null default 0,
  cayman      bigint not null default 0,
  vault       bigint not null default 0,
  points      bigint not null default 0,
  items       bigint not null default 0,
  bazaar      bigint not null default 0,
  stocks      bigint not null default 0,
  other       bigint not null default 0,
  captured_at timestamptz not null default now()
);
create index user_nw_member_idx on user_networth_snapshots (member_id, captured_at desc);

-- ---------------------------------------------------------------------------
-- Daily cash-flow rollup, reconstructed from /user/log money movements.
-- History rolls forward from the day the user connects a finance key.
-- ---------------------------------------------------------------------------

create table user_cashflow_daily (
  member_id  bigint not null,
  day        date not null,
  income     bigint not null default 0,
  expense    bigint not null default 0,
  net        bigint not null default 0,
  categories jsonb not null default '{}',  -- { category: net } for drill-down
  updated_at timestamptz not null default now(),
  primary key (member_id, day)
);
