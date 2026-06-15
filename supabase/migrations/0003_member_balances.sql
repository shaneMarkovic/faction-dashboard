-- Per-member faction balances (dues/loans tracker). The /faction/balance
-- endpoint returns each member's money + points; we snapshot them here so the
-- Treasury page can show who owes/holds what.

create table member_balances (
  faction_id bigint not null references factions (id) on delete cascade,
  member_id  bigint not null,
  name       text,
  money      bigint not null default 0,
  points     bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (faction_id, member_id)
);
create index member_balances_faction_idx on member_balances (faction_id);

alter table member_balances enable row level security;
create policy member_balances_read on member_balances for select
  using (faction_id in (select app_member_faction_ids()));
