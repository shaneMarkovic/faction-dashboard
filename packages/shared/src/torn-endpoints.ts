/**
 * Typed Torn v2 faction endpoints used by the collector, with mappers that
 * normalize raw API responses into our shared domain types.
 *
 * Raw response shapes were verified against live API responses (see openapi.json).
 */

import type {
  ChainSnapshot,
  EnemyStatus,
  FactionAttack,
  FactionAccessTier,
  FactionBalance,
  FactionBalances,
  FactionId,
  ItemRef,
  KeyInfo,
  Member,
  MemberStatusState,
  NetworthBreakdown,
  OcCrime,
  PersonalStatsSubset,
  RankedWar,
  RankedWarReport,
  StockRef,
  UserBar,
  UserBars,
  UserInventoryItem,
  UserLogEntry,
  UserMoney,
  UserStockHolding,
  UserTravelStatus,
} from "./types";
import type { TornClient } from "./torn-client";

/** Coerce an unknown API value to a finite number, defaulting to 0. */
function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}

// --- /key/info -------------------------------------------------------------

interface RawKeyInfo {
  info: {
    access: { level: number; type: string; faction: boolean };
    selections?: { user?: string[] };
    user: { id: number; faction_id: number | null };
  };
}

const ACCESS_LEVELS = ["", "Public", "Minimal", "Limited", "Full", "Custom"] as const;

export async function fetchKeyInfo(client: TornClient): Promise<KeyInfo> {
  const { info } = await client.get<RawKeyInfo>("/key/info");
  const level = info.access.level;
  const hasFactionAccess = info.access.faction === true;
  const tier: FactionAccessTier = hasFactionAccess ? "faction" : "public";
  return {
    accessLevel: (ACCESS_LEVELS[level] ?? "Public") as KeyInfo["accessLevel"],
    accessLevelNum: level,
    accessType: info.access.type ?? "",
    userSelections: info.selections?.user ?? [],
    hasFactionAccess,
    tier,
    userId: info.user.id,
    factionId: info.user.faction_id,
  };
}

// --- /faction/basic --------------------------------------------------------

export interface FactionBasic {
  id: FactionId;
  name: string;
  tag: string;
  respect: number;
  members: number;
  capacity: number;
}

interface RawBasic {
  basic: {
    id: number;
    name: string;
    tag: string;
    respect: number;
    members: number;
    capacity: number;
  };
}

export async function fetchFactionBasic(
  client: TornClient,
  /** Pass a faction id to read another faction's public basics. */
  targetFactionId?: FactionId,
): Promise<FactionBasic> {
  const path = targetFactionId ? `/faction/${targetFactionId}/basic` : "/faction/basic";
  const { basic } = await client.get<RawBasic>(path);
  return {
    id: basic.id,
    name: basic.name,
    tag: basic.tag,
    respect: basic.respect,
    members: basic.members,
    capacity: basic.capacity,
  };
}

// --- /faction/chain --------------------------------------------------------

interface RawChain {
  chain: {
    id: number;
    current: number;
    max: number;
    timeout: number;
    modifier: number;
    cooldown: number;
  };
}

export async function fetchChain(
  client: TornClient,
  factionId: FactionId,
  capturedAt: number,
  /** When true, read another faction's public chain via /faction/{id}/chain. */
  byId = false,
): Promise<ChainSnapshot> {
  const { chain } = await client.get<RawChain>(byId ? `/faction/${factionId}/chain` : "/faction/chain");
  return {
    factionId,
    chainId: chain.id || null,
    current: chain.current,
    max: chain.max,
    timeout: chain.timeout,
    secondsLeft: chain.timeout, // just fetched → remaining == timeout
    cooldown: chain.cooldown,
    modifier: chain.modifier,
    capturedAt,
  };
}

// --- /faction/members ------------------------------------------------------

