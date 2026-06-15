"use client";

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

  if (factions.length <= 1) {
    const f = factions[0];
    return (
      <span className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm font-medium">
        {f ? `${f.name} [${f.tag}]` : "—"}
      </span>
    );
  }

  return (
    <select
      className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm font-medium outline-none"
      value={activeId}
      onChange={(e) => {
        document.cookie = `faction=${e.target.value}; path=/; max-age=31536000`;
        router.refresh();
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
