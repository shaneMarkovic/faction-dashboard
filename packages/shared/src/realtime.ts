/**
 * Realtime publish/subscribe adapter.
 *
 * The dashboard is overwhelmingly server -> client. We abstract the transport
 * behind this thin interface so the Supabase Realtime implementation can be
 * swapped for Ably (or anything else) without touching call sites — see PLAN §5.
 *
 * Channels are faction-scoped (`faction:{id}:{topic}`); see `channelName`.
 */

import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { FactionId, RealtimeTopic } from "./types";
import { channelName } from "./types";

export interface RealtimeEvent<T = unknown> {
  topic: RealtimeTopic;
  factionId: FactionId;
  /** Event kind within the topic, e.g. "tick", "slot_filled", "status_change". */
  kind: string;
  payload: T;
  ts: number;
}

export interface RealtimePublisher {
  publish<T>(event: RealtimeEvent<T>): Promise<void>;
}

export interface RealtimeSubscriber {
  /** Returns an unsubscribe function. */
  subscribe<T>(
    factionId: FactionId,
    topic: RealtimeTopic,
    handler: (event: RealtimeEvent<T>) => void,
  ): () => void;
}

export type RealtimeAdapter = RealtimePublisher & RealtimeSubscriber;

/**
 * No-op adapter — logs publishes, no-ops subscribes. Used by the collector's
 * `proof` command and in tests before Supabase credentials are wired in.
 */
export class ConsoleRealtimeAdapter implements RealtimeAdapter {
  async publish<T>(event: RealtimeEvent<T>): Promise<void> {
    const ch = channelName(event.factionId, event.topic);
    // eslint-disable-next-line no-console
    console.log(`[realtime] ${ch} <- ${event.kind}`);
  }

  subscribe<T>(): () => void {
    return () => {};
  }
}

/**
 * Supabase Realtime adapter (PLAN §5). Uses Broadcast channels: the collector
 * publishes events, browser clients subscribe. One channel per
 * `faction:{id}:{topic}`. Channels are created lazily and reused.
 *
 * Works in both Node (collector) and the browser (client component), so the
 * same adapter backs both ends. Swap to Ably by writing another class with
 * this same interface — nothing else changes.
 */
export class SupabaseRealtimeAdapter implements RealtimeAdapter {
  private readonly client: SupabaseClient;
  private readonly channels = new Map<string, RealtimeChannel>();

  constructor(url: string, key: string, client?: SupabaseClient) {
    this.client = client ?? createClient(url, key, { realtime: { params: { eventsPerSecond: 10 } } });
  }

  private channel(name: string): RealtimeChannel {
    let ch = this.channels.get(name);
    if (!ch) {
      ch = this.client.channel(name, { config: { broadcast: { self: false } } });
      ch.subscribe();
      this.channels.set(name, ch);
    }
    return ch;
  }

  async publish<T>(event: RealtimeEvent<T>): Promise<void> {
    const name = channelName(event.factionId, event.topic);
    await this.channel(name).send({
      type: "broadcast",
      event: event.kind,
      payload: event,
    });
  }

  subscribe<T>(
    factionId: FactionId,
    topic: RealtimeTopic,
    handler: (event: RealtimeEvent<T>) => void,
  ): () => void {
    const name = channelName(factionId, topic);
    const ch = this.client.channel(name, { config: { broadcast: { self: false } } });
    ch.on("broadcast", { event: "*" }, (msg) => {
      handler(msg.payload as RealtimeEvent<T>);
    }).subscribe();
    this.channels.set(name, ch);
    return () => {
      void this.client.removeChannel(ch);
      this.channels.delete(name);
    };
  }
}
