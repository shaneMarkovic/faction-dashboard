/**
 * Migration runner — `pnpm --filter @torn/collector migrate`.
 *
 * Applies supabase/migrations/*.sql in filename order, tracking applied files
 * in a _migrations table so re-runs are idempotent. Plain and dependency-free;
 * the Supabase CLI can take over later if desired.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, getPool } from "./pool";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, "../../../../supabase/migrations");

async function main(): Promise<void> {
  const pool = getPool();
  await pool.query(
    `create table if not exists _migrations (
       name text primary key,
       applied_at timestamptz not null default now()
     )`,
  );
  // Lock the ledger from Supabase's public REST API (anon key). RLS with no
  // policies denies anon/authenticated; the service-role connection bypasses it.
  await pool.query("alter table _migrations enable row level security");

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const { rowCount } = await pool.query("select 1 from _migrations where name = $1", [file]);
    if (rowCount) {
      console.log(`• ${file} — already applied`);
      continue;
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into _migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`✓ ${file} — applied`);
    } catch (err) {
      await client.query("rollback");
      console.error(`✗ ${file} — failed, rolled back`);
      throw err;
    } finally {
      client.release();
    }
  }
  console.log("Migrations up to date.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closePool);
