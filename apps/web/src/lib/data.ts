/**
 * Web data layer — the single read path for dashboards.
 *
 * Strategy (PLAN §11): prefer cached snapshots from Postgres (fast, written by
 * the collector); if the cache is empty or the DB is unreachable, fall back to
 * a live Torn read so the dashboard still works.
 */

import "server-only";
import { unstable_cache } from "next/cache";
import {
  fetchChain,
  fetchCrimes,
  fetchFactionBasic,
  fetchMembers,
  fetchRankedWars,
  fetchBalance,
  type ChainSnapshot,
  type FactionBalance,
  type Member,
  type MemberBalance,
  type OcCrime,
  type RankedWar,
} from "@torn/shared";
import { tryQuery } from "./db";
import { serverKeyInfo, serverTornClient } from "./torn";

export interface FactionSummary {
  id: number;
  name: string;
  tag: string;
}

export type DataSource = "cache" | "live";

export interface Dashboard {
  faction: FactionSummary;
  source: DataSource;
  tier: "public" | "faction";
  members: Member[];
  chain: ChainSnapshot | null;
  wars: RankedWar[];
  crimes: OcCrime[];
  balance: FactionBalance | null;
  fetchedAt: number;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * The faction roster — HARDCODED on purpose. It barely ever changes, and
 * reading it from the DB on every refresh was collapsing the switcher to a
 * single faction / plain text on any DB blip. To add a faction, add a line here.
 */
const FACTIONS: FactionSummary[] = [
  { id: 34247, name: "Infinite Tim Tams", tag: "ITT" },
  { id: 14581, name: "Happy Vegemites", tag: "HV" },
];

export async function listFactions(): Promise<FactionSummary[]> {
  return FACTIONS;
}

/**
 * Assembled dashboard for a faction. Cached briefly (the collector writes every
 * ~60s) so navigation between pages and realtime refreshes don't re-pay the
 * eu-west-1 round-trips on every request.
 */
export const loadDashboard = unstable_cache(
  async (factionId: number): Promise<Dashboard> => {
    return (await loadFromCache(factionId)) ?? (await loadLive(factionId));
  },
  ["dashboard"],
  { revalidate: 3 }, // short so realtime refreshes pick up the collector's latest
);

// --- Cache (Postgres) path -------------------------------------------------

interface FactionRow { id: number; name: string; tag: string }

async function loadFromCache(factionId: number): Promise<Dashboard | null> {
  const factions = await tryQuery<FactionRow>(
    "select id, name, coalesce(tag,'') as tag from factions where id = $1",
    [factionId],
  );
  if (!factions || factions.length === 0) return null; // DB down or unknown faction
  const faction = { ...factions[0]!, id: Number(factions[0]!.id) };

  const [memberRows, chainRows, warRows, crimeRows, slotRows, balRows] = await Promise.all([
    tryQuery<Record<string, unknown>>(
      "select * from members where faction_id = $1 order by last_action_ts desc",
      [factionId],
    ),
    tryQuery<Record<string, unknown>>(
      `select *, greatest(0, timeout - extract(epoch from (now() - captured_at))) as seconds_left
         from chain_snapshots where faction_id = $1 order by captured_at desc limit 1`,
      [factionId],
    ),
    tryQuery<Record<string, unknown>>("select * from wars where faction_id = $1", [factionId]),
    tryQuery<Record<string, unknown>>("select * from oc_crimes where faction_id = $1", [factionId]),
    tryQuery<Record<string, unknown>>(
      `select s.* from oc_slots s join oc_crimes c on c.id = s.crime_id where c.faction_id = $1 order by s.slot_index`,
      [factionId],
    ),
    tryQuery<Record<string, unknown>>("select * from balances where faction_id = $1", [factionId]),
  ]);

  // No member rows yet → collector hasn't populated; fall back to live.
  if (!memberRows || memberRows.length === 0) return null;

  const members: Member[] = memberRows.map((r) => ({
    tornId: Number(r.torn_id),
    factionId,
    name: String(r.name),
    position: String(r.position ?? ""),
    level: Number(r.level ?? 0),
    daysInFaction: Number(r.days_in_faction ?? 0),
    statusState: String(r.status_state ?? "Okay") as Member["statusState"],
    statusUntil: r.status_until == null ? null : Number(r.status_until),
    statusDescription: String(r.status_description ?? ""),
    lastActionTs: Number(r.last_action_ts ?? 0),
    isOnWall: Boolean(r.is_on_wall),
    isInOc: Boolean(r.is_in_oc),
    isRevivable: Boolean(r.is_revivable),
    reviveSetting: String(r.revive_setting ?? ""),
    hasEarlyDischarge: Boolean(r.has_early_discharge),
    updatedAt: nowSec(),
  }));

  const chain: ChainSnapshot | null = chainRows?.[0]
    ? {
        factionId,
        chainId: chainRows[0].chain_id == null ? null : Number(chainRows[0].chain_id),
        current: Number(chainRows[0].current),
        max: Number(chainRows[0].max),
        timeout: Number(chainRows[0].timeout),
        secondsLeft: Math.round(Number(chainRows[0].seconds_left ?? chainRows[0].timeout)),
        cooldown: Number(chainRows[0].cooldown),
        modifier: Number(chainRows[0].modifier),
        capturedAt: chainRows[0].captured_at
          ? Math.floor(new Date(chainRows[0].captured_at as string).getTime() / 1000)
          : nowSec(),
      }
    : null;

  const wars: RankedWar[] = (warRows ?? []).map((r) => ({
    id: Number(r.id),
    factionId,
    opponentId: Number(r.opponent_id ?? 0),
    opponentName: String(r.opponent_name ?? "Unknown"),
    score: Number(r.score ?? 0),
    opponentScore: Number(r.opponent_score ?? 0),
    target: Number(r.target ?? 0),
    start: Number(r.start_ts ?? 0),
    end: r.end_ts == null ? null : Number(r.end_ts),
  }));

  const slotsByCrime = new Map<number, OcCrime["slots"]>();
  for (const s of slotRows ?? []) {
    const cid = Number(s.crime_id);
    const arr = slotsByCrime.get(cid) ?? [];
    arr.push({
      position: String(s.position),
      cpr: s.cpr == null ? null : Number(s.cpr),
      userId: s.user_id == null ? null : Number(s.user_id),
      readyAt: s.ready_at == null ? null : Number(s.ready_at),
    });
    slotsByCrime.set(cid, arr);
  }
  const crimes: OcCrime[] = (crimeRows ?? []).map((r) => ({
    id: Number(r.id),
    factionId,
    name: String(r.name),
    difficulty: Number(r.difficulty ?? 0),
    status: String(r.status ?? "") as OcCrime["status"],
    readyAt: r.ready_at == null ? null : Number(r.ready_at),
    expiredAt: r.expired_at == null ? null : Number(r.expired_at),
    slots: slotsByCrime.get(Number(r.id)) ?? [],
  }));

  const balance: FactionBalance | null = balRows?.[0]
    ? {
        factionId,
        money: Number(balRows[0].money),
        points: Number(balRows[0].points),
        updatedAt: nowSec(),
      }
    : null;

  // Tier is derivable from the cache: faction-access modules populate only when
  // the collector's key has faction access.
  const tier = balance || crimes.length > 0 ? "faction" : "public";

  return {
    faction,
    source: "cache",
    tier,
    members,
    chain,
    wars,
    crimes,
    balance,
    fetchedAt: nowSec(),
  };
}

// --- Live (Torn) fallback --------------------------------------------------

async function loadLive(factionId: number): Promise<Dashboard> {
  const info = await serverKeyInfo();
  const client = serverTornClient();
  const ts = nowSec();

  // Own faction → private endpoints available. Other faction → public {id} only.
  const isOwn = info.factionId === factionId;
  const tier: "public" | "faction" = isOwn ? info.tier : "public";
  const byId = !isOwn;
  const basic = await fetchFactionBasic(client, isOwn ? undefined : factionId);

  const [members, chain, wars, crimes, balance] = await Promise.all([
    fetchMembers(client, factionId, ts, byId),
    fetchChain(client, factionId, ts, byId),
    fetchRankedWars(client, factionId, byId),
    tier === "faction" ? fetchCrimes(client, factionId) : Promise.resolve<OcCrime[]>([]),
    tier === "faction" ? fetchBalance(client, factionId, ts) : Promise.resolve(null),
  ]);

  return {
    faction: { id: basic.id, name: basic.name, tag: basic.tag },
    source: "live",
    tier,
    members,
    chain,
    wars,
    crimes,
    balance: balance?.faction ?? null,
    fetchedAt: ts,
  };
}

// --- History ----------------------------------------------------------------

export interface ChainPoint {
  t: number;
  value: number;
}

/** Chain `current` over the last N hours, downsampled to one point per minute. */
export const loadChainHistory = unstable_cache(
  async (factionId: number, hours = 12): Promise<ChainPoint[]> => {
    const rows = await tryQuery<{ t: string | number; value: string | number }>(
      `select extract(epoch from date_trunc('minute', captured_at)) as t,
              max(current) as value
         from chain_snapshots
        where faction_id = $1 and captured_at > now() - ($2::int * interval '1 hour')
        group by 1 order by 1`,
      [factionId, hours],
    );
    return (rows ?? []).map((r) => ({ t: Number(r.t), value: Number(r.value) }));
  },
  ["chain-history"],
  { revalidate: 30 },
);

// --- War enforcer reads ----------------------------------------------------

export interface WarRules {
  totalScoreTarget: number;
  perMemberScoreTarget: number;
  maxAttacksPerMember: number;
  idleMinutesTarget: number;
}

export interface WarStateRow {
  active: boolean;
  warId: number | null;
  opponentName: string | null;
  ourScore: number;
  factionBlocked: boolean;
}

export interface MemberProgressRow {
  memberId: number;
  name: string;
  score: number;
  attacks: number;
  blocked: boolean;
  reasons: string[];
}

export const loadWarRules = unstable_cache(async (factionId: number): Promise<WarRules> => {
  const rows = await tryQuery<Record<string, unknown>>(
    "select * from war_rules where faction_id = $1",
    [factionId],
  );
  const r = rows?.[0];
  return {
    totalScoreTarget: Number(r?.total_score_target ?? 0),
    perMemberScoreTarget: Number(r?.per_member_score_target ?? 0),
    maxAttacksPerMember: Number(r?.max_attacks_per_member ?? 0),
    idleMinutesTarget: Number(r?.idle_minutes_target ?? 10),
  };
  // Short TTL: edits show within a few seconds; the collector reads rules
  // straight from the DB so enforcement is never stale.
}, ["war-rules"], { revalidate: 5 });

export const loadWarState = unstable_cache(async (factionId: number): Promise<WarStateRow | null> => {
  const rows = await tryQuery<Record<string, unknown>>(
    "select * from war_state where faction_id = $1",
    [factionId],
  );
  const r = rows?.[0];
  if (!r) return null;
  return {
    active: Boolean(r.active),
    warId: r.war_id == null ? null : Number(r.war_id),
    opponentName: r.opponent_name == null ? null : String(r.opponent_name),
    ourScore: Number(r.our_score ?? 0),
    factionBlocked: Boolean(r.faction_blocked),
  };
}, ["war-state"], { revalidate: 8 });

export const loadMemberProgress = unstable_cache(async (factionId: number): Promise<MemberProgressRow[]> => {
  const rows = await tryQuery<Record<string, unknown>>(
    "select * from member_progress where faction_id = $1 order by score desc",
    [factionId],
  );
  return (rows ?? []).map((r) => ({
    memberId: Number(r.member_id),
    name: String(r.name ?? ""),
    score: Number(r.score ?? 0),
    attacks: Number(r.attacks ?? 0),
    blocked: Boolean(r.blocked),
    reasons: Array.isArray(r.reasons) ? (r.reasons as string[]) : [],
  }));
}, ["member-progress"], { revalidate: 8 });

/**
 * Per-member balances for the Treasury page. Cache-first, live fallback.
 */
export const loadMemberBalances = unstable_cache(async (factionId: number): Promise<MemberBalance[]> => {
  const rows = await tryQuery<Record<string, unknown>>(
    "select * from member_balances where faction_id = $1 order by money desc",
    [factionId],
  );
  if (rows && rows.length > 0) {
    return rows.map((r) => ({
      factionId,
      memberId: Number(r.member_id),
      name: String(r.name ?? ""),
      money: Number(r.money),
      points: Number(r.points),
    }));
  }
  // Live fallback.
  try {
    const info = await serverKeyInfo();
    if (info.tier !== "faction") return [];
    const { members } = await fetchBalance(serverTornClient(), factionId, nowSec());
    return members;
  } catch {
    return [];
  }
}, ["member-balances"], { revalidate: 8 });
