/**
 * Per-user Finance & Flying data layer.
 *
 * Reads each member's OWN data with their stored personal key
 * (see personalTornClient). Per-user loaders are cached by memberId so one
 * member's financials never leak into another's cache. Reference data
 * (/torn/items, YATA) is fetched with the shared server key and cached once for
 * everyone. All loaders degrade gracefully: a missing/invalid key or a thrown
 * Torn error returns a sentinel rather than crashing the page.
 */

import "server-only";
import { unstable_cache } from "next/cache";
import {
  TornApiError,
  fetchHistoricalNetworth,
  fetchItems,
  fetchNetworthBreakdown,
  fetchStocksRef,
  fetchUserLog,
  fetchUserPersonalStats,
  fetchUserStocks,
  fetchUserTravel,
  type ItemRef,
  type NetworthBreakdown,
  type PersonalStatsSubset,
  type UserLogEntry,
  type UserStockHolding,
  type UserTravelStatus,
} from "@torn/shared";
import { tryQuery } from "./db";
import { personalTornClient, serverTornClient } from "./torn";
import { COUNTRY_NAMES, loadYataTravel } from "./yata";

export interface Point {
  t: number;
  value: number;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

// --- Connection -------------------------------------------------------------

export interface FinanceConnection {
  connected: boolean;
  accessLevel: string | null;
}

/** Whether the member has a usable personal finance key. Never cached. */
export async function loadFinanceConnection(memberId: number): Promise<FinanceConnection> {
  const rows = await tryQuery<{ access_level: string }>(
    `select access_level from api_keys
       where member_id = $1 and purpose = 'personal' and not revoked limit 1`,
    [memberId],
  );
  if (!rows || rows.length === 0) return { connected: false, accessLevel: null };
  return { connected: true, accessLevel: rows[0]!.access_level };
}

// --- Shared reference: item market values ----------------------------------

/** id → market value, for the home-market sell baseline. Cached once for all. */
export const loadItemPrices = unstable_cache(
  async (): Promise<ItemRef[]> => {
    try {
      return await fetchItems(serverTornClient());
    } catch {
      return [];
    }
  },
  ["finance-item-prices"],
  { revalidate: 300 },
);

// --- Net worth --------------------------------------------------------------

export interface NetworthData {
  breakdown: NetworthBreakdown;
}

export const loadNetworth = unstable_cache(
  async (memberId: number): Promise<NetworthData | null> => {
    const pc = await personalTornClient(memberId);
    if (!pc) return null;
    try {
      const breakdown = await fetchNetworthBreakdown(pc.client);
      await writeNetworthSnapshot(memberId, breakdown);
      return { breakdown };
    } catch (err) {
      if (err instanceof TornApiError) return null;
      throw err;
    }
  },
  ["finance-networth"],
  { revalidate: 60 },
);

/** Insert a snapshot at most once per 6h per member (throttle). */
async function writeNetworthSnapshot(memberId: number, n: NetworthBreakdown): Promise<void> {
  // Snapshot columns: bazaar←itemmarket, stocks←stockmarket; fold the rest into other.
  const bazaar = n.itemmarket;
  const stocks = n.stockmarket;
  const other = n.other + n.displaycase + n.properties + n.company;
  await tryQuery(
    `insert into user_networth_snapshots
       (member_id, total, wallet, bank, cayman, vault, points, items, bazaar, stocks, other)
     select $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
      where not exists (
        select 1 from user_networth_snapshots
         where member_id = $1 and captured_at > now() - interval '6 hours'
      )`,
    [memberId, n.total, n.wallet, n.bank, n.cayman, n.vault, n.points, n.items, bazaar, stocks, other],
  );
}

export const loadNetworthHistory = unstable_cache(
  async (memberId: number): Promise<Point[]> => {
    await maybeSeedNetworthHistory(memberId);
    const rows = await tryQuery<{ t: string | number; value: string | number }>(
      `select extract(epoch from captured_at) as t, total as value
         from user_networth_snapshots where member_id = $1
        order by captured_at`,
      [memberId],
    );
    return (rows ?? []).map((r) => ({ t: Number(r.t), value: Number(r.value) }));
  },
  ["finance-networth-history"],
  { revalidate: 300 },
);

/** One-time backfill of ~12 weekly net-worth points from personal stats. */
async function maybeSeedNetworthHistory(memberId: number): Promise<void> {
  const existing = await tryQuery<{ n: string }>(
    "select count(*) as n from user_networth_snapshots where member_id = $1",
    [memberId],
  );
  if (!existing || Number(existing[0]?.n ?? 0) > 0) return;
  const pc = await personalTornClient(memberId);
  if (!pc) return;
  const now = nowSec();
  const weeks = Array.from({ length: 12 }, (_, i) => now - (i + 1) * 7 * 86400);
  const points = await Promise.all(
    weeks.map(async (ts) => ({ ts, value: await fetchHistoricalNetworth(pc.client, ts) })),
  );
  for (const p of points) {
    if (p.value == null || p.value <= 0) continue;
    await tryQuery(
      `insert into user_networth_snapshots (member_id, total, captured_at)
       values ($1, $2, to_timestamp($3))`,
      [memberId, Math.round(p.value), p.ts],
    );
  }
}

// --- Cash flow --------------------------------------------------------------

export interface CashflowWeek {
  weekStart: number; // unix seconds
  income: number;
  expense: number;
  net: number;
}

export interface CashflowData {
  weeks: CashflowWeek[];
  recent: UserLogEntry[];
}

export const loadCashflow = unstable_cache(
  async (memberId: number, weeks = 8): Promise<CashflowData | null> => {
    const pc = await personalTornClient(memberId);
    if (!pc) return null;
    let log: UserLogEntry[];
    try {
      log = await fetchUserLog(pc.client, { limit: 100 });
    } catch (err) {
      if (err instanceof TornApiError) return null;
      throw err;
    }
    await rollupCashflow(memberId, log);

    const rows = await tryQuery<Record<string, string | number>>(
      `select extract(epoch from date_trunc('week', day)) as wk,
              sum(income) as income, sum(expense) as expense, sum(net) as net
         from user_cashflow_daily
        where member_id = $1 and day > (now() - ($2::int * interval '7 day'))::date
        group by 1 order by 1`,
      [memberId, weeks],
    );
    return {
      weeks: (rows ?? []).map((r) => ({
        weekStart: Number(r.wk),
        income: Number(r.income),
        expense: Number(r.expense),
        net: Number(r.net),
      })),
      recent: log.filter((e) => e.money !== 0).slice(0, 30),
    };
  },
  ["finance-cashflow"],
  { revalidate: 120 },
);

/** Aggregate the recent log into per-day rows and upsert them. */
async function rollupCashflow(memberId: number, log: UserLogEntry[]): Promise<void> {
  const byDay = new Map<string, { income: number; expense: number; categories: Record<string, number> }>();
  for (const e of log) {
    if (e.money === 0 || !e.timestamp) continue;
    const day = new Date(e.timestamp * 1000).toISOString().slice(0, 10);
    const bucket = byDay.get(day) ?? { income: 0, expense: 0, categories: {} };
    if (e.money > 0) bucket.income += e.money;
    else bucket.expense += -e.money;
    const cat = e.category || "Other";
    bucket.categories[cat] = (bucket.categories[cat] ?? 0) + e.money;
    byDay.set(day, bucket);
  }
  for (const [day, b] of byDay) {
    await tryQuery(
      `insert into user_cashflow_daily (member_id, day, income, expense, net, categories, updated_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, now())
       on conflict (member_id, day) do update
         set income = excluded.income, expense = excluded.expense,
             net = excluded.net, categories = excluded.categories, updated_at = now()`,
      [memberId, day, b.income, b.expense, b.income - b.expense, JSON.stringify(b.categories)],
    );
  }
}

// --- Trading / market stats -------------------------------------------------

export interface TradingData {
  stats: PersonalStatsSubset;
  stocksValue: number;
  holdings: UserStockHolding[];
}

export const loadTradingStats = unstable_cache(
  async (memberId: number): Promise<TradingData | null> => {
    const pc = await personalTornClient(memberId);
    if (!pc) return null;
    try {
      const ref = await fetchStocksRef(serverTornClient()).catch((): Awaited<ReturnType<typeof fetchStocksRef>> => new Map());
      const [stats, holdings] = await Promise.all([
        fetchUserPersonalStats(pc.client),
        fetchUserStocks(pc.client, ref).catch(() => []),
      ]);
      return {
        stats,
        stocksValue: holdings.reduce((n, h) => n + h.value, 0),
        holdings: holdings.sort((a, b) => b.value - a.value),
      };
    } catch (err) {
      if (err instanceof TornApiError) return null;
      throw err;
    }
  },
  ["finance-trading"],
  { revalidate: 120 },
);

// --- Flying / trading helper ------------------------------------------------

export interface FlyingRow {
  countryCode: string;
  countryName: string;
  itemId: number;
  itemName: string;
  stock: number;
  buyPrice: number;
  homePrice: number;
  profitPerItem: number;
  profitPerTrip: number;
  roiPct: number;
}

export interface FlyingData {
  rows: FlyingRow[];
  capacity: number;
  travel: UserTravelStatus | null;
  yataStale: boolean;
}

export async function getTravelCapacity(memberId: number): Promise<number> {
  const rows = await tryQuery<{ travel_capacity: number }>(
    "select travel_capacity from user_finance_prefs where member_id = $1",
    [memberId],
  );
  return rows?.[0] ? Number(rows[0].travel_capacity) : 19;
}

export const loadFlyingOpportunities = unstable_cache(
  async (memberId: number, capacity: number): Promise<FlyingData | null> => {
    const pc = await personalTornClient(memberId);
    if (!pc) return null;

    const [yata, items, travel] = await Promise.all([
      loadYataTravel(),
      loadItemPrices(),
      fetchUserTravel(pc.client, nowSec()).catch(() => null),
    ]);

    const priceById = new Map(items.map((it) => [it.id, it.marketValue]));
    const rows: FlyingRow[] = [];
    for (const country of yata) {
      for (const item of country.items) {
        const homePrice = priceById.get(item.id) ?? 0;
        if (homePrice <= 0) continue;
        const profitPerItem = homePrice - item.cost;
        rows.push({
          countryCode: country.countryCode,
          countryName: COUNTRY_NAMES[country.countryCode] ?? country.countryCode,
          itemId: item.id,
          itemName: item.name,
          stock: item.quantity,
          buyPrice: item.cost,
          homePrice,
          profitPerItem,
          profitPerTrip: profitPerItem * capacity,
          roiPct: item.cost > 0 ? (profitPerItem / item.cost) * 100 : 0,
        });
      }
    }
    rows.sort((a, b) => b.profitPerItem - a.profitPerItem);
    return { rows, capacity, travel, yataStale: yata.length === 0 };
  },
  ["finance-flying"],
  { revalidate: 120 },
);
