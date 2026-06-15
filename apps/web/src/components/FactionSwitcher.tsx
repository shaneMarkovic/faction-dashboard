"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FactionSummary } from "@/lib/data";

/**
 * Switches the active faction within a Discord guild (PLAN §3.1). Writes the
 * `faction` cookie and refreshes so every module page picks up the change. A
 * user only sees factions they belong to.
 */
export function FactionSwitcher({
  factions,
  activeId,
}: {
  factions: FactionSummary[];
  activeId: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <select
      aria-label="Active faction"
      aria-busy={pending}
      disabled={pending}
      className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm font-medium outline-none focus-visible:border-muted disabled:opacity-60"
      value={activeId}
      onChange={(e) => {
        const secure = typeof location !== "undefined" && location.protocol === "https:";
        document.cookie =
          `faction=${e.target.value}; path=/; max-age=31536000; SameSite=Lax` +
          (secure ? "; Secure" : "");
        // Wrap the refresh in a transition so the select shows a pending/disabled
        // state during the re-render instead of looking frozen.
        start(() => router.refresh());
      }}
    >
      {factions.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name} [{f.tag}]
        </option>
      ))}
    </select>
  );
}
