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
  fetchTravelCapacity,
  fetchUserStocks,
  fetchUserTravel,
  fetchYataExport,
  predictArrival,
  classifyItem,
  hasMuseumValue,
  hasIrregularRestock,
  hasVariableQuality,
  ENERGY_REGEN_WINDOW_MIN,
  TRAVEL_COST,
  type ArrivalPrediction,
  type ForecastModel,
  type ItemCategory,
  type ItemRef,
  type NetworthBreakdown,
  type PersonalStatsSubset,
  type UserLogEntry,
  type UserStockHolding,
  type UserTravelStatus,
} from "@torn/shared";
import { tryQuery } from "./db";
import { personalTornClient, serverTornClient } from "./torn";
import { COUNTRY_NAMES } from "./yata";

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

/**
 * Item prices for the home-market sell baseline. Read from the collector's
 * `item_prices` table (the web never calls /torn/items live), with a live fetch
 * only as a cold-start fallback before the collector has populated the table.
 */
export const loadItemPrices = unstable_cache(
  async (): Promise<ItemRef[]> => {
    const rows = await tryQuery<{ item_id: string; name: string; market_value: string; type: string | null }>(
      "select item_id, name, market_value, type from item_prices",
    );
    if (rows && rows.length > 0) {
      return rows.map((r) => ({
        id: Number(r.item_id),
        name: r.name,
        marketValue: Number(r.market_value),
        type: r.type,
      }));
    }
    // Cold start: table not populated yet → one live fetch (needs TORN_API_KEY).
    try {
      return await fetchItems(serverTornClient());
    } catch {
      return [];
    }
  },
  ["finance-item-prices"],
  { revalidate: 300 },
);

interface StockSnapshot {
  countryCode: string;
  /** Unix seconds — source update time of the freshest item in this country. */
  updatedAt: number;
  items: { id: number; quantity: number; cost: number }[];
}

/**
 * Current foreign stock, read from the collector's ledger (latest observation
 * per item) — NOT a live YATA call, so the request path never depends on YATA
 * uptime. Falls back to one live YATA fetch only during cold start, before the
 * collector has recorded anything.
 */
const loadCurrentStock = unstable_cache(
  async (): Promise<StockSnapshot[]> => {
    const rows = await tryQuery<{
      country_code: string;
      item_id: string;
      quantity: number;
      cost: string;
      source_update_ts: string;
    }>(
      `select distinct on (country_code, item_id)
              country_code, item_id, quantity, cost, source_update_ts
         from stock_observations
        order by country_code, item_id, source_update_ts desc`,
    );
    if (rows && rows.length > 0) {
      const byCountry = new Map<string, StockSnapshot>();
      for (const r of rows) {
        const c = byCountry.get(r.country_code) ?? { countryCode: r.country_code, updatedAt: 0, items: [] };
        c.items.push({ id: Number(r.item_id), quantity: Number(r.quantity), cost: Number(r.cost) });
        c.updatedAt = Math.max(c.updatedAt, Number(r.source_update_ts));
        byCountry.set(r.country_code, c);
      }
      return [...byCountry.values()];
    }
    // Cold start: ledger empty (collector not recording yet) → one live fetch.
    const live = await fetchYataExport();
    return live.map((c) => ({
      countryCode: c.countryCode,
      updatedAt: c.updatedAt,
      items: c.items.map((i) => ({ id: i.id, quantity: i.quantity, cost: i.cost })),
    }));
  },
  ["finance-current-stock"],
  { revalidate: 60 },
);

/**
 * Per-item forecast params (written by the collector), as a serializable record
 * keyed "country:item" (a Map wouldn't survive unstable_cache serialization).
 */