interface RawMember {
  id: number;
  name: string;
  level: number;
  days_in_faction: number;
  last_action: { status: string; timestamp: number; relative: string };
  status: {
    description: string;
    details: string | null;
    state: string;
    color: string;
    until: number | null;
  };
  revive_setting: string;
  position: string;
  is_revivable: boolean;
  is_on_wall: boolean;
  is_in_oc: boolean;
  has_early_discharge: boolean;
}

export async function fetchMembers(
  client: TornClient,
  factionId: FactionId,
  updatedAt: number,
  /** When true, read another faction's public roster via /faction/{id}/members. */
  byId = false,
): Promise<Member[]> {
  const { members } = await client.get<{ members: RawMember[] }>(
    byId ? `/faction/${factionId}/members` : "/faction/members",
  );
  return members.map((m) => ({
    tornId: m.id,
    factionId,
    name: m.name,
    position: m.position,
    level: m.level,
    daysInFaction: m.days_in_faction,
    statusState: m.status.state as MemberStatusState,
    statusUntil: m.status.until,
    statusDescription: m.status.description,
    lastActionTs: m.last_action.timestamp,
    isOnWall: m.is_on_wall,
    isInOc: m.is_in_oc,
    isRevivable: m.is_revivable,
    reviveSetting: m.revive_setting,
    hasEarlyDischarge: m.has_early_discharge,
    updatedAt,
  }));
}

// --- /faction/crimes (Tier 2: needs faction API access) --------------------

interface RawCrimeSlot {
  position: string;
  checkpoint_pass_rate?: number | null;
  user?: { id: number } | null;
  ready_at?: number | null;
}

interface RawCrime {
  id: number;
  name: string;
  difficulty: number;
  status: string;
  ready_at: number | null;
  expired_at: number | null;
  slots: RawCrimeSlot[];
}

export async function fetchCrimes(
  client: TornClient,
  factionId: FactionId,
): Promise<OcCrime[]> {
  const { crimes } = await client.get<{ crimes: RawCrime[] }>("/faction/crimes", {
    cat: "all",
    limit: 100,
  });
  return crimes.map((c) => ({
    id: c.id,
    factionId,
    name: c.name,
    difficulty: c.difficulty,
    status: c.status as OcCrime["status"],
    readyAt: c.ready_at,
    expiredAt: c.expired_at,
    slots: c.slots.map((s) => ({
      position: s.position,
      cpr: s.checkpoint_pass_rate ?? null,
      userId: s.user?.id ?? null,
      readyAt: s.ready_at ?? null,
    })),
  }));
}

// --- /faction/rankedwars ---------------------------------------------------

interface RawRankedWar {
  id: number;
  start: number;
  end: number;
  target: number;
  winner: number;
  factions: { id: number; name: string; score: number; chain: number }[];
}

export async function fetchRankedWars(
  client: TornClient,
  factionId: FactionId,
  /** When true, read another faction's public wars via /faction/{id}/rankedwars. */
  byId = false,
): Promise<RankedWar[]> {
  const { rankedwars } = await client.get<{ rankedwars: RawRankedWar[] }>(
    byId ? `/faction/${factionId}/rankedwars` : "/faction/rankedwars",
  );
  return rankedwars.map((w) => {
    const me = w.factions.find((f) => f.id === factionId);
    const opp = w.factions.find((f) => f.id !== factionId);
    return {
      id: w.id,
      factionId,
      opponentId: opp?.id ?? 0,
      opponentName: opp?.name ?? "Unknown",
      score: me?.score ?? 0,
      opponentScore: opp?.score ?? 0,
      target: w.target,
      start: w.start,
      end: w.end || null,
    };
  });
}

// --- /faction/{warId}/rankedwarreport (per-member score + attacks) ---------

interface RawWarReport {
  rankedwarreport: {
    id: number;
    factions: {
      id: number;
      name: string;
      score: number;
      attacks: number;
      members: { id: number; name: string; attacks: number; score: number }[];
    }[];
  };
}

