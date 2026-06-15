/**
 * Collector entry point — the always-on worker (PLAN §3).
 *
 * Discovers per-faction key pools, then starts adaptive pollers for every
 * faction. Persists to Postgres when a connection string is configured
 * (DATABASE_URL / SUPABASE_STRING), otherwise logs via ConsoleSink. Realtime
 * still uses the no-op adapter until Supabase URL + key are wired in.
 */

import {
  ConsoleRealtimeAdapter,
  SupabaseRealtimeAdapter,
  fetchFactionBasic,
  type FactionId,
  type RealtimeAdapter,
} from "@torn/shared";
import { buildFactionPools, watchedFactionIds, type FactionPool } from "./config";
import { connectionString, getPool } from "./db/pool";
import { loadDbKeys } from "./db/keys";
import { listenForKeyChanges } from "./db/notify";
import { PostgresSink } from "./db/sink";
import { FactionPoller } from "./poller";
import { ConsoleSink, type Sink } from "./sink";
import { TravelStockRecorder } from "./travel-stock";
import { WarEnforcer } from "./war/enforcer";
import { WatchedFactionPoller } from "./watched";

/** How often to re-scan keys and start/stop pollers. 0 disables (scan once). */
function reconcileMs(env = process.env): number {
  const raw = Number(env.KEY_RECONCILE_MS);
  return Number.isFinite(raw) ? raw : 60_000;
}

async function main(): Promise<void> {
  let sink: Sink;
  let pgSink: PostgresSink | null = null;
  let enforcer: WarEnforcer | null = null;
  if (connectionString()) {
    const pool = getPool();
    pgSink = new PostgresSink(pool);
    sink = pgSink;
    enforcer = new WarEnforcer(pool);
    console.log("[collector] persisting to Postgres + war enforcer enabled.");
  } else {
    sink = new ConsoleSink();
    console.log("[collector] no DB configured — logging only.");
  }

  let realtime: RealtimeAdapter;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    realtime = new SupabaseRealtimeAdapter(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
    );
    console.log("[collector] realtime: Supabase broadcast.");
  } else {
    realtime = new ConsoleRealtimeAdapter();
    console.log("[collector] realtime: console (no Supabase URL/key).");
  }

  // One AbortController per running faction so reconcile can stop a single
  // poller (key revoked, or tier changed and it needs restarting) without
  // touching the others. The top-level controller fans out to all of them.
  const top = new AbortController();
  const running = new Map<FactionId, { controller: AbortController; pool: FactionPool }>();

  // Foreign-stock forecasting data engine: global (faction-independent). Records
  // YATA snapshots into the ledger + derives forecast params. Stops on shutdown.
  if (pgSink) new TravelStockRecorder(getPool()).start(top.signal);

  /** Bootstrap the faction row, then start a poller under its own controller. */
  async function startFaction(pool: FactionPool): Promise<void> {
    if (pgSink) {
      try {
        const basic = await fetchFactionBasic(pool.keys[0]!.client);
        await pgSink.ensureFaction(basic);
        console.log(`[collector] faction ${pool.factionId} bootstrapped: ${basic.name} [${basic.tag}]`);
      } catch (err) {
        console.warn(`[collector] faction ${pool.factionId} bootstrap failed:`, String(err));
      }
    }
    const controller = new AbortController();
    top.signal.addEventListener("abort", () => controller.abort());
    console.log(
      `[collector] starting faction ${pool.factionId} (tier ${pool.tier}, ${pool.keys.length} key(s))`,
    );
    new FactionPoller(pool, sink, realtime, enforcer).start(controller.signal);
    running.set(pool.factionId, { controller, pool });
  }

  // Re-scan env + DB keys and reconcile the set of running pollers:
  //   • new faction (e.g. a key adopted via the gate) → start it
  //   • tier changed (public → faction unlocks OC/balance) → restart it
  //   • same tier, keys changed → hot-swap the pool's keys (round-robin sees them)
  //   • faction gone (all keys revoked/invalid) → stop it
  let reconciling = false;
  let pending = false; // a signal that arrived mid-run → run exactly once more
  async function reconcile(): Promise<void> {
    if (reconciling) {
      pending = true;
      return;
    }
    reconciling = true;
    try {
      do {
        pending = false;
        const dbKeys = connectionString() ? await loadDbKeys(getPool()) : [];
        const pools = await buildFactionPools(process.env, dbKeys);

        for (const [fid, pool] of pools) {
          const cur = running.get(fid);
          if (!cur) {
            await startFaction(pool);
          } else if (cur.pool.tier !== pool.tier) {
            console.log(`[collector] faction ${fid} tier ${cur.pool.tier} → ${pool.tier}; restarting poller.`);
            cur.controller.abort();
            running.delete(fid);
            await startFaction(pool);
          } else {
            cur.pool.keys = pool.keys; // hot-swap; FactionPoller reads keys live
          }
        }

        for (const [fid, cur] of running) {
          if (!pools.has(fid)) {
            console.log(`[collector] faction ${fid} has no usable key anymore; stopping poller.`);
            cur.controller.abort();
            running.delete(fid);
          }
        }
      } while (pending);
    } finally {
      reconciling = false;
    }
  }

  await reconcile();

  if (running.size === 0 && !connectionString()) {
    console.error("No usable Torn keys and no DB to watch. Add TORN_API_KEY / TORN_KEY_* to .env.local.");
    process.exit(1);
  }
  if (running.size === 0) {
    console.warn("[collector] no keys yet — waiting for one to be submitted via the dashboard.");
  }

  // Watched factions: public-tier scouting via any existing key. Started once.
  const watched = watchedFactionIds();
  const scoutKey = [...running.values()][0]?.pool.keys[0]?.client ?? null;
  if (watched.length && scoutKey) {
    for (const fid of watched) {
      if (running.has(fid)) continue; // already a full tenant; skip
      if (pgSink) {
        try {
          const basic = await fetchFactionBasic(scoutKey, fid);
          await pgSink.ensureFaction(basic);
          console.log(`[collector] watching faction ${fid} (public): ${basic.name} [${basic.tag}]`);
        } catch (err) {
          console.warn(`[collector] watch bootstrap failed for ${fid}:`, String(err));
        }
      }
      new WatchedFactionPoller(fid, scoutKey, sink, realtime, enforcer).start(top.signal);
    }
  }

  // Periodically re-scan so a key submitted via the dashboard is picked up
  // without a restart.
  let timer: NodeJS.Timeout | null = null;
  const period = reconcileMs();
  if (period > 0) {
    timer = setInterval(() => {
      reconcile().catch((err) => console.warn("[collector] reconcile failed:", String(err)));
    }, period);
    console.log(`[collector] key reconcile every ${Math.round(period / 1000)}s.`);
  }

  // Instant pickup: reconcile the moment the web app signals a key change,
  // rather than waiting for the periodic timer. The timer stays as the backstop
  // for any signal missed while the collector was down.
  const stopListening = listenForKeyChanges((payload) => {
    console.log(`[collector] key-change signal${payload ? ` (faction ${payload})` : ""}; reconciling.`);
    reconcile().catch((err) => console.warn("[collector] reconcile failed:", String(err)));
  });

  const shutdown = () => {
    console.log("\n[collector] shutting down…");
    if (timer) clearInterval(timer);
    stopListening();
    top.abort();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(`[collector] running ${running.size} faction poller(s). Ctrl-C to stop.`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