const loadForecastParams = unstable_cache(
  async (): Promise<Record<string, ForecastModel>> => {
    const rows = await tryQuery<Record<string, unknown>>("select * from forecast_params");
    const out: Record<string, ForecastModel> = {};
    for (const r of rows ?? []) {
      out[`${r.country_code}:${r.item_id}`] = {
        depletionRatePerMin: Number(r.depletion_rate_per_min),
        rateVar: Number(r.rate_var),
        restockIntervalMin: r.restock_interval_min == null ? null : Number(r.restock_interval_min),
        restockAmount: r.restock_amount == null ? null : Number(r.restock_amount),
        lastRestockTs: r.last_restock_ts == null ? null : Number(r.last_restock_ts),
        sampleCount: Number(r.sample_count),
        spanMinutes: Number(r.span_minutes),
        confidence: Number(r.confidence),
      };
    }
    return out;
  },
  ["finance-forecast-params"],
  { revalidate: 120 },
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

export interface CategoryFlow {
  category: string;
  income: number;
  expense: number;
}

export interface CashflowData {
  weeks: CashflowWeek[];
  /** Per-category income/expense over the window, biggest movers first. */
  byCategory: CategoryFlow[];
  recent: UserLogEntry[];
}

/** Per-day category map stored in the `categories` jsonb: { category: {i, e} }. */
type DayCategories = Record<string, { i: number; e: number }>;

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

    const rows = await tryQuery<Record<string, unknown>>(
      `select extract(epoch from date_trunc('week', day)) as wk,
              income, expense, net, categories
         from user_cashflow_daily
        where member_id = $1 and day > (now() - ($2::int * interval '7 day'))::date
        order by day`,
      [memberId, weeks],
    );

    // Weekly totals.
    const weekMap = new Map<number, CashflowWeek>();
    const catMap = new Map<string, { income: number; expense: number }>();
    for (const r of rows ?? []) {
      const wk = Number(r.wk);
      const w = weekMap.get(wk) ?? { weekStart: wk, income: 0, expense: 0, net: 0 };
      w.income += Number(r.income);
      w.expense += Number(r.expense);
      w.net += Number(r.net);
      weekMap.set(wk, w);

      const cats = (r.categories ?? {}) as DayCategories;
      for (const [cat, v] of Object.entries(cats)) {
        const c = catMap.get(cat) ?? { income: 0, expense: 0 };
        c.income += Number(v.i ?? 0);
        c.expense += Number(v.e ?? 0);
        catMap.set(cat, c);
      }
    }

    const byCategory = [...catMap.entries()]
      .map(([category, v]) => ({ category, income: v.income, expense: v.expense }))
      .sort((a, b) => b.income + b.expense - (a.income + a.expense));

    return {
      weeks: [...weekMap.values()].sort((a, b) => a.weekStart - b.weekStart),
      byCategory,
      recent: log.filter((e) => e.money !== 0).slice(0, 30),
    };
  },
  ["finance-cashflow"],
  { revalidate: 120 },
);
export const loadCashflow = guarded(loadCashflowCached);

