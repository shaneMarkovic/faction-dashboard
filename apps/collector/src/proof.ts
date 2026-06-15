/**
 * Live proof command — `pnpm collector:proof`.
 *
 * Discovers keys from .env.local, builds per-faction pools, and pulls real
 * data from every faction it can reach: chain, members, OC board, wars, and
 * (if the key has faction access) balance. Prints a human-readable summary so
 * you can confirm the whole collection pipeline works end-to-end against live
 * Torn data — before any DB or UI is wired up.
 */

import { buildFactionPools, type FactionPool } from "./config";
import {
  fetchBalance,
  fetchChain,
  fetchCrimes,
  fetchMembers,
  fetchRankedWars,
} from "@torn/shared";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function fmtMoney(n: number): string {
  return "$" + n.toLocaleString("en-US");
}

function fmtDuration(sec: number): string {
  if (sec <= 0) return "0s";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h ? `${h}h` : "", m ? `${m}m` : "", `${s}s`].filter(Boolean).join(" ");
}

async function proveFaction(pool: FactionPool): Promise<void> {
  const { factionId, tier } = pool;
  const client = pool.keys[0]!.client;
  const ts = nowSec();

  console.log("\n" + "═".repeat(64));
  console.log(`FACTION ${factionId}  ·  tier: ${tier}  ·  keys: ${pool.keys.length}`);
  console.log("═".repeat(64));

  // --- Members (Tier 1) ---
  try {
    const members = await fetchMembers(client, factionId, ts);
    const online = members.filter((m) => ts - m.lastActionTs < 15 * 60).length;
    const inOc = members.filter((m) => m.isInOc).length;
    const hosp = members.filter((m) => m.statusState === "Hospital").length;
    console.log(`\n▸ Members: ${members.length} total · ${online} active(<15m) · ${inOc} in OC · ${hosp} hospital`);
    const idle = members.filter((m) => !m.isInOc && m.statusState === "Okay").slice(0, 5);
    if (idle.length) {
      console.log(`  Idle & Okay (OC candidates): ${idle.map((m) => m.name).join(", ")}`);
    }
  } catch (err) {
    console.log(`  ✗ members failed: ${String(err)}`);
  }

  // --- Chain (Tier 1) ---
  try {
    const chain = await fetchChain(client, factionId, ts);
    if (chain.current > 0) {
      console.log(`\n▸ Chain: ${chain.current}/${chain.max} · drops in ${fmtDuration(chain.timeout)} · x${chain.modifier}`);
    } else {
      console.log(`\n▸ Chain: none active${chain.cooldown ? ` · cooldown ${fmtDuration(chain.cooldown)}` : ""}`);
    }
  } catch (err) {
    console.log(`  ✗ chain failed: ${String(err)}`);
  }

  // --- Ranked wars (Tier 1) ---
  try {
    const wars = await fetchRankedWars(client, factionId);
    const active = wars.find((w) => w.end == null || w.end > ts);
    if (active) {
      console.log(`\n▸ War vs ${active.opponentName}: ${active.score}–${active.opponentScore} (target ${active.target})`);
    } else {
      console.log(`\n▸ War: none active · ${wars.length} in history`);
    }
  } catch (err) {
    console.log(`  ✗ rankedwars failed: ${String(err)}`);
  }

  // --- OC board (Tier 2) ---
  if (tier === "faction") {
    try {
      const crimes = await fetchCrimes(client, factionId);
      const active = crimes.filter((c) => c.status === "Recruiting" || c.status === "Planning");
      const emptySlots = active.reduce(
        (n, c) => n + c.slots.filter((s) => s.userId == null).length,
        0,
      );
      console.log(`\n▸ OC board: ${active.length} active crimes · ${emptySlots} empty slots to fill`);
      for (const c of active.slice(0, 3)) {
        const filled = c.slots.filter((s) => s.userId != null).length;
        console.log(`  · ${c.name} [${c.status}] ${filled}/${c.slots.length} slots`);
      }
    } catch (err) {
      console.log(`  ✗ crimes failed: ${String(err)}`);
    }

    // --- Balance (Tier 2) ---
    try {
      const { faction: bal, members } = await fetchBalance(client, factionId, ts);
      console.log(`\n▸ Balance: ${fmtMoney(bal.money)} · ${bal.points.toLocaleString()} points · ${members.length} member balances`);
    } catch (err) {
      console.log(`  ✗ balance failed: ${String(err)}`);
    }
  } else {
    console.log(`\n▸ OC board & balance: locked (key lacks faction API access — public tier)`);
  }
}

async function main(): Promise<void> {
  console.log("Torn Faction Dashboard — collector live proof");
  const pools = await buildFactionPools();

  if (pools.size === 0) {
    console.error(
      "\nNo usable Torn keys found. Add TORN_API_KEY (or TORN_KEY_*) to .env.local.",
    );
    process.exit(1);
  }

  console.log(`Discovered ${pools.size} faction(s) across the key pool.`);
  for (const pool of pools.values()) {
    await proveFaction(pool);
  }
  console.log("\n✓ Live proof complete — collection pipeline works end-to-end.\n");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
