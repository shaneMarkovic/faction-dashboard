/**
 * Server-only Postgres access for the web app (read side).
 *
 * Reads cached snapshots the collector writes. RLS is bypassed here because
 * the web server uses the connection-string credentials; per-faction access
 * control is enforced at the API/route layer (and will tighten once Supabase
 * Auth + RLS-scoped clients are wired in).
 *
 * Returns null when no connection string is configured or the DB is
 * unreachable, so callers can fall back to a live Torn read.
 */

import "server-only";
import { Pool } from "pg";

function connectionString(): string | undefined {
  const raw = process.env.DATABASE_URL || process.env.SUPABASE_STRING || undefined;
  if (!raw) return undefined;
  // The web app does short, request-scoped queries. Route them through Supabase's
  // TRANSACTION pooler (port 6543), which allows many more concurrent clients,
  // instead of the SESSION pooler (5432) whose ~15-client cap is held by the
  // long-running collector — otherwise key submit / page loads intermittently
  // fail with "Server unavailable". The collector stays on the session pooler
  // (it needs LISTEN/NOTIFY, which the transaction pooler doesn't support).
  // Opt out by setting DB_POOLER=session.
  if (process.env.DB_POOLER !== "session" && raw.includes("pooler.supabase.com:5432")) {
    return raw.replace("pooler.supabase.com:5432", "pooler.supabase.com:6543");
  }
  return raw;
}

let pool: Pool | null = null;
let disabled = false;

export function getPool(): Pool | null {
  if (disabled) return null;
  const cs = connectionString();
  if (!cs) {
    disabled = true;
    return null;
  }
  pool ??= new Pool({
    connectionString: cs,
    ssl: { rejectUnauthorized: false },
    max: 4,
    keepAlive: true, // avoid re-handshaking to eu-west-1 (handshake ~3s)
    idleTimeoutMillis: 30_000, // release pooled clients promptly so others can connect
    connectionTimeoutMillis: 10_000,
  });
  return pool;
}

/**
 * Run a query, returning null (not throwing) if the DB is unavailable.
 *
 * Retries transient failures before giving up: the pooled eu-west-1 connection
 * occasionally cold-starts (handshake ~3s), and a single dropped read would
 * otherwise surface as missing data or a collapsed faction list. Reads are
 * idempotent; the few writes routed through here (key adopt, pg_notify) are
 * safe to retry.
 */
export async function tryQuery<T>(
  text: string,
  params: unknown[] = [],
): Promise<T[] | null> {
  const p = getPool();
  if (!p) return null;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await p.query(text, params);
      return res.rows as T[];
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
  console.warn("[db] query failed after retries, falling back:", String(lastErr));
  return null;
}
