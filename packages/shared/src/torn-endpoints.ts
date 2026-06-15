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
  KeyInfo,
  Member,
  MemberStatusState,
  OcCrime,
  RankedWar,
  RankedWarReport,
} from "./types";
import type { TornClient } from "./torn-client";

// --- /key/info -------------------------------------------------------------

interface RawKeyInfo {
  info: {
    access: { level: number; type: string; faction: boolean };
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
