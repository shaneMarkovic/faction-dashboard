/**
 * Load adopted/submitted Torn keys from the `api_keys` table (PLAN §6, §10).
 *
 * Keys are stored encrypted (AES-256-GCM) by the web key-submit / gate-adopt
 * path. Here we decrypt them in memory and hand them to the pool builder as
 * raw keys, exactly like env keys — they get probed via /key/info and grouped
 * by faction. A key that fails to decrypt (rotated KEY_ENCRYPTION_KEY, tamper)
 * is skipped with a warning, never fatal.
 */

import type { Pool } from "pg";
import { decryptKey, encryptionKey } from "@torn/shared";

interface ApiKeyRow {
  id: string;
  faction_id: string;
  encrypted_key: Buffer;
}

/** Decrypt every non-revoked stored key into { source, key } raw entries. */
export async function loadDbKeys(pool: Pool): Promise<{ source: string; key: string }[]> {
  let secret: Buffer;
  try {
    secret = encryptionKey();
  } catch (err) {
    console.warn("[config] KEY_ENCRYPTION_KEY missing/invalid — skipping DB keys:", String(err));
    return [];
  }

  let rows: ApiKeyRow[];
  try {
    const res = await pool.query<ApiKeyRow>(
      "select id, faction_id, encrypted_key from api_keys where not revoked",
    );
    rows = res.rows;
  } catch (err) {
    console.warn("[config] could not read api_keys — skipping DB keys:", String(err));
    return [];
  }

  const out: { source: string; key: string }[] = [];
  for (const row of rows) {
    try {
      out.push({ source: `db:api_keys#${row.id}`, key: decryptKey(row.encrypted_key, secret) });
    } catch (err) {
      console.warn(`[config] failed to decrypt api_keys#${row.id} (faction ${row.faction_id}):`, String(err));
    }
  }
  return out;
}
