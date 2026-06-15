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
  fetchUserMoney,
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

/**
 * Wrap a per-user cached loader so that a missing personal client (no key, or a
 * transient DB outage where the key row can't be read) returns null WITHOUT
 * caching it. Otherwise `unstable_cache` would pin that null for the whole
 * revalidate window, so one DB blip makes a tab look broken for minutes.
 */
function guarded<A extends unknown[], T>(
  cached: (memberId: number, ...args: A) => Promise<T | null>,
): (memberId: number, ...args: A) => Promise<T | null> {
  return async (memberId: number, ...args: A) => {
    if (!(await personalTornClient(memberId))) return null;
    return cached(memberId, ...args);
  };
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

const loadNetworthCached = unstable_cache(
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
export const loadNetworth = guarded(loadNetworthCached);

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

const loadCashflowCached = unstable_cache(
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
export const loadCashflow = guarded(loadCashflowCached);

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

const loadTradingStatsCached = unstable_cache(
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
export const loadTradingStats = guarded(loadTradingStatsCached);

// --- Flying / trading helper ------------------------------------------------

/** Standard one-way flight time (minutes) by YATA country code. */
const FLIGHT_MINUTES: Record<string, number> = {
  mex: 26,
  cay: 35,
  can: 41,
  haw: 134,
  uni: 159,
  arg: 167,
  swi: 175,
  jap: 225,
  chi: 242,
  uae: 271,
  sou: 297,
};

export interface FlyingRow {
  countryCode: string;
  countryName: string;
  itemId: number;
  itemName: string;
  stock: number;
  buyPrice: number;
  homePrice: number;
  profitPerItem: number;
  roiPct: number;
  /** Round-trip flight time in minutes, after the user's reduction. */
  roundTripMin: number;
  /** Units you can actually carry this trip = min(capacity, stock). */
  tripUnits: number;
  /** Realistic profit for one trip = profitPerItem * tripUnits. */
  tripProfit: number;
  /** Cash needed to buy a full trip. */
  costPerTrip: number;
  /** profit per real-world minute (round trip). The optimizer's ranking key. */
  profitPerMin: number;
  /** Foreign stock can't fill your capacity. */
  lowStock: boolean;
  /** A full trip costs more than your wallet cash. */
  cashLimited: boolean;
}

export interface FlyingData {
  rows: FlyingRow[];
  /** Top opportunities right now, ranked by profit/min. */
  recommendations: FlyingRow[];
  capacity: number;
  timeReduction: number;
  wallet: number;
  travel: UserTravelStatus | null;
  yataStale: boolean;
}

export interface FinancePrefs {
  capacity: number;
  timeReduction: number;
}

export async function getFinancePrefs(memberId: number): Promise<FinancePrefs> {
  const rows = await tryQuery<{ travel_capacity: number; travel_time_reduction: number }>(
    "select travel_capacity, travel_time_reduction from user_finance_prefs where member_id = $1",
    [memberId],
  );
  const r = rows?.[0];
  return {
    capacity: r ? Number(r.travel_capacity) : 19,
    timeReduction: r ? Number(r.travel_time_reduction) : 0,
  };
}

const loadFlyingOpportunitiesCached = unstable_cache(
  async (memberId: number, capacity: number, timeReduction: number): Promise<FlyingData | null> => {
    const pc = await personalTornClient(memberId);
    if (!pc) return null;

    const [yata, items, travel, money] = await Promise.all([
      loadYataTravel(),
      loadItemPrices(),
      fetchUserTravel(pc.client, nowSec()).catch(() => null),
      fetchUserMoney(pc.client).catch(() => null),
    ]);
    const wallet = money?.wallet ?? 0;
    const reduction = Math.max(0, Math.min(90, timeReduction)) / 100;

    const priceById = new Map(items.map((it) => [it.id, it.marketValue]));
    const rows: FlyingRow[] = [];
    for (const country of yata) {
      const oneWay = FLIGHT_MINUTES[country.countryCode];
      const roundTripMin = oneWay ? Math.max(1, Math.round(2 * oneWay * (1 - reduction))) : 0;
      for (const item of country.items) {
        const homePrice = priceById.get(item.id) ?? 0;
        if (homePrice <= 0) continue;
        const profitPerItem = homePrice - item.cost;
        const tripUnits = Math.min(capacity, item.quantity);
        const tripProfit = profitPerItem * tripUnits;
        const costPerTrip = item.cost * tripUnits;
        rows.push({
          countryCode: country.countryCode,
          countryName: COUNTRY_NAMES[country.countryCode] ?? country.countryCode,
          itemId: item.id,
          itemName: item.name,
          stock: item.quantity,
          buyPrice: item.cost,
          homePrice,
          profitPerItem,
          roiPct: item.cost > 0 ? (profitPerItem / item.cost) * 100 : 0,
          roundTripMin,
          tripUnits,
          tripProfit,
          costPerTrip,
          profitPerMin: roundTripMin > 0 ? Math.round(tripProfit / roundTripMin) : 0,
          lowStock: item.quantity < capacity,
          cashLimited: costPerTrip > wallet,
        });
      }
    }
    // Default table ordering: best realized profit per trip first.
    rows.sort((a, b) => b.tripProfit - a.tripProfit);

    // "Right now" = best profit/min among profitable, in-stock items.
    const recommendations = rows
      .filter((r) => r.profitPerItem > 0 && r.roundTripMin > 0 && !r.lowStock)
      .sort((a, b) => b.profitPerMin - a.profitPerMin)
      .slice(0, 6);

    return {
      rows,
      recommendations,
      capacity,
      timeReduction,
      wallet,
      travel,
      yataStale: yata.length === 0,
    };
  },
  ["finance-flying"],
  { revalidate: 120 },
);
export const loadFlyingOpportunities = guarded(loadFlyingOpportunitiesCached);
