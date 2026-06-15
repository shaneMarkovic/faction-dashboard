-- Torn Faction Dashboard — initial schema
-- Multi-tenant by design (PLAN §3.1): a Discord guild owns many factions;
-- the faction (faction_id) is the unit of isolation. Every domain row carries
-- faction_id and is gated by RLS so two factions sharing a guild never cross.

-- ---------------------------------------------------------------------------
-- Tenancy: guild ⊇ factions, and the people/keys attached to each faction
-- ---------------------------------------------------------------------------

create table discord_guilds (
  guild_id     text primary key,            -- Discord snowflake
  name         text not null,
  installed_by text,                         -- Discord user id who installed
  created_at   timestamptz not null default now()
);

create table factions (
  id            bigint primary key,          -- Torn faction id
  guild_id      text references discord_guilds (guild_id) on delete set null,
  name          text not null,
  tag           text,
  is_primary    boolean not null default false,  -- the guild's main faction
  settings_json jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
create index factions_guild_idx on factions (guild_id);

-- A Discord user ↔ Torn member ↔ faction. A user may hold rows in >1 faction
-- (cross-faction officers); `is_officer` gates the privileged tables below.
create table faction_links (
  discord_user_id text not null,
  member_id       bigint not null,           -- Torn user id
  faction_id      bigint not null references factions (id) on delete cascade,
  role            text,
  is_officer      boolean not null default false,
  created_at      timestamptz not null default now(),
  primary key (discord_user_id, faction_id)
);
create index faction_links_member_idx on faction_links (member_id);
create index faction_links_faction_idx on faction_links (faction_id);

-- Pins a Discord channel to a faction for slash-command/alert routing (PLAN §8).
create table channel_bindings (
  guild_id   text not null references discord_guilds (guild_id) on delete cascade,
  channel_id text not null,
  faction_id bigint not null references factions (id) on delete cascade,
  primary key (guild_id, channel_id)
);

-- ---------------------------------------------------------------------------
-- Keys — per-faction pool (PLAN §6, §10). Encrypted at rest; never sent to client.
-- ---------------------------------------------------------------------------

create table api_keys (
  id                bigint generated always as identity primary key,
  member_id         bigint not null,
  faction_id        bigint not null references factions (id) on delete cascade,
  encrypted_key     bytea not null,          -- AES-256-GCM ciphertext
  access_level      text not null,           -- Public | Minimal | Limited | Full | Custom
  has_faction_access boolean not null default false,
  ingest_token_hash text,                    -- for userscript HMAC (PLAN §7)
  is_officer_key    boolean not null default false,
  revoked           boolean not null default false,
  created_at        timestamptz not null default now()
);
create index api_keys_faction_idx on api_keys (faction_id) where not revoked;

-- ---------------------------------------------------------------------------
-- Domain snapshots (collector writes, web reads)
-- ---------------------------------------------------------------------------

create table members (
  torn_id          bigint not null,
  faction_id       bigint not null references factions (id) on delete cascade,
  name             text not null,
  position         text,
  level            int,
  days_in_faction  int,
  status_state     text,
  status_until     bigint,                   -- unix seconds, null when n/a
  status_description text,
  last_action_ts   bigint,
  is_on_wall       boolean not null default false,
  is_in_oc         boolean not null default false,
  is_revivable     boolean not null default false,
  revive_setting   text,
  has_early_discharge boolean not null default false,
  updated_at       timestamptz not null default now(),
  primary key (faction_id, torn_id)
);

create table chain_snapshots (
  id          bigint generated always as identity primary key,
  faction_id  bigint not null references factions (id) on delete cascade,
  chain_id    bigint,
  current     int not null,
  max         int not null,
  timeout     int not null,
  cooldown    int not null default 0,
  modifier    numeric,
  captured_at timestamptz not null default now()
);
create index chain_snapshots_faction_idx on chain_snapshots (faction_id, captured_at desc);

create table oc_crimes (
  id          bigint primary key,            -- Torn crime id
  faction_id  bigint not null references factions (id) on delete cascade,
  name        text not null,
  difficulty  int,
  status      text,
  ready_at    bigint,
  expired_at  bigint,
  updated_at  timestamptz not null default now()
);
create index oc_crimes_faction_idx on oc_crimes (faction_id);

create table oc_slots (
  crime_id   bigint not null references oc_crimes (id) on delete cascade,
  position   text not null,
  slot_index int not null,
  user_id    bigint,
  cpr        numeric,                         -- checkpoint pass rate 0-100
  ready_at   bigint,
  primary key (crime_id, slot_index)
);

create table wars (
  id             bigint primary key,          -- Torn ranked war id
  faction_id     bigint not null references factions (id) on delete cascade,
  opponent_id    bigint,
  opponent_name  text,
  score          int not null default 0,
  opponent_score int not null default 0,
  target         int,
  start_ts       bigint,
  end_ts         bigint,
  updated_at     timestamptz not null default now()
);
create index wars_faction_idx on wars (faction_id);

create table balances (
  faction_id  bigint primary key references factions (id) on delete cascade,
  money       bigint not null default 0,
  points      bigint not null default 0,
  updated_at  timestamptz not null default now()
);

create table news (
  id         bigint generated always as identity primary key,
  faction_id bigint not null references factions (id) on delete cascade,
  type       text,
  text       text,
  ts         bigint not null
);
create index news_faction_idx on news (faction_id, ts desc);

create table discord_config (
  faction_id   bigint not null references factions (id) on delete cascade,
  event_type   text not null,                 -- chain_warn | oc_ready | war_start | ...
  channel_id   text not null,
  role_mention text,
  primary key (faction_id, event_type)
);

-- Drives realtime + history (PLAN §9).
create table events (
  id           bigint generated always as identity primary key,
  faction_id   bigint not null references factions (id) on delete cascade,
  type         text not null,
  payload_json jsonb not null default '{}',
  ts           timestamptz not null default now()
);
create index events_faction_idx on events (faction_id, ts desc);