export async function fetchRankedWarReport(
  client: TornClient,
  warId: number,
): Promise<RankedWarReport> {
  const { rankedwarreport } = await client.get<RawWarReport>(
    `/faction/${warId}/rankedwarreport`,
  );
  return {
    warId: rankedwarreport.id,
    factions: rankedwarreport.factions.map((f) => ({
      id: f.id,
      name: f.name,
      score: f.score,
      attacks: f.attacks,
      members: (f.members ?? []).map((m) => ({
        memberId: m.id,
        name: m.name,
        score: m.score,
        attacks: m.attacks,
      })),
    })),
  };
}

// --- /faction/attacks (live attack log → per-member war contribution) ------

interface RawAttack {
  id: number;
  started: number;
  ended: number;
  attacker: { id: number; name: string; faction: { id: number } | null } | null;
  is_ranked_war: boolean;
  respect_gain: number;
}

export async function fetchFactionAttacks(
  client: TornClient,
  opts: { from?: number; to?: number; limit?: number; sort?: "ASC" | "DESC" } = {},
): Promise<FactionAttack[]> {
  const q: Record<string, string | number> = { limit: opts.limit ?? 100, sort: opts.sort ?? "DESC" };
  if (opts.from) q.from = opts.from;
  if (opts.to) q.to = opts.to;
  const { attacks } = await client.get<{ attacks: RawAttack[] }>("/faction/attacks", q);
  return attacks.map((a) => ({
    id: a.id,
    started: a.started,
    ended: a.ended,
    attackerId: a.attacker?.id ?? null,
    attackerName: a.attacker?.name ?? null,
    attackerFactionId: a.attacker?.faction?.id ?? null,
    isRankedWar: a.is_ranked_war,
    respectGain: a.respect_gain,
  }));
}

// --- /faction/{id}/members (opponent roster → enemy_status) ----------------

export async function fetchEnemyStatuses(
  client: TornClient,
  opponentFactionId: FactionId,
): Promise<EnemyStatus[]> {
  const { members } = await client.get<{ members: RawMember[] }>(
    `/faction/${opponentFactionId}/members`,
  );
  return members.map((m) => ({
    memberId: m.id,
    name: m.name,
    lastActionTs: m.last_action.timestamp,
    state: m.status.state,
  }));
}

// --- /faction/balance (Tier 2: needs faction API access) -------------------

interface RawBalance {
  balance: {
    faction: { money: number; points: number };
    members: { id: number; username: string; money: number; points: number }[];
  };
}

export async function fetchBalance(
  client: TornClient,
  factionId: FactionId,
  updatedAt: number,
): Promise<FactionBalances> {
  const { balance } = await client.get<RawBalance>("/faction/balance");
  return {
    faction: {
      factionId,
      money: balance.faction.money,
      points: balance.faction.points,
      updatedAt,
    },
    members: (balance.members ?? []).map((m) => ({
      factionId,
      memberId: m.id,
      name: m.username,
      money: m.money,
      points: m.points,
    })),
  };
}

// ===========================================================================
// Personal endpoints — read with a member's OWN key (Finance & Flying).
// Shapes verified against openapi.json.
// ===========================================================================

// --- /user/money ----------------------------------------------------------

export async function fetchUserMoney(client: TornClient): Promise<UserMoney> {
  const { money } = await client.get<{ money: Record<string, unknown> }>("/user/money");
  const cityBank = money.city_bank as { amount?: unknown } | null | undefined;
  return {
    wallet: num(money.wallet),
    vault: num(money.vault),
    bank: cityBank && typeof cityBank === "object" ? num(cityBank.amount) : 0,
    cayman: num(money.cayman_bank),
    company: num(money.company),
    points: num(money.points),
    dailyNetworth: num(money.daily_networth),
  };
}

// --- /user/bars -----------------------------------------------------------