/** Aggregate the recent log into per-day rows (with category breakdown) and upsert. */
async function rollupCashflow(memberId: number, log: UserLogEntry[]): Promise<void> {
  const byDay = new Map<string, { income: number; expense: number; categories: DayCategories }>();
  for (const e of log) {
    if (e.money === 0 || !e.timestamp) continue;
    const day = new Date(e.timestamp * 1000).toISOString().slice(0, 10);
    const bucket = byDay.get(day) ?? { income: 0, expense: 0, categories: {} };
    const cat = e.category || "Other";
    const c = bucket.categories[cat] ?? { i: 0, e: 0 };
    if (e.money > 0) { bucket.income += e.money; c.i += e.money; }
    else { bucket.expense += -e.money; c.e += -e.money; }
    bucket.categories[cat] = c;
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
  /** Predicted stock when YOU land (one-way flight away). */
  predictedOnArrival: number;
  /** P(at least a full capacity of units still in stock on arrival), 0..1. */
  pSuccess: number;
  /** 0..1 trust in the forecast (low while history is still accruing). */
  forecastConfidence: number;
  trend: ArrivalPrediction["trend"];
  /** Item category derived from its Torn type (drives the flags below). */
  category: ItemCategory;
  /** Redeemable for Museum points — market margin understates real value. */
  museumValue: boolean;
  /** Random quality on purchase + slow to sell — listed value isn't reliable. */
  variableQuality: boolean;
  /** Restocks off the 15-min cycle — arrival forecast is less trustworthy. */
  irregularRestock: boolean;
  /** Energy deducted on landing at this destination. */
  energyCost: number;
  /** Total nerve the round trip consumes. */
  nerveCost: number;
  /** Round trip exceeds the ~5h energy-regen window (wastes regen). */
  longHaul: boolean;
}

export interface FlyingData {
  rows: FlyingRow[];
  /** Top opportunities right now, ranked by risk-adjusted profit/min. */
  recommendations: FlyingRow[];
  /** Effective capacity used in the math (override ?? detected ?? default). */
  capacity: number;
  /** Manual override in effect, or null if using auto-detect. */
  capacityOverride: number | null;
  /** Auto-detected capacity from perks, or null if unavailable. */
  detectedCapacity: number | null;
  timeReduction: number;
  wallet: number;
  travel: UserTravelStatus | null;
  /** No foreign-stock data available at all (ledger empty and live fetch failed). */
  yataStale: boolean;
  /** Unix seconds of the most recent stock observation, or null if none. */
  stockUpdatedAt: number | null;
  /** True once forecasts are meaningfully confident; false during cold start. */
  forecastReady: boolean;
}

export interface FinancePrefs {
  /** Manual capacity override; null means auto-detect from perks. */
  capacityOverride: number | null;
  timeReduction: number;
}

export async function getFinancePrefs(memberId: number): Promise<FinancePrefs> {
  const rows = await tryQuery<{ travel_capacity: number | null; travel_time_reduction: number }>(
    "select travel_capacity, travel_time_reduction from user_finance_prefs where member_id = $1",
    [memberId],
  );
  const r = rows?.[0];
  return {
    capacityOverride: r && r.travel_capacity != null ? Number(r.travel_capacity) : null,
    timeReduction: r ? Number(r.travel_time_reduction) : 0,
  };
}

const loadFlyingOpportunitiesCached = unstable_cache(
  async (memberId: number, capacityOverride: number | null, timeReduction: number): Promise<FlyingData | null> => {
    const pc = await personalTornClient(memberId);
    if (!pc) return null;

    const [stock, items, travel, money, params, detected] = await Promise.all([
      loadCurrentStock(),
      loadItemPrices(),
      fetchUserTravel(pc.client, nowSec()).catch(() => null),
      fetchUserMoney(pc.client).catch(() => null),
      loadForecastParams(),
      fetchTravelCapacity(pc.client).catch(() => null),
    ]);
    const wallet = money?.wallet ?? 0;
    // Override always wins; else auto-detected from perks; else a sane default.
    const capacity = capacityOverride ?? detected ?? 19;
    const reduction = Math.max(0, Math.min(90, timeReduction)) / 100;

    const priceById = new Map(items.map((it) => [it.id, it.marketValue]));
    const nameById = new Map(items.map((it) => [it.id, it.name]));
    const typeById = new Map(items.map((it) => [it.id, it.type]));
    let maxConfidence = 0;
    let stockUpdatedAt = 0;
    const rows: FlyingRow[] = [];
    for (const country of stock) {
      stockUpdatedAt = Math.max(stockUpdatedAt, country.updatedAt);
      const baseOneWay = FLIGHT_MINUTES[country.countryCode];
      const oneWayMin = baseOneWay ? Math.max(1, Math.round(baseOneWay * (1 - reduction))) : 0;
      const roundTripMin = oneWayMin * 2;
      const cost = TRAVEL_COST[country.countryCode];
      for (const item of country.items) {
        const homePrice = priceById.get(item.id) ?? 0;
        if (homePrice <= 0) continue;
        const profitPerItem = homePrice - item.cost;
        const tripUnits = Math.min(capacity, item.quantity);
        const tripProfit = profitPerItem * tripUnits;
        const costPerTrip = item.cost * tripUnits;
        const model = params[`${country.countryCode}:${item.id}`] ?? null;
        const pred = predictArrival(model, item.quantity, oneWayMin, capacity);
        const category = classifyItem(typeById.get(item.id));
        const irregularRestock = hasIrregularRestock(category);
        // Irregular-restock items (drugs, contraband artifacts) don't follow the
        // 15-min cycle the model assumes — discount our trust so the UI shows
        // them as "warming up" rather than implying a firm prediction.
        const forecastConfidence = irregularRestock ? pred.confidence * 0.4 : pred.confidence;
        maxConfidence = Math.max(maxConfidence, forecastConfidence);
        rows.push({
          countryCode: country.countryCode,
          countryName: COUNTRY_NAMES[country.countryCode] ?? country.countryCode,
          itemId: item.id,
          itemName: nameById.get(item.id) ?? `#${item.id}`,
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
          predictedOnArrival: pred.predictedQty,
          pSuccess: pred.pSuccess,
          forecastConfidence,
          trend: pred.trend,
          category,
          museumValue: hasMuseumValue(category),
          variableQuality: hasVariableQuality(category),
          irregularRestock,
          energyCost: cost?.energyLoss ?? 0,
          nerveCost: cost?.nerve ?? 0,
          longHaul: roundTripMin > ENERGY_REGEN_WINDOW_MIN,
        });
      }
    }
    // Default table ordering: best realized profit per trip first.
    rows.sort((a, b) => b.tripProfit - a.tripProfit);

    // "Right now" = best RISK-ADJUSTED value: profit/min weighted by the
    // probability the run actually survives the flight. Variable-quality items
    // (weapons/armor) are excluded — their listed value isn't achievable, so
    // they'd top the list on paper while being a poor real-world pick.
    const recommendations = rows
      .filter((r) => r.profitPerItem > 0 && r.roundTripMin > 0 && !r.lowStock && !r.variableQuality)
      .sort((a, b) => b.profitPerMin * b.pSuccess - a.profitPerMin * a.pSuccess)
      .slice(0, 6);

    return {
      rows,
      recommendations,
      capacity,
      capacityOverride,
      detectedCapacity: detected,
      timeReduction,
      wallet,
      travel,
      yataStale: stock.length === 0,
      stockUpdatedAt: stockUpdatedAt > 0 ? stockUpdatedAt : null,
      forecastReady: maxConfidence >= 0.3,
    };
  },
  ["finance-flying"],
  { revalidate: 120 },
);
export const loadFlyingOpportunities = guarded(loadFlyingOpportunitiesCached);
