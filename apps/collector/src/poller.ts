/**
 * Adaptive per-faction pollers (PLAN §6).
 *
 * Each faction gets its own loop per data type. Cadence adapts to activity:
 * a live chain polls fast, an idle faction slows down. The pool's keys are
 * rotated round-robin to spread load across Torn's ~100 req/min-per-key limit.
 *
 * Tier-2 loops (OC, balance) only run when the faction's pool has faction access.
 */

import {
  channelName,
  type ChainSnapshot,
  type RealtimeAdapter,
} from "@torn/shared";
import type { FactionPool, PooledKey } from "./config";
import type { Sink } from "./sink";
import type { WarEnforcer } from "./war/enforcer";
import {
  fetchBalance,
  fetchChain,
  fetchCrimes,
  fetchMembers,
  fetchRankedWars,
} from "@torn/shared";

const SECOND = 1000;

interface Cadence {
  membersMs: number;
  chainActiveMs: number;
  chainIdleMs: number;
  ocMs: number;
  warActiveMs: number;
  warIdleMs: number;
  balanceMs: number;
}

const DEFAULT_CADENCE: Cadence = {
  membersMs: 60 * SECOND,
  chainActiveMs: 10 * SECOND,
  chainIdleMs: 60 * SECOND,
  ocMs: 150 * SECOND,
  warActiveMs: 20 * SECOND,
  warIdleMs: 5 * 60 * SECOND,
  balanceMs: 3 * 60 * SECOND,
};

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Runs all polling loops for a single faction until aborted. */
export class FactionPoller {
  private rr = 0;
  private chainActive = false;
  private warActive = false;

  constructor(
    private readonly pool: FactionPool,
    private readonly sink: Sink,
    private readonly realtime: RealtimeAdapter,
    private readonly enforcer: WarEnforcer | null = null,
    private readonly cadence: Cadence = DEFAULT_CADENCE,
  ) {}

  /** Round-robin a key from the pool to spread rate-limit load. */
  private nextKey(): PooledKey {
    const k = this.pool.keys[this.rr % this.pool.keys.length]!;
    this.rr++;
    return k;
  }

  start(signal: AbortSignal): void {
    const { factionId, tier } = this.pool;
    void this.loop(signal, "members", () => this.cadence.membersMs, async () => {
      const members = await fetchMembers(this.nextKey().client, factionId, nowSec());
      await this.sink.writeMembers(members);
      await this.realtime.publish({
        topic: "members",
        factionId,
        kind: "snapshot",
        payload: { count: members.length },
        ts: nowSec(),
      });
    });

    void this.loop(
      signal,
      "chain",
      () => (this.chainActive ? this.cadence.chainActiveMs : this.cadence.chainIdleMs),
      async () => {
        const chain = await fetchChain(this.nextKey().client, factionId, nowSec());
        this.chainActive = chain.current > 0 && chain.timeout > 0;
        await this.sink.writeChain(chain);
        await this.realtime.publish<ChainSnapshot>({
          topic: "chain",
          factionId,
          kind: "tick",
          payload: chain,
          ts: nowSec(),
        });
      },
    );

    void this.loop(
      signal,
      "wars",
      () => (this.warActive ? this.cadence.warActiveMs : this.cadence.warIdleMs),
      async () => {
        const key = this.nextKey().client;
        const wars = await fetchRankedWars(key, factionId);
        const ts = nowSec();
        const activeWar = wars.find((w) => w.end == null || w.end > ts);
        this.warActive = !!activeWar;
        await this.sink.writeWars(wars);

        // War enforcement: update rules/progress/enemy state while a war is live.
        if (this.enforcer) {
          if (activeWar) {
            // Full tenant: we hold a faction key, so compute per-member caps
            // live from the attack log.
            await this.enforcer.run(key, factionId, activeWar, { liveMembers: true });
          } else {
            await this.enforcer.clear(factionId);
          }
        }

        await this.realtime.publish({
          topic: "war",
          factionId,
          kind: "snapshot",
          payload: { active: this.warActive },
          ts,
        });
      },
    );

    if (tier === "faction") {
      void this.loop(signal, "oc", () => this.cadence.ocMs, async () => {
        const crimes = await fetchCrimes(this.nextKey().client, factionId);
        await this.sink.writeCrimes(crimes);
        await this.realtime.publish({
          topic: "oc",
          factionId,
          kind: "snapshot",
          payload: { count: crimes.length },
          ts: nowSec(),
        });
      });

      void this.loop(signal, "balance", () => this.cadence.balanceMs, async () => {
        const { faction, members } = await fetchBalance(this.nextKey().client, factionId, nowSec());
        await this.sink.writeBalance(faction);
        await this.sink.writeMemberBalances(members);
        await this.realtime.publish({
          topic: "armory",
          factionId,
          kind: "balance",
          payload: faction,
          ts: nowSec(),
        });
      });
    } else {
      console.log(
        `[poller] faction ${factionId}: OC & balance loops disabled (public tier).`,
      );
    }
  }

  /** Generic poll loop: run `task`, log errors but never die, sleep, repeat. */
  private async loop(
    signal: AbortSignal,
    label: string,
    intervalMs: () => number,
    task: () => Promise<void>,
  ): Promise<void> {
    while (!signal.aborted) {
      try {
        await task();
      } catch (err) {
        console.warn(
          `[poller] faction ${this.pool.factionId} ${label} error:`,
          String(err),
        );
      }
      await sleep(intervalMs());
    }
  }
}

export function channelsFor(factionId: number): string[] {
  return (["chain", "oc", "members", "war", "armory"] as const).map((t) =>
    channelName(factionId, t),
  );
}
