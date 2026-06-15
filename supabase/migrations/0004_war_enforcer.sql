-- War Enforcer (PLAN: war-discipline enforcement, inspired by torn-war-enforcer.js).
-- The collector writes these during an active ranked war; a Tampermonkey
-- userscript reads them (anon) and disables attack links when caps are hit.
--
-- These tables are intentionally PUBLIC-READ: the userscript has no login, and
-- war state is non-sensitive. Writes happen only via the collector's service
-- credentials (which bypass RLS). Everything is faction-scoped for multi-tenancy.

-- Admin-set rule targets per faction. 0 = no limit.
create table war_rules (
  faction_id              bigint primary key references factions (id) on delete cascade,
  total_score_target      int not null default 0,
  per_member_score_target int not null default 0,
  max_attacks_per_member  int not null default 0,
  idle_minutes_target     int not null default 10,
  updated_at              timestamptz not null default now()
);

-- Denormalized current war state per faction — one cheap row the userscript reads.
create table war_state (
  faction_id              bigint primary key references factions (id) on delete cascade,
  active                  boolean not null default false,
  enlisted                boolean not null default false,
  war_id                  bigint,
  opponent_id             bigint,
  opponent_name           text,
  start_ts                bigint,
  our_score               int not null default 0,
  opponent_score          int not null default 0,
  faction_blocked         boolean not null default false,
  total_score_target      int not null default 0,
  per_member_score_target int not null default 0,
  max_attacks_per_member  int not null default 0,
  idle_minutes_target     int not null default 10,
  updated_at              timestamptz not null default now()
);

-- Per-member contribution + computed block state for the active war.
create table member_progress (
  faction_id bigint not null references factions (id) on delete cascade,
  war_id     bigint not null,
  member_id  bigint not null,
  name       text,
  score      numeric not null default 0,
  attacks    int not null default 0,
  blocked    boolean not null default false,
  reasons    jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  primary key (war_id, member_id)
);
create index member_progress_faction_idx on member_progress (faction_id);

-- Opponent roster + last-action time (drives the activity rule).
create table enemy_status (
  faction_id     bigint not null references factions (id) on delete cascade,
  war_id         bigint not null,
  member_id      bigint not null,
  name           text,
  last_action_ts bigint,
  state          text,
  updated_at     timestamptz not null default now(),
  primary key (war_id, member_id)
);
create index enemy_status_faction_idx on enemy_status (faction_id);

-- Public read for the no-login userscript. Writes are service-role only.
alter table war_rules       enable row level security;
alter table war_state       enable row level security;
alter table member_progress enable row level security;
alter table enemy_status    enable row level security;

create policy war_rules_public_read       on war_rules       for select using (true);
create policy war_state_public_read       on war_state       for select using (true);
create policy member_progress_public_read on member_progress for select using (true);
create policy enemy_status_public_read    on enemy_status    for select using (true);
