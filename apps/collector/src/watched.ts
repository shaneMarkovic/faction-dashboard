/**
 * Watched-faction poller (public-tier scouting).
 *
 * For factions we don't have a key in (e.g. an opponent), we still pull their
 * PUBLIC data via /faction/{id}/... using one of our existing keys. Only the
 * public modules are available: members (status + last action), chain, and
 * ranked wars. OC/balance/news have no {id} variant, so they're omitted.
 */

import {
  fetchChain,
  fetchMembers,
  fetchRankedWars,
  type FactionId,
  type RealtimeAdapter,
  type TornClient,
} from "@torn/shared";
import type { Sink } from "./sink";
import type { WarEnforcer } from "./war/enforcer";

const SECOND = 1000;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class WatchedFactionPoller {
  constructor(
    private readonly factionId: FactionId,
    private readonly client: TornClient,
    private readonly sink: Sink,
    private readonly realtime: RealtimeAdapter,
    private readonly enforcer: WarEnforcer | null = null,
  ) {}

  start(signal: AbortSignal): void {
    const fid = this.factionId;

    void this.loop(signal, "members", 90 * SECOND, async () => {
      const members = await fetchMembers(this.client, fid, nowSec(), true);
      await this.sink.writeMembers(members);
      await this.realtime.publish({ topic: "members", factionId: fid, kind: "snapshot", payload: { count: members.length }, ts: nowSec() });
    });

    void this.loop(signal, "chain", 30 * SECOND, async () => {
      const chain = await fetchChain(this.client, fid, nowSec(), true);
      await this.sink.writeChain(chain);
      await this.realtime.publish({ topic: "chain", factionId: fid, kind: "tick", payload: chain, ts: nowSec() });
    });

    void this.loop(signal, "wars", 30 * SECOND, async () => {
      const wars = await fetchRankedWars(this.client, fid, true);
      await this.sink.writeWars(wars);
      const now = nowSec();
      const activeWar = wars.find((w) => w.end == null || w.end > now);
      // Public-data war enforcement (faction-score cap + activity rule) for a
      // scouted faction — runs with our key. Per-member caps need their key.
      if (this.enforcer) {
        if (activeWar) await this.enforcer.run(this.client, fid, activeWar);
        else await this.enforcer.clear(fid);
      }
      await this.realtime.publish({ topic: "war", factionId: fid, kind: "snapshot", payload: { active: !!activeWar }, ts: now });
    });
  }

  private async loop(signal: AbortSignal, label: string, intervalMs: number, task: () => Promise<void>): Promise<void> {
    while (!signal.aborted) {
      try {
        await task();
      } catch (err) {
        console.warn(`[watch] faction ${this.factionId} ${label} error:`, String(err));
      }
      await sleep(intervalMs);
    }
  }
}
