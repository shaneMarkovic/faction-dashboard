/**
 * Postgres connection pool for the collector.
 *
 * Reads the connection string from DATABASE_URL (preferred) or SUPABASE_STRING.
 * The collector writes server-side via direct Postgres using the service-level
 * credentials in the connection string, so RLS does not apply to its writes.
 */

import { Pool } from "pg";

export function connectionString(env = process.env): string | undefined {
  return env.DATABASE_URL || env.SUPABASE_STRING || undefined;
}

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const cs = connectionString();
    if (!cs) {
      throw new Error("No Postgres connection string (set DATABASE_URL or SUPABASE_STRING).");
    }
    pool = new Pool({
      connectionString: cs,
      // Supabase requires TLS; allow its managed cert chain.
      ssl: { rejectUnauthorized: false },
      // Supabase session pooler caps total clients at 15; leave room for the
      // web app's pool + transient scripts. (For production, the Transaction
      // pooler on port 6543 supports far more concurrent clients.)
      max: 4,
      keepAlive: true,
      idleTimeoutMillis: 5 * 60_000,
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