export async function fetchUserBars(client: TornClient): Promise<UserBars> {
  const { bars } = await client.get<{ bars: Record<string, unknown> }>("/user/bars");
  const oneBar = (raw: unknown): UserBar => {
    const b = (raw ?? {}) as Record<string, unknown>;
    const current = num(b.current);
    const maximum = num(b.maximum);
    // `full_time` is seconds until full; 0 (or already full) → null.
    const full = b.full_time != null ? num(b.full_time) : null;
    return { current, maximum, fullInSec: full && full > 0 && current < maximum ? full : null };
  };
  return {
    energy: oneBar(bars.energy),
    nerve: oneBar(bars.nerve),
    happy: oneBar(bars.happy),
    life: oneBar(bars.life),
  };
}

// --- /user/personalstats (cat=networth → full net-worth breakdown) ---------

export async function fetchNetworthBreakdown(client: TornClient): Promise<NetworthBreakdown> {
  // cat=networth → personalstats.networth: { total, wallet, vaults, bank,
  // overseas_bank, points, inventory, display_case, bazaar, item_market,
  // property, stock_market, auction_house, bookie, company, enlisted_cars,
  // piggy_bank, pending, loans, unpaid_fees }.
  const body = await client.get<{ personalstats?: { networth?: Record<string, unknown> } }>(
    "/user/personalstats",
    { cat: "networth" },
  );
  const nw = body.personalstats?.networth ?? {};
  const total = num(nw.total);
  const wallet = num(nw.wallet);
  const vault = num(nw.vaults);
  const bank = num(nw.bank);
  const cayman = num(nw.overseas_bank);
  const points = num(nw.points);
  const items = num(nw.inventory);
  const displaycase = num(nw.display_case);
  const itemmarket = num(nw.item_market) + num(nw.bazaar);
  const properties = num(nw.property);
  const stockmarket = num(nw.stock_market);
  const company = num(nw.company);
  const known =
    wallet + vault + bank + cayman + points + items + displaycase + itemmarket + properties + stockmarket + company;
  return {
    total,
    wallet,
    vault,
    bank,
    cayman,
    points,
    items,
    displaycase,
    itemmarket,
    properties,
    stockmarket,
    company,
    other: total - known,
  };
}

// --- /user/travel ----------------------------------------------------------

export async function fetchUserTravel(client: TornClient, nowSec: number): Promise<UserTravelStatus> {
  const { travel } = await client.get<{ travel: Record<string, unknown> }>("/user/travel");
  const arrivalAt = travel.arrival_at != null ? num(travel.arrival_at) : null;
  const dest = (travel.destination as string | null) ?? null;
  const traveling = Boolean(dest) && dest !== "Torn" && (arrivalAt == null || arrivalAt > nowSec);
  return {
    traveling,
    destination: dest && dest !== "Torn" ? dest : null,
    method: (travel.method as string) ?? null,
    departedAt: travel.departed_at != null ? num(travel.departed_at) : null,
    arrivalAt,
    timeLeft:
      arrivalAt != null ? Math.max(0, arrivalAt - nowSec) : travel.time_left != null ? num(travel.time_left) : null,
  };
}

// --- /user/log -------------------------------------------------------------

interface RawLogEntry {
  id?: string | number;
  timestamp?: number;
  details?: { id?: number; title?: string; category?: string };
  data?: Record<string, unknown>;
}

// Signed money classification for a log entry. Torn's `data` object is shaped
// per log type, but the money fields are self-describing, so we classify by
// FIELD NAME rather than guessing from the title. Verified against real
// /user/log data (crime money_gained, mug money_mugged, job pay, shop
// cost_total/cost_each, casino cost, church donated, missions/casino `money`).

/** Fields that move money in/out without being income or expense (skip). */
const TRANSFER_FIELDS = ["deposited", "withdrawn", "balance_before", "balance_after"];
/** Fields whose value is an expense (money leaving you). */
const EXPENSE_FIELDS = ["cost", "donated", "fee", "fees", "bail", "fine", "spent", "upkeep", "paid"];
/** Fields whose value is income (money coming in). */
const INCOME_FIELDS = [
  "money_gained", "money_mugged", "pay", "won", "winnings", "prize", "payout",
  "interest", "reward", "bounty_reward", "received", "sold_for", "money_won", "money_gain",
];
/** Title keywords that make a bare `money` field an expense rather than income. */
const EXPENSE_TITLE = /(buy|bought|spend|spent|cost|bet|lose|lost|bail|fine|fee|donate|deposit)/;

