"use client";

import { useMemo, useState } from "react";
import type { Member } from "@torn/shared";
import { Badge, Dot, STATUS_COLOR } from "./ui";
import { Countdown, TimeAgo } from "./Time";

type FilterKey = "all" | "online" | "hospital" | "revivable" | "inactive" | "idle";
type SortKey = "name" | "level" | "status" | "lastAction" | "days";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "online", label: "Active <15m" },
  { key: "hospital", label: "Hospital" },
  { key: "revivable", label: "Needs revive" },
  { key: "idle", label: "Idle (not in OC)" },
  { key: "inactive", label: "Inactive 3d+" },
];

export function MembersTable({
  members,
  now,
  initialFilter = "all",
}: {
  members: Member[];
  now: number;
  initialFilter?: FilterKey;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterKey>(initialFilter);
  const [sort, setSort] = useState<SortKey>("lastAction");
  const [asc, setAsc] = useState(false);

  const rows = useMemo(() => {
    let out = members.slice();
    if (q) out = out.filter((m) => m.name.toLowerCase().includes(q.toLowerCase()));
    out = out.filter((m) => {
      switch (filter) {
        case "online": return now - m.lastActionTs < 15 * 60;
        case "hospital": return m.statusState === "Hospital";
        case "revivable": return m.isRevivable && m.statusState === "Hospital";
        case "idle": return !m.isInOc && m.statusState === "Okay";
        case "inactive": return now - m.lastActionTs > 3 * 86400;
        default: return true;
      }
    });
    const dir = asc ? 1 : -1;
    out.sort((a, b) => {
      switch (sort) {
        case "name": return dir * a.name.localeCompare(b.name);
        case "level": return dir * (a.level - b.level);
        case "status": return dir * a.statusState.localeCompare(b.statusState);
        case "days": return dir * (a.daysInFaction - b.daysInFaction);
        default: return dir * (a.lastActionTs - b.lastActionTs);
      }
    });
    return out;
  }, [members, q, filter, sort, asc, now]);

  const th = (key: SortKey, label: string, extra = "") => (
    <th
      className={`cursor-pointer select-none px-3 py-2 text-left font-medium hover:text-foreground ${extra}`}
      onClick={() => (sort === key ? setAsc(!asc) : (setSort(key), setAsc(false)))}
    >
      {label} {sort === key && (asc ? "▲" : "▼")}
    </th>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name…"
          className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none"
        />
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filter === f.key ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted">{rows.length} shown</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs uppercase text-muted">
            <tr>
              {th("name", "Member")}
              {th("status", "Status")}
              {th("level", "Lvl", "text-right")}
              {th("lastAction", "Last action")}
              {th("days", "Days", "text-right")}
              <th className="px-3 py-2 text-left font-medium">Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const inactive = now - m.lastActionTs > 3 * 86400;
              return (
                <tr key={m.tornId} className="border-t border-border hover:bg-surface-2/50">
                  <td className="px-3 py-2">
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-muted">{m.position}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5">
                      <Dot color={STATUS_COLOR[m.statusState] ?? "#8b94a3"} />
                      {m.statusState}
                      {m.statusUntil && m.statusUntil > now && (
                        <Countdown seconds={m.statusUntil - now} className="text-xs text-muted" />
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.level}</td>
                  <td className={`px-3 py-2 ${inactive ? "text-[#d29922]" : "text-muted"}`}>
                    <TimeAgo since={now - m.lastActionTs} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{m.daysInFaction}</td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap gap-1">
                      {m.isInOc && <Badge color="#a371f7">OC</Badge>}
                      {m.isRevivable && m.statusState === "Hospital" && <Badge color="#f85149">revive</Badge>}
                      {m.isOnWall && <Badge color="#58a6ff">wall</Badge>}
                      {inactive && <Badge color="#d29922">inactive</Badge>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
