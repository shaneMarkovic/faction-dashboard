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
import { TornClient, fetchKeyInfo, type KeyInfo } from "@torn/shared";

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
