/**
 * Read-only tools for the Flying Co-Pilot, bound to a single member.
 *
 * Two groups (docs/flying-copilot-design.md §8):
 *  - flying/finance: wrap the cached loaders in lib/finance.
 *  - Torn user data: wrap the member's OWN personal key via personalTornClient.
 *
 * Server-only. The personal client is built lazily and memoized per request so
 * several tool calls in one turn share a single decrypt + DB read. Tools never
 * throw to the model — they return a friendly { error } it can relay.
 */

import "server-only";
import { type ToolSet, tool } from "ai";
import { z } from "zod";
import {
  TornApiError,
  fetchNetworthBreakdown,
  fetchStocksRef,
  fetchUserBars,
  fetchUserLog,
  fetchUserMoney,
  fetchUserPersonalStats,
  fetchUserStocks,
  fetchUserTravel,
} from "@torn/shared";
import {
  type FlyingRow,
  getFinancePrefs,
  loadDepartureWindow,
  loadFlyingOpportunities,
} from "@/lib/finance";
import { type PersonalClient, personalTornClient } from "@/lib/torn";

const NO_KEY =
  "The user hasn't connected a Torn finance key (or it can't be read), so this data isn't available. Tell them to connect one on the Finance page.";
const API_FAIL = "The Torn API request failed — suggest trying again in a moment.";
const NO_PERMISSION =
  "The user's finance key is a custom key that doesn't include this particular data selection — this is NOT a Torn outage, and retrying won't help. Tell them to reconnect their finance key on the Finance page with the missing permission enabled. Carry on with whatever else you can answer.";

// Torn app-level error codes that mean a key/permission problem (not an outage).
// 2 = incorrect key, 16 = access level too low / selection not granted.
const KEY_PERMISSION_CODES = new Set([2, 16]);

const SORT_KEYS = ["profitPerHour", "tripProfit", "roiPct", "predictedOnArrival", "pSuccess"] as const;
type SortKey = (typeof SORT_KEYS)[number];

/** Column keys the table itself can sort by (drives set_table_sort). */
const TABLE_SORT_KEYS = [
  "profitPerHour",
  "tripProfit",
  "profitPerItem",
  "roiPct",
  "stock",
  "predictedOnArrival",
] as const;

/**
 * Client-executed tools (no `execute`): the model calls these, the AI SDK
 * forwards them to the browser, and FlyingChat applies them (filter/sort the
 * table, or change a saved travel pref). See docs/flying-copilot-design.md §8.
 */
export const UI_TOOLS: ToolSet = {
  set_table_filter: tool({
    description:
      "Filter the opportunities table the user is looking at. Only include the fields you want to change; omitted fields stay as they are.",
    inputSchema: z.object({
      country: z.string().optional().describe("Country name to focus on, or 'all' to clear the country filter."),
      under5h: z.boolean().optional().describe("Only show round trips under ~5 hours."),
      minOdds: z.number().min(0).max(1).optional().describe("Minimum arrival odds, 0..1 (0 clears the filter)."),
    }),
  }),
  set_table_sort: tool({
    description: "Sort the opportunities table by a column.",
    inputSchema: z.object({
      sortBy: z.enum(TABLE_SORT_KEYS),
      ascending: z.boolean().optional().describe("Ascending order; defaults to descending (highest first)."),
    }),
  }),
  set_capacity: tool({
    description:
      "Change the user's SAVED travel carrying capacity (items per trip), or 'auto' to use the perk-detected value. This persists and recomputes the table.",
    inputSchema: z.object({
      value: z.union([z.number().int().min(1).max(50), z.literal("auto")]),
    }),
  }),
  set_time_reduction: tool({
    description:
      "Change the user's SAVED flight-time reduction percent (0-90, from business class / perks / airstrip). This persists and recomputes the table.",
    inputSchema: z.object({
      percent: z.number().min(0).max(90),
    }),
  }),
};

