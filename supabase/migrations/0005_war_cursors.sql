-- Durable per-war aggregation cursor for the War Enforcer.
--
-- The enforcer aggregates per-member ranked-war contribution incrementally from
-- the attack log, tracking the last-processed attack `started` ts per war. That
-- cursor used to live only in collector memory, so a restart mid-war forced a
-- full rebuild (and re-deleted member_progress). Persisting it here makes
-- aggregation resume exactly where it left off across restarts/deploys.

create table war_cursors (
  war_id       bigint primary key,
  faction_id   bigint not null references factions (id) on delete cascade,
  last_started bigint not null,
  updated_at   timestamptz not null default now()
);
create index war_cursors_faction_idx on war_cursors (faction_id);

-- Service-role writes only (collector). Public read is harmless but unneeded.
alter table war_cursors enable row level security;
create policy war_cursors_public_read on war_cursors for select using (true);
