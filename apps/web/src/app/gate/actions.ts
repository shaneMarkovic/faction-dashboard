"use server";

import { TornClient, fetchKeyInfo, encryptKey, encryptionKey } from "@torn/shared";
import type { KeyInfo } from "@torn/shared";
import { tryQuery } from "@/lib/db";
import { clearSession, setSession } from "@/lib/session";

/**
 * Validate a submitted Torn API key and, if it belongs to a tracked faction,
 * start a session. The key is used once to call /key/info and then discarded —
 * we never store it. Only the verified Torn id + faction id go into the cookie.
 */
export async function authenticate(
  apiKey: string,
): Promise<{ ok: boolean; error?: string }> {
  const key = (apiKey || "").trim();
  if (!key) return { ok: false, error: "Enter your Torn API key." };

  let info;
  try {
    info = await fetchKeyInfo(new TornClient(key));
  } catch {
    return { ok: false, error: "Invalid key, or Torn API unreachable." };
  }
  if (!info.factionId) {
    return { ok: false, error: "This key isn't tied to a faction." };
  }

  // Allowed = members of any faction this dashboard tracks.
  const rows = await tryQuery<{ id: number; name: string }>(
    "select id, name from factions where id = $1",
    [info.factionId],
  );
  if (rows == null) return { ok: false, error: "Server unavailable. Try again." };
  if (rows.length === 0) {
    return { ok: false, error: "Access denied — your faction isn't part of this dashboard." };
  }

  // If this faction has no usable key in the pool yet and the submitted key
  // grants faction access, adopt it so the collector can start polling.
  await adoptFactionKey(key, info);

  await setSession({ tornId: info.userId, factionId: info.factionId, name: rows[0]!.name });
  return { ok: true };
}

/**
 * Save a faction-access key for a tracked faction that has none yet (PLAN §6,
 * §10). Best-effort: encrypted at rest, never returned to the client, and any
 * failure here is logged but never blocks login. A faction-access key (not a
 * mere public key) is required, since public keys can't serve the private
 * faction endpoints the dashboard runs on.
 */
async function adoptFactionKey(key: string, info: KeyInfo): Promise<void> {
  if (!info.hasFactionAccess || info.factionId == null) return;

  // Does the faction already have a non-revoked faction-access key in the pool?
  const existing = await tryQuery<{ one: number }>(
    "select 1 as one from api_keys where faction_id = $1 and has_faction_access and not revoked limit 1",
    [info.factionId],
  );
  if (existing == null || existing.length > 0) return; // DB down, or already covered.

  let encrypted: Buffer;
  try {
    encrypted = encryptKey(key, encryptionKey());
  } catch (err) {
    console.warn("[gate] cannot encrypt key — KEY_ENCRYPTION_KEY missing/invalid:", String(err));
    return;
  }

  const saved = await tryQuery(
    `insert into api_keys (member_id, faction_id, encrypted_key, access_level, has_faction_access)
     values ($1, $2, $3, $4, true)`,
    [info.userId, info.factionId, encrypted, info.accessLevel],
  );
  if (saved == null) {
    console.warn(`[gate] failed to persist adopted key for faction ${info.factionId}.`);
    return;
  }
  console.log(`[gate] adopted faction-access key for faction ${info.factionId} (member ${info.userId}).`);

  // Nudge the always-on collector to pick up the new key now instead of waiting
  // for its periodic re-scan. Channel matches collector/src/db/notify.ts.
  // Best-effort: if it fails, the collector's interval reconcile still catches it.
  await tryQuery("select pg_notify('collector_keys_changed', $1)", [String(info.factionId)]);
}

export async function logout(): Promise<void> {
  await clearSession();
}
