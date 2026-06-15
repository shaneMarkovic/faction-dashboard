/**
 * Collector configuration & key-pool discovery.
 *
 * Multi-faction by design (PLAN §3.1): any number of Torn API keys can be
 * supplied via env. We probe each with /key/info and group them into pools
 * keyed by the faction the key belongs to — so adding a faction is just
 * adding a key, with zero code change.
 *
 * Recognized env vars (each value is one Torn API key):
 *   - TORN_API_KEY            (legacy / single key)
 *   - TORN_KEY_<ANYTHING>     (e.g. TORN_KEY_MAIN, TORN_KEY_FEEDER, TORN_KEY_1)
 */

import { fetchKeyInfo } from "@torn/shared";
import { TornClient } from "@torn/shared";
import type { FactionAccessTier, FactionId, KeyInfo } from "@torn/shared";

export interface PooledKey {
  /** Env var name the key came from — for logging/debugging. Never the key itself. */
  source: string;
  client: TornClient;
  info: KeyInfo;
}

export interface FactionPool {
  factionId: FactionId;
  /** Best tier available across the pool's keys. */
  tier: FactionAccessTier;
  keys: PooledKey[];
}

/**
 * Faction ids to watch in public-tier (scouting) mode — we have no key in them,
 * but pull their public data via /faction/{id}/... using an existing key.
 * Set WATCH_FACTION_IDS as a comma-separated list (e.g. "14581,9999").
 */
export function watchedFactionIds(env: NodeJS.ProcessEnv = process.env): FactionId[] {
  return (env.WATCH_FACTION_IDS || "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/** Collect raw keys from the environment by naming convention. */
export function discoverRawKeys(env: NodeJS.ProcessEnv = process.env): {
  source: string;
  key: string;
}[] {
  const out: { source: string; key: string }[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (!value) continue;
    if (name === "TORN_API_KEY" || name.startsWith("TORN_KEY_")) {
      out.push({ source: name, key: value.trim() });
    }
  }
  return out;
}

/**
 * Probe every discovered key and build per-faction pools. A key that fails
 * /key/info (revoked, wrong) is skipped with a warning, not fatal.
 *
 * `extraKeys` are raw keys from outside the environment — e.g. member keys
 * adopted via the web gate and loaded from the DB (see db/keys.ts). They are
 * probed and pooled identically to env keys, so a faction with no env key
 * still gets a pool once a member submits one.
 */
export async function buildFactionPools(
  env: NodeJS.ProcessEnv = process.env,
  extraKeys: { source: string; key: string }[] = [],
): Promise<Map<FactionId, FactionPool>> {
  const seen = new Set<string>();
  const raw = [...discoverRawKeys(env), ...extraKeys].filter(({ key }) => {
    if (seen.has(key)) return false; // de-dupe: same key in env and DB
    seen.add(key);
    return true;
  });
  const pools = new Map<FactionId, FactionPool>();

  for (const { source, key } of raw) {
    const client = new TornClient(key);
    let info: KeyInfo;
    try {
      info = await fetchKeyInfo(client);
    } catch (err) {
      console.warn(`[config] key from ${source} failed validation — skipping:`, String(err));
      continue;
    }
    if (info.factionId == null) {
      console.warn(`[config] key from ${source} has no faction — skipping.`);
      continue;
    }

    const existing = pools.get(info.factionId);
    const pooled: PooledKey = { source, client, info };
    if (existing) {
      existing.keys.push(pooled);
      if (info.tier === "faction") existing.tier = "faction";
    } else {
      pools.set(info.factionId, {
        factionId: info.factionId,
        tier: info.tier,
        keys: [pooled],
      });
    }
  }

  return pools;
}
