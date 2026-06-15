/**
 * Postgres LISTEN/NOTIFY bridge for instant key pickup.
 *
 * When a member submits a key via the web gate, the web app fires
 * `NOTIFY collector_keys_changed` (see web gate action). The collector listens
 * on a dedicated long-lived connection and reconciles immediately, instead of
 * waiting up to KEY_RECONCILE_MS for the periodic scan (which remains the
 * safety net for any missed signal — e.g. while the collector was down).
 *
 * We use a standalone Client (not a pool client) so holding the connection open
 * for LISTEN doesn't starve the pool, and we auto-reconnect on error.
 */

import { Client } from "pg";
import { connectionString } from "./pool";

export const KEYS_CHANGED_CHANNEL = "collector_keys_changed";
const RECONNECT_MS = 5_000;

/**
 * Start listening for key-change notifications. Returns a stop function.
 * No-op (returns immediately) when no connection string is configured.
 */
export function listenForKeyChanges(onChange: (payload?: string) => void): () => void {
  const cs = connectionString();
  if (!cs) return () => {};

  let client: Client | null = null;
  let closed = false;
  let retry: NodeJS.Timeout | null = null;

  function scheduleReconnect(): void {
    if (closed || retry) return;
    const stale = client;
    client = null;
    try {
      stale?.removeAllListeners();
      void stale?.end();
    } catch {
      /* ignore */
    }
    retry = setTimeout(() => {
      retry = null;
      void connect();
    }, RECONNECT_MS);
  }

  async function connect(): Promise<void> {
    if (closed) return;
    const c = new Client({ connectionString: cs, ssl: { rejectUnauthorized: false }, keepAlive: true });
    client = c;
    c.on("notification", (msg) => onChange(msg.payload ?? undefined));
    c.on("error", (err) => {
      console.warn("[notify] listener connection error:", String(err));
      scheduleReconnect();
    });
    try {
      await c.connect();
      await c.query(`LISTEN ${KEYS_CHANGED_CHANNEL}`);
      console.log(`[notify] listening on "${KEYS_CHANGED_CHANNEL}".`);
    } catch (err) {
      console.warn("[notify] could not start listener:", String(err));
      scheduleReconnect();
    }
  }

  void connect();

  return () => {
    closed = true;
    if (retry) clearTimeout(retry);
    try {
      void client?.end();
    } catch {
      /* ignore */
    }
  };
}
