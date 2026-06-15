/**
 * Server-only Torn access for the web app.
 *
 * Used for "live" reads when the Postgres cache is empty/unavailable (e.g.
 * before the collector has populated the DB). Once the collector is writing
 * to Supabase, the data layer prefers the cached DB rows — see data.ts.
 *
 * The key never reaches the client: this module is imported only by server
 * components / server actions.
 */

import "server-only";
import { TornClient, decryptKey, encryptionKey, fetchKeyInfo, type KeyInfo } from "@torn/shared";
import { tryQuery } from "./db";

let cachedClient: TornClient | null = null;
let cachedKeyInfo: Promise<KeyInfo> | null = null;

export function serverTornClient(): TornClient {
  const key = process.env.TORN_API_KEY;
  if (!key) throw new Error("TORN_API_KEY is not set");
  cachedClient ??= new TornClient(key);
  return cachedClient;
}

/** Cached /key/info for the server key — used to default the active faction. */
export function serverKeyInfo(): Promise<KeyInfo> {
  cachedKeyInfo ??= fetchKeyInfo(serverTornClient());
  return cachedKeyInfo;
}

export interface PersonalClient {
  client: TornClient;
  keyId: number;
  accessLevel: string;
}

/**
 * Build a TornClient from a member's stored PERSONAL finance key (Finance &
 * Flying), or null when they haven't connected one / the key can't be decrypted
 * (rotated KEY_ENCRYPTION_KEY, tamper). NOT cached across requests: the
 * plaintext key lives only for the duration of the call and never leaves this
 * server module.
 */
export async function personalTornClient(memberId: number): Promise<PersonalClient | null> {
  const rows = await tryQuery<{ id: string; encrypted_key: Buffer; access_level: string }>(
    `select id, encrypted_key, access_level from api_keys
       where member_id = $1 and purpose = 'personal' and not revoked limit 1`,
    [memberId],
  );
  if (!rows || rows.length === 0) return null;
  try {
    const key = decryptKey(rows[0]!.encrypted_key, encryptionKey());
    return { client: new TornClient(key), keyId: Number(rows[0]!.id), accessLevel: rows[0]!.access_level };
  } catch {
    return null;
  }
}
