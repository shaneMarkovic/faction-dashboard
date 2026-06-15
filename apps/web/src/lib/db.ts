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
  return process.env.DATABASE_URL || process.env.SUPABASE_STRING || undefined;
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
    max: 4, // Supabase session pooler caps total clients at 15 — share with the collector
    keepAlive: true, // avoid re-handshaking to eu-west-1 (handshake ~3s)
    idleTimeoutMillis: 5 * 60_000, // keep warm connections around
    connectionTimeoutMillis: 10_000,
  });
  return pool;
}

/** Run a query, returning null (not throwing) if the DB is unavailable. */
export async function tryQuery<T>(
  text: string,
  params: unknown[] = [],
): Promise<T[] | null> {
  const p = getPool();
  if (!p) return null;
  try {
    const res = await p.query(text, params);
    return res.rows as T[];
  } catch (err) {
    console.warn("[db] query failed, falling back:", String(err));
    return null;
  }
}
