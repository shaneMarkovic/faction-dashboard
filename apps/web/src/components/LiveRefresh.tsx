"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SupabaseRealtimeAdapter, type RealtimeTopic } from "@torn/shared";
import { browserSupabase } from "@/lib/supabase-browser";

const TOPICS: RealtimeTopic[] = ["chain", "oc", "members", "war", "armory"];

/**
 * Subscribes to the active faction's realtime channels and re-fetches the
 * server-rendered dashboard (router.refresh) shortly after any event — so the
 * cached data on screen stays live without polling. Debounced so a burst of
 * events (e.g. many hits during a chain) triggers a single refresh.
 */
export function LiveRefresh({ factionId }: { factionId: number }) {
  const router = useRouter();
  const [live, setLive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connected = useRef(0);

  useEffect(() => {
    const sb = browserSupabase();
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 400);
    };

    // Safety-net poll: keep data fresh even if the realtime socket is blocked
    // (Torn/Supabase CSP) or no events fire. Cheap — reads the short-TTL cache.
    const poll = setInterval(refresh, 15_000);
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);

    let unsubs: Array<() => void> = [];
    if (sb) {
      const rt = new SupabaseRealtimeAdapter("", "", sb);
      // "live" reflects ACTUAL channel connectivity: green only once at least
      // one channel is subscribed, back to offline if all drop.
      const onStatus = (ok: boolean) => {
        connected.current = Math.max(0, connected.current + (ok ? 1 : -1));
        setLive(connected.current > 0);
      };
      unsubs = TOPICS.map((t) => rt.subscribe(factionId, t, refresh, { onStatus }));
    }

    return () => {
      if (timer.current) clearTimeout(timer.current);
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      unsubs.forEach((u) => u());
      connected.current = 0;
      setLive(false);
    };
  }, [factionId, router]);

  return (
    <span className="flex items-center gap-1.5 text-xs text-muted">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: live ? "#1d7d2e" : "#606060" }}
      />
      {live ? "live" : "offline"}
    </span>
  );
}
