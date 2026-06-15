/**
 * Domain types for the Torn Faction Dashboard.
 *
 * These mirror the subset of the Torn API v2 responses (see openapi.json) that
 * the dashboard consumes, normalized into our own snake_case DB-friendly shapes.
 * Keep these as the single source of truth shared by the collector and the web app.
 */

/** Torn faction id — the unit of tenancy. */
export type FactionId = number;

/** Torn user/member id. */
export type TornUserId = number;

// ---------------------------------------------------------------------------
// Key access tiers — drives which modules light up per faction.
// Derived from `GET /key/info` -> access.level + access.faction.
// ---------------------------------------------------------------------------

/** Torn API key access levels as returned by /key/info. */
export type KeyAccessLevel =
  | "Public" // level 1
  | "Minimal" // level 2
  | "Limited" // level 3
  | "Full" // level 4
  | "Custom"; // level 5

/**
 * What a key can serve for a faction.
 * - `public`: any member's key — members grid, chain, war scores.
 * - `faction`: key-owner's position has faction API access — adds OC board, balance, news.
 */
export type FactionAccessTier = "public" | "faction";

export interface KeyInfo {
  accessLevel: KeyAccessLevel;
  /** Numeric level from the API (1-5). */
  accessLevelNum: number;
  /** True when the key has faction API access permissions. */
  hasFactionAccess: boolean;
  tier: FactionAccessTier;
  userId: TornUserId;
  factionId: FactionId | null;
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export type MemberStatusState =
  | "Okay"
  | "Hospital"
  | "Traveling"
  | "Jail"
  | "Federal"
  | "Fallen"
  | "Abroad";

export interface Member {
  tornId: TornUserId;
  factionId: FactionId;
  name: string;
  position: string;
  level: number;
  daysInFaction: number;
  statusState: MemberStatusState;
  /** Unix seconds when the current status ends (hospital/jail/travel), or null. */
  statusUntil: number | null;
  statusDescription: string;
  lastActionTs: number;
  isOnWall: boolean;
  isInOc: boolean;
  isRevivable: boolean;
  reviveSetting: string;
  hasEarlyDischarge: boolean;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Chain
// ---------------------------------------------------------------------------

export interface ChainSnapshot {
  factionId: FactionId;
  chainId: number | null;
  current: number;
  max: number;
  /** Seconds until the chain breaks, as measured at capture time. */
  timeout: number;
  /** Remaining seconds adjusted for how stale the snapshot is (server-computed). */
  secondsLeft: number;
  /** Seconds of cooldown after a chain, 0 when none. */
  cooldown: number;
  modifier: number;
  capturedAt: number;
}

// ---------------------------------------------------------------------------
// Organized Crimes (OC 2.0)
// ---------------------------------------------------------------------------

export type OcStatus =
  | "Recruiting"
  | "Planning"
  | "Successful"
  | "Failure"
  | "Expired";

export interface OcSlot {
  position: string;
  /** Checkpoint pass rate for the assigned/idle member, 0-100. */
  cpr: number | null;
  userId: TornUserId | null;
  /** When this slot's member will be ready, unix seconds. */
  readyAt: number | null;
}

export interface OcCrime {
  id: number;
  factionId: FactionId;
  name: string;
  difficulty: number;
  status: OcStatus;
  readyAt: number | null;
  expiredAt: number | null;
  slots: OcSlot[];
}

// ---------------------------------------------------------------------------
// Wars
// ---------------------------------------------------------------------------

export interface RankedWar {
  id: number;
  factionId: FactionId;
  opponentId: FactionId;
  opponentName: string;
  score: number;
  opponentScore: number;
  target: number;
  start: number;
  end: number | null;
}

// ---------------------------------------------------------------------------
// War enforcer
// ---------------------------------------------------------------------------

export interface WarMemberReport {
  memberId: TornUserId;
  name: string;
  score: number;
  attacks: number;
}

export interface RankedWarReport {
  warId: number;
  factions: {
    id: FactionId;
    name: string;
    score: number;
    attacks: number;
    members: WarMemberReport[];
  }[];
}

export interface EnemyStatus {
  memberId: TornUserId;
  name: string;
  lastActionTs: number;
  state: string;
}

export interface FactionAttack {
  id: number;
  started: number;
  ended: number;
  attackerId: TornUserId | null;
  attackerName: string | null;
  attackerFactionId: FactionId | null;
  isRankedWar: boolean;
  respectGain: number;
}

// ---------------------------------------------------------------------------
// Balance
// ---------------------------------------------------------------------------

export interface FactionBalance {
  factionId: FactionId;
  money: number;
  points: number;
  updatedAt: number;
}

export interface MemberBalance {
  factionId: FactionId;
  memberId: TornUserId;
  name: string;
  money: number;
  points: number;
}

/** Full balance read: faction totals + per-member breakdown (one API call). */
export interface FactionBalances {
  faction: FactionBalance;
  members: MemberBalance[];
}

// ---------------------------------------------------------------------------
// Realtime channel naming — faction-scoped so tenants never cross streams.
// ---------------------------------------------------------------------------

export type RealtimeTopic = "chain" | "oc" | "members" | "war" | "armory";

export function channelName(factionId: FactionId, topic: RealtimeTopic): string {
  return `faction:${factionId}:${topic}`;
}
