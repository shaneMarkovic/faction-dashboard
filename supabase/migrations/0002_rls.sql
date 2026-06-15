-- Row Level Security — every domain table gated by faction_id (PLAN §9, §10).
-- A user's accessible factions come from faction_links, so two factions sharing
-- a Discord guild can never read each other's rows. Officer-only tables (keys,
-- discord_config, channel_bindings) additionally require is_officer.
--
-- Assumes Supabase Auth where the JWT carries a 'discord_user_id' claim, set
-- during the Discord OAuth callback. Adjust app_discord_user_id() if you map
-- the Discord id differently.

create or replace function app_discord_user_id()
returns text
language sql stable
as $$
  select coalesce(
    auth.jwt() ->> 'discord_user_id',
    (auth.jwt() -> 'user_metadata') ->> 'discord_user_id'
  )
$$;

-- Factions the current user may read.
create or replace function app_member_faction_ids()
returns setof bigint
language sql stable security definer set search_path = public
as $$
  select faction_id from faction_links
  where discord_user_id = app_discord_user_id()
$$;

-- Factions where the current user is an officer.
create or replace function app_officer_faction_ids()
returns setof bigint
language sql stable security definer set search_path = public
as $$
  select faction_id from faction_links
  where discord_user_id = app_discord_user_id() and is_officer
$$;

-- --- Member-readable tables (gated by faction membership) ------------------

alter table factions        enable row level security;
alter table members         enable row level security;
alter table chain_snapshots enable row level security;
alter table oc_crimes       enable row level security;
alter table oc_slots        enable row level security;
alter table wars            enable row level security;
alter table news            enable row level security;
alter table events          enable row level security;
alter table balances        enable row level security;

create policy factions_read on factions for select
  using (id in (select app_member_faction_ids()));

create policy members_read on members for select
  using (faction_id in (select app_member_faction_ids()));

create policy chain_read on chain_snapshots for select
  using (faction_id in (select app_member_faction_ids()));

create policy oc_crimes_read on oc_crimes for select
  using (faction_id in (select app_member_faction_ids()));

create policy oc_slots_read on oc_slots for select
  using (exists (
    select 1 from oc_crimes c
    where c.id = oc_slots.crime_id
      and c.faction_id in (select app_member_faction_ids())
  ));

create policy wars_read on wars for select
  using (faction_id in (select app_member_faction_ids()));

create policy news_read on news for select
  using (faction_id in (select app_member_faction_ids()));

create policy events_read on events for select
  using (faction_id in (select app_member_faction_ids()));

create policy balances_read on balances for select
  using (faction_id in (select app_member_faction_ids()));

-- --- Officer-only tables ----------------------------------------------------

alter table api_keys         enable row level security;
alter table discord_config   enable row level security;
alter table channel_bindings enable row level security;
alter table faction_links    enable row level security;

create policy api_keys_officer on api_keys for select
  using (faction_id in (select app_officer_faction_ids()));

create policy discord_config_officer on discord_config for select
  using (faction_id in (select app_officer_faction_ids()));

create policy channel_bindings_officer on channel_bindings for select
  using (faction_id in (select app_officer_faction_ids()));

-- A user can see their own faction links.
create policy faction_links_self on faction_links for select
  using (discord_user_id = app_discord_user_id());

-- --- Guild metadata ---------------------------------------------------------

alter table discord_guilds enable row level security;
create policy discord_guilds_read on discord_guilds for select
  using (auth.role() = 'authenticated');

-- Writes: all snapshot/ingest writes go through the collector and API routes
-- using the Supabase service role, which bypasses RLS. There are intentionally
-- no client-side INSERT/UPDATE/DELETE policies.