function logMoneyDelta(e: RawLogEntry): number {
  const data = e.data ?? {};
  // Balance moves / transfers are neither income nor expense.
  for (const f of TRANSFER_FIELDS) if (data[f] != null) return 0;
  // Explicit cost fields (most reliable) → expense.
  if (data.cost_total != null) return -Math.abs(num(data.cost_total));
  if (data.cost_each != null && data.quantity != null) {
    return -Math.abs(num(data.cost_each) * num(data.quantity));
  }
  for (const f of EXPENSE_FIELDS) if (data[f] != null) return -Math.abs(num(data[f]));
  for (const f of INCOME_FIELDS) if (data[f] != null) return Math.abs(num(data[f]));
  // Bare `money`: direction from the title (e.g. "Casino win money" = income).
  if (data.money != null) {
    const t = `${e.details?.title ?? ""}`.toLowerCase();
    return EXPENSE_TITLE.test(t) ? -Math.abs(num(data.money)) : Math.abs(num(data.money));
  }
  return 0;
}

export async function fetchUserLog(
  client: TornClient,
  opts: { from?: number; to?: number; limit?: number } = {},
): Promise<UserLogEntry[]> {
  const q: Record<string, string | number> = { limit: opts.limit ?? 100 };
  if (opts.from) q.from = opts.from;
  if (opts.to) q.to = opts.to;
  const { log } = await client.get<{ log?: RawLogEntry[] }>("/user/log", q);
  return (log ?? []).map((e) => ({
    id: String(e.id ?? ""),
    category: String(e.details?.category ?? ""),
    title: String(e.details?.title ?? ""),
    timestamp: num(e.timestamp),
    money: logMoneyDelta(e),
  }));
}

// --- /user/personalstats (stat= → precise named values) --------------------

/** Fetch specific stats by name (≤10). Response: personalstats: [{name,value}]. */
async function fetchStats(client: TornClient, names: string[]): Promise<Record<string, number>> {
  const body = await client.get<{ personalstats?: { name?: string; value?: number }[] }>(
    "/user/personalstats",
    { stat: names.join(",") },
  );
  const out: Record<string, number> = {};
  for (const s of body.personalstats ?? []) if (s.name) out[s.name] = num(s.value);
  return out;
}

export async function fetchUserPersonalStats(client: TornClient): Promise<PersonalStatsSubset> {
  const f = await fetchStats(client, [
    "trades",
    "marketitemsbought",
    "cityitemsbought",
    "itemsboughtabroad",
    "moneymugged",
    "traveltimes",
    "cityfinds",
  ]);
  const sum = (...names: string[]): number | null => {
    let total = 0;
    let found = false;
    for (const n of names) if (f[n] != null) { total += f[n]!; found = true; }
    return found ? total : null;
  };
  return {
    trades: sum("trades"),
    itemsBought: sum("marketitemsbought", "cityitemsbought"),
    itemsBoughtAbroad: sum("itemsboughtabroad"),
    moneyMugged: sum("moneymugged"),
    travelTimes: sum("traveltimes"),
    cityFinds: sum("cityfinds"),
  };
}

/**
 * Historical net worth at a past timestamp (for seeding the history chart).
 * Returns null if unavailable.
 */
export async function fetchHistoricalNetworth(
  client: TornClient,
  timestamp: number,
): Promise<number | null> {
  try {
    const body = await client.get<{ personalstats?: { name?: string; value?: number }[] }>(
      "/user/personalstats",
      { stat: "networth", timestamp },
    );
    const arr = body.personalstats ?? [];
    const hit = arr.find((s) => s.name === "networth") ?? arr[0];
    return hit?.value != null ? num(hit.value) : null;
  } catch {
    return null;
  }
}

