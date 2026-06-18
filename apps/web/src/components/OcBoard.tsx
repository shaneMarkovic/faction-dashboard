"use client";

import { useMemo, useState } from "react";
import type { Member, OcCrime } from "@torn/shared";
import { Badge, EmptyState, ProfileLink } from "./ui";
import { Countdown } from "./Time";

type StatusFilter = "active" | "recruiting" | "planning" | "ready" | "all";

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "recruiting", label: "Recruiting" },
  { key: "planning", label: "Planning" },
  { key: "ready", label: "Ready" },
  { key: "all", label: "All" },
];

function statusColor(s: string): string {
  if (s === "Recruiting") return "#b8860b";
  if (s === "Planning") return "#0000cc";
  if (s === "Successful") return "#1d7d2e";
  if (s === "Failure") return "#cc0000";
  return "#606060";
}

export function OcBoard({
  crimes,
  members,
  now,
}: {
  crimes: OcCrime[];
  members: Member[];
  now: number;
}) {
  const [filter, setFilter] = useState<StatusFilter>("active");
  const [openSlot, setOpenSlot] = useState<string | null>(null);

  const nameById = useMemo(() => {
    const m = new Map<number, Member>();
    for (const x of members) m.set(x.tornId, x);
    return m;
  }, [members]);

  // Idle candidates: not currently in an OC and Okay.
  const idle = useMemo(
    () => members.filter((m) => !m.isInOc && m.statusState === "Okay").sort((a, b) => b.level - a.level),
    [members],
  );

  const shown = useMemo(() => {
    return crimes
      .filter((c) => {
        switch (filter) {
          case "active": return c.status === "Recruiting" || c.status === "Planning";
          case "recruiting": return c.status === "Recruiting";
          case "planning": return c.status === "Planning";
          case "ready": return c.readyAt != null && c.readyAt <= now;
          default: return true;
        }
      })
      .sort((a, b) => (a.readyAt ?? Infinity) - (b.readyAt ?? Infinity));
  }, [crimes, filter, now]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => (
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
        <span className="ml-auto text-xs text-muted">{idle.length} idle members available</span>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon="🎯" title="No crimes here" hint="Try a different filter, or wait for the collector to pull the OC pipeline." />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {shown.map((c) => {
            const filled = c.slots.filter((s) => s.userId != null).length;
            const ready = c.readyAt != null && c.readyAt <= now;
            const expiringSoon = c.expiredAt != null && c.expiredAt - now < 86400 && c.expiredAt > now;
            return (
              <section key={c.id} className="bevel-out bg-surface p-3">
                <header className="mb-3 flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-xs text-muted">Difficulty {c.difficulty}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge color={statusColor(c.status)}>{c.status}</Badge>
                    {ready && <Badge color="#1d7d2e">ready</Badge>}
                    {expiringSoon && (
                      <Badge color="#cc0000">expires <Countdown seconds={c.expiredAt! - now} /></Badge>
                    )}
                  </div>
                </header>

                <div className="mb-2 text-xs text-muted">
                  {filled}/{c.slots.length} slots filled
                  {c.readyAt != null && !ready && (
                    <> · ready in <Countdown seconds={c.readyAt - now} /></>
                  )}
                </div>

                <ul className="space-y-1.5">
                  {c.slots.map((s, i) => {
                    const member = s.userId != null ? nameById.get(s.userId) : null;
                    const slotKey = `${c.id}:${i}`;
                    if (s.userId != null) {
                      return (
                        <li key={slotKey} className="flex items-center justify-between bevel-in bg-surface-2 px-2 py-1 text-sm">
                          <span className="truncate">
                            <span className="text-muted">{s.position}</span> · <ProfileLink id={s.userId} name={member?.name ?? `#${s.userId}`} />
                          </span>
                          {s.cpr != null && (
                            <span className="shrink-0 text-xs" style={{ color: s.cpr >= 70 ? "#1d7d2e" : s.cpr >= 40 ? "#b8860b" : "#cc0000" }}>
                              {Math.round(s.cpr)}% CPR
                            </span>
                          )}
                        </li>
                      );
                    }
                    return (
                      <li key={slotKey} className="rounded-md border border-dashed border-border px-2.5 py-1.5 text-sm">
                        <button
                          onClick={() => setOpenSlot(openSlot === slotKey ? null : slotKey)}
                          className="flex w-full items-center justify-between text-left"
                        >
                          <span className="text-muted">{s.position} · <span className="text-[#b8860b]">empty</span></span>
                          <span className="text-xs text-[#0000cc]">{openSlot === slotKey ? "hide" : "suggest ▾"}</span>
                        </button>
                        {openSlot === slotKey && (
                          <div className="mt-2 space-y-1 border-t border-border pt-2">
                            <div className="text-xs text-muted">Suggested idle members (highest level first) — assign them in Torn:</div>
                            {idle.slice(0, 6).map((m) => (
                              <div key={m.tornId} className="flex items-center justify-between text-xs">
                                <ProfileLink id={m.tornId} name={m.name} />
                                <span className="text-muted">lvl {m.level}</span>
                              </div>
                            ))}
                            {idle.length === 0 && <div className="text-xs text-muted">No idle members right now.</div>}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
