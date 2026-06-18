"use client";

import { useMemo, useState } from "react";
import type { Member } from "@torn/shared";
import { Badge, Dot, ProfileLink, STATUS_COLOR } from "./ui";
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

  const toggle = (key: SortKey) =>
    sort === key ? setAsc(!asc) : (setSort(key), setAsc(false));

  const th = (key: SortKey, label: string, extra = "") => (
    <th
      scope="col"
      aria-sort={sort === key ? (asc ? "ascending" : "descending") : "none"}
      className={`select-none ${extra || "text-left"}`}
    >
      <button
        type="button"
        onClick={() => toggle(key)}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label} {sort === key && <span aria-hidden="true">{asc ? "▲" : "▼"}</span>}
      </button>
    </th>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name…"
          aria-label="Search members by name"
          className="xp-field"
        />
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className="xp-toggle"
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted">{rows.length} shown</span>
      </div>

      <div className="bevel-in overflow-x-auto p-0">
        <table className="xp-table">
          <thead>
            <tr>
              {th("name", "Member")}
              {th("status", "Status")}
              {th("level", "Lvl", "text-right")}
              {th("lastAction", "Last action")}
              {th("days", "Days", "text-right")}
              <th scope="col" className="px-3 py-2 text-left font-medium">Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const inactive = now - m.lastActionTs > 3 * 86400;
              return (
                <tr key={m.tornId}>
                  <td className="px-3 py-2">
                    <div className="font-medium"><ProfileLink id={m.tornId} name={m.name} /></div>
                    <div className="text-xs text-muted">{m.position}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5">
                      <Dot color={STATUS_COLOR[m.statusState] ?? "#606060"} />
                      {m.statusState}
                      {m.statusUntil && m.statusUntil > now && (
                        <Countdown seconds={m.statusUntil - now} className="text-xs text-muted" />
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.level}</td>
                  <td className={`px-3 py-2 ${inactive ? "text-[#b8860b]" : "text-muted"}`}>
                    <TimeAgo since={now - m.lastActionTs} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{m.daysInFaction}</td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap gap-1">
                      {m.isInOc && <Badge color="#6f42c1">OC</Badge>}
                      {m.isRevivable && m.statusState === "Hospital" && <Badge color="#cc0000">revive</Badge>}
                      {m.isOnWall && <Badge color="#0000cc">wall</Badge>}
                      {inactive && <Badge color="#b8860b">inactive</Badge>}
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