// --- /user/inventory -------------------------------------------------------

export async function fetchUserInventory(client: TornClient): Promise<UserInventoryItem[]> {
  const body = await client.get<{ inventory?: { items?: Record<string, unknown>[] } }>("/user/inventory");
  return (body.inventory?.items ?? []).map((it) => ({
    id: num(it.id),
    name: String(it.name ?? ""),
    amount: num(it.amount),
  }));
}

// --- /user/stocks ----------------------------------------------------------

export async function fetchUserStocks(
  client: TornClient,
  ref: Map<number, StockRef>,
): Promise<UserStockHolding[]> {
  const { stocks } = await client.get<{ stocks?: Record<string, unknown>[] }>("/user/stocks");
  return (stocks ?? [])
    .map((s) => {
      const stockId = num(s.id);
      const shares = num(s.shares);
      const meta = ref.get(stockId);
      const bonus = s.bonus as { available?: unknown } | undefined;
      return {
        stockId,
        name: meta?.name ?? `#${stockId}`,
        shares,
        value: Math.round(shares * (meta?.price ?? 0)),
        dividendReady: Boolean(bonus?.available),
      };
    })
    .filter((s) => s.shares > 0);
}

// --- /user?selections=perks → travel capacity (best-effort) ----------------

/** Base travel item capacity before any perks (Torn default). */
export const TRAVEL_BASE_CAPACITY = 5;

/**
 * Detect travel item capacity by parsing the user's perks. The perks selection
 * is a v1 fallback returning freeform strings per category, so this scans every
 * perk line for a travel-CAPACITY bonus (ignoring travel-TIME perks) and adds
 * them to the base. Returns null if perks are unavailable (key lacks the
 * selection) so callers can fall back to a manual value. VERIFY wording vs live.
 */
export async function fetchTravelCapacity(client: TornClient): Promise<number | null> {
  let body: Record<string, unknown>;
  try {
    body = await client.get<Record<string, unknown>>("/user", { selections: "perks" });
  } catch {
    return null;
  }
  // Collect every string from any *_perks array in the response.
  const lines: string[] = [];
  for (const v of Object.values(body)) {
    if (Array.isArray(v)) for (const s of v) if (typeof s === "string") lines.push(s);
  }
  if (lines.length === 0) return null;

  let bonus = 0;
  for (const line of lines) {
    // Travel-capacity perks read like "+ 10 travel capacity" / "travel items".
    // Exclude travel-TIME perks (those mention time/minutes/%).
    if (!/travel/i.test(line)) continue;
    if (!/capac|item/i.test(line)) continue;
    if (/time|minute|%/i.test(line)) continue;
    const m = line.match(/(\d+)/);
    if (m) bonus += Number(m[1]);
  }
  return TRAVEL_BASE_CAPACITY + bonus;
}

// --- /torn/items (reference; any key) → id → ItemRef -----------------------

export async function fetchItems(client: TornClient): Promise<ItemRef[]> {
  const { items } = await client.get<{ items?: Record<string, unknown>[] }>("/torn/items");
  return (items ?? []).map((it) => {
    const value = (it.value as { market_price?: unknown } | undefined) ?? {};
    return {
      id: num(it.id),
      name: String(it.name ?? ""),
      marketValue: num(value.market_price),
      type: (it.type as string) ?? null,
    };
  });
}

// --- /torn/stocks (reference; any key) → id → { name, price } --------------

export async function fetchStocksRef(client: TornClient): Promise<Map<number, StockRef>> {
  const { stocks } = await client.get<{ stocks?: Record<string, unknown>[] }>("/torn/stocks");
  const out = new Map<number, StockRef>();
  for (const s of stocks ?? []) {
    const market = (s.market as { price?: unknown } | undefined) ?? {};
    out.set(num(s.id), { name: String(s.name ?? s.acronym ?? ""), price: num(market.price) });
  }
  return out;
}