/** Compact projection of a FlyingRow — only what the model needs to reason. */
function trimRow(r: FlyingRow) {
  return {
    country: r.countryName,
    item: r.itemName,
    stock: r.stock,
    buyPrice: r.buyPrice,
    sellPrice: r.homePrice,
    profitPerItem: r.profitPerItem,
    roiPct: Math.round(r.roiPct),
    roundTripMin: r.roundTripMin,
    tripUnits: r.tripUnits,
    tripProfit: r.tripProfit,
    profitPerHour: r.profitPerHour,
    predictedOnArrival: r.predictedOnArrival,
    pSuccess: Number(r.pSuccess.toFixed(2)),
    forecastConfidence: Number(r.forecastConfidence.toFixed(2)),
    trend: r.trend,
    museumValue: r.museumValue,
    variableQuality: r.variableQuality,
    irregularRestock: r.irregularRestock,
    lowStock: r.lowStock,
    cashLimited: r.cashLimited,
    longHaul: r.longHaul,
    energyCost: r.energyCost,
    nerveCost: r.nerveCost,
  };
}

export function buildFinanceTools(memberId: number): ToolSet {
  let clientPromise: Promise<PersonalClient | null> | null = null;
  const getClient = () => (clientPromise ??= personalTornClient(memberId));

  // Run `fn` with the member's personal Torn client, mapping the two failure
  // modes (no key / API error) to model-readable strings.
  async function withClient<T>(
    fn: (c: PersonalClient) => Promise<T>,
  ): Promise<T | { error: string }> {
    const pc = await getClient();
    if (!pc) return { error: NO_KEY };
    try {
      return await fn(pc);
    } catch (err) {
      // A custom key missing this selection is a permission gap, not an outage —
      // say so plainly so the model doesn't claim "Torn is down / try again".
      if (err instanceof TornApiError && KEY_PERMISSION_CODES.has(err.code)) {
        return { error: NO_PERMISSION };
      }
      return { error: API_FAIL };
    }
  }

  return {
    get_flying_opportunities: tool({
      description:
        "Current foreign buy-and-return trading runs with profit, capacity-adjusted trip profit, and probabilistic arrival odds (pSuccess + forecastConfidence). Use for 'best run', 'is it worth flying to X', and ranking questions.",
      inputSchema: z.object({
        country: z.string().optional().describe("Filter to one country name, e.g. 'Mexico'."),
        sortBy: z.enum(SORT_KEYS).optional().describe("Ranking key; defaults to profitPerHour."),
        minOdds: z.number().min(0).max(1).optional().describe("Only rows with pSuccess >= this (0..1)."),
        maxRoundTripMin: z.number().optional().describe("Only rows whose round trip is <= this many minutes."),
        limit: z.number().min(1).max(20).optional().describe("Max rows to return (default 8)."),
      }),
      execute: async ({ country, sortBy, minOdds, maxRoundTripMin, limit }) => {
        const prefs = await getFinancePrefs(memberId);
        const data = await loadFlyingOpportunities(memberId, prefs.capacityOverride, prefs.timeReduction);
        if (!data) return { error: NO_KEY };

        let rows = data.rows.slice();
        if (country) rows = rows.filter((r) => r.countryName.toLowerCase() === country.toLowerCase());
        if (minOdds != null) rows = rows.filter((r) => r.pSuccess >= minOdds);
        if (maxRoundTripMin != null) rows = rows.filter((r) => r.roundTripMin <= maxRoundTripMin);
        const key: SortKey = sortBy ?? "profitPerHour";
        rows.sort((a, b) => b[key] - a[key]);
        rows = rows.slice(0, limit ?? 8);

        return {
          capacity: data.capacity,
          wallet: data.wallet,
          traveling: data.travel?.traveling ?? false,
          forecastReady: data.forecastReady,
          rows: rows.map(trimRow),
        };
      },
    }),

    get_finance_prefs: tool({
      description:
        "The user's travel settings: carrying capacity (manual override or auto) and flight-time reduction percent.",
      inputSchema: z.object({}),
      execute: async () => {
        const prefs = await getFinancePrefs(memberId);
        return {
          capacityOverride: prefs.capacityOverride,
          timeReductionPct: prefs.timeReduction,
        };
      },
    }),

    get_user_money: tool({
      description: "The user's current money: wallet cash, bank, vault, Cayman, company, and points.",
      inputSchema: z.object({}),
      execute: () => withClient((pc) => fetchUserMoney(pc.client)),
    }),

    get_net_worth: tool({
      description: "The user's net-worth breakdown by category (wallet, bank, items, stocks, property, etc.).",
      inputSchema: z.object({}),
      execute: () => withClient((pc) => fetchNetworthBreakdown(pc.client)),
    }),

    get_travel_status: tool({
      description:
        "Whether the user is currently travelling, the destination, and how long until they land. Returns a clear `status` ('home' | 'travelling' | 'abroad') and `landingInMin` so you never have to interpret raw flags.",
      inputSchema: z.object({}),
      execute: () =>
        withClient(async (pc) => {
          const t = await fetchUserTravel(pc.client, Math.floor(Date.now() / 1000));
          const landingInMin = t.timeLeft != null ? Math.round(t.timeLeft / 60) : null;
          // traveling=false with time left = inbound flight home (Torn reports the
          // return leg without a foreign destination). Make that explicit.
          const status: "home" | "travelling" | "abroad" =
            t.traveling ? "travelling" : landingInMin && landingInMin > 0 ? "travelling" : t.destination ? "abroad" : "home";
          return { ...t, status, landingInMin };
        }),
    }),

    get_user_bars: tool({
      description:
        "The user's current energy, nerve, happy and life bars (current/maximum, and seconds until full). Use this before recommending a run so you can flag when they're short on the energy/nerve a trip costs, or when energy/nerve will overflow during a long haul.",
      inputSchema: z.object({}),
      execute: () => withClient((pc) => fetchUserBars(pc.client)),
    }),

    get_departure_window: tool({
      description:
        "How a specific country+item's arrival odds (pSuccess) change depending on WHEN the user departs. Answers 'is there a better time to fly', 'when will the odds improve', 'when's the next restock'. Returns current odds, the best departure time in the next few hours, minutes to the next restock, and a sampled odds curve. Quote nextRestockInMin and the best departure plainly; respect forecastConfidence (low = warming up, don't over-promise).",
      inputSchema: z.object({
        country: z.string().describe("Country name, e.g. 'China'."),
        item: z.string().describe("Item name (partial ok), e.g. 'Pangolin Scales'."),
      }),
      execute: async ({ country, item }) => {
        const prefs = await getFinancePrefs(memberId);
        const res = await loadDepartureWindow(memberId, country, item, prefs.capacityOverride, prefs.timeReduction);
        if (!res) return { error: NO_KEY };
        if ("notFound" in res) {
          return {
            error: `No current opportunity matches "${item}"${country ? ` in ${country}` : ""}. It may be out of stock or not tracked right now.`,
          };
        }
        return res;
      },
    }),

    get_recent_money_log: tool({
      description:
        "Recent activity-log entries with signed money deltas (income positive, expense negative) — for 'where is my money going' questions.",
      inputSchema: z.object({
        limit: z.number().min(1).max(100).optional().describe("How many recent entries (default 50)."),
      }),
      execute: ({ limit }) => withClient((pc) => fetchUserLog(pc.client, { limit: limit ?? 50 })),
    }),

    get_stock_holdings: tool({
      description: "The user's stock-market holdings: shares, current value, and whether a dividend is ready.",
      inputSchema: z.object({}),
      execute: () =>
        withClient(async (pc) => {
          const ref = await fetchStocksRef(pc.client);
          return fetchUserStocks(pc.client, ref);
        }),
    }),

    get_trading_stats: tool({
      description:
        "The user's lifetime trading-related personal stats (trades, items bought, items bought abroad, money mugged, travel times, city finds).",
      inputSchema: z.object({}),
      execute: () => withClient((pc) => fetchUserPersonalStats(pc.client)),
    }),
  };
}
