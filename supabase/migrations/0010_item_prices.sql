-- Item price reference, recorded by the collector (which owns outbound Torn
-- traffic) so the WEB never has to call /torn/items live. The web reads these
-- rows for the Flying tab's home-market sell prices; removes the web's
-- dependence on TORN_API_KEY / Torn reachability for reference data.

create table item_prices (
  item_id      bigint primary key,
  name         text not null,
  market_value bigint not null default 0,
  type         text,
  updated_at   timestamptz not null default now()
);

-- Lock from Supabase's public REST API (anon). Service-role connection bypasses.
alter table item_prices enable row level security;
