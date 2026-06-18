"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { WarRules } from "@/lib/data";
import { saveWarRules } from "@/app/(dash)/war/actions";

const FIELDS: { key: keyof WarRules; label: string; hint: string }[] = [
  { key: "totalScoreTarget", label: "Faction score cap", hint: "Block everyone once reached. 0 = no limit." },
  { key: "perMemberScoreTarget", label: "Per-member score cap", hint: "Block a member at this score. 0 = no limit." },
  { key: "maxAttacksPerMember", label: "Max hits / member", hint: "Block a member at this many war hits. 0 = no limit." },
  { key: "idleMinutesTarget", label: "Idle ≥ (min)", hint: "Only attack idle enemies after this many minutes." },
];

export function WarRulesEditor({ factionId, rules }: { factionId: number; rules: WarRules }) {
  const [vals, setVals] = useState<WarRules>(rules);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const save = () => {
    setMsg(null);
    start(async () => {
      const res = await saveWarRules(factionId, vals);
      setMsg({ text: res.ok ? "Saved ✓ — applies on the next war cycle." : res.error ?? "Failed", ok: res.ok });
      if (res.ok) router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">{f.label}</span>
            <input
              type="number"
              min={0}
              value={vals[f.key]}
              onChange={(e) => setVals({ ...vals, [f.key]: Math.max(0, Number(e.target.value) || 0) })}
              className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none"
            />
            <span className="text-[11px] text-muted">{f.hint}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={pending}
          aria-busy={pending}
          className="xp-btn disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save rules"}
        </button>
        {msg && (
          <span
            role={msg.ok ? "status" : "alert"}
            className={`text-xs ${msg.ok ? "text-[#1d7d2e]" : "text-[#cc0000]"}`}
          >
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
