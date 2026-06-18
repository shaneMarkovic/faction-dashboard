"use client";

import { useMemo, useState } from "react";
import type { MemberBalance } from "@torn/shared";
import { fmtMoney } from "@/lib/format";
import { ProfileLink } from "./ui";

type SortKey = "money" | "points" | "name";

export function MemberBalancesTable({ balances }: { balances: MemberBalance[] }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("money");
  const [asc, setAsc] = useState(false);

  const rows = useMemo(() => {
    let out = balances.slice();
    if (q) out = out.filter((b) => b.name.toLowerCase().includes(q.toLowerCase()));
    const dir = asc ? 1 : -1;
    out.sort((a, b) => {
      if (sort === "name") return dir * a.name.localeCompare(b.name);
      if (sort === "points") return dir * (a.points - b.points);
      return dir * (a.money - b.money);
    });
    return out;
  }, [balances, q, sort, asc]);

  const totalMoney = balances.reduce((n, b) => n + b.money, 0);
  const loans = balances.filter((b) => b.money < 0);

  const toggle = (key: SortKey) =>
    sort === key ? setAsc(!asc) : (setSort(key), setAsc(false));

  const th = (key: SortKey, label: string, extra = "") => (
    <th
      scope="col"
      aria-sort={sort === key ? (asc ? "ascending" : "descending") : "none"}
      className={`select-none px-3 py-2 font-medium ${extra}`}
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
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search member…"
          aria-label="Search members by name"
          className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm text-foreground outline-none"
        />
        <span>held in vault: {fmtMoney(totalMoney)}</span>
        {loans.length > 0 && <span className="text-[#cc0000]">{loans.length} negative (loans)</span>}
        <span className="ml-auto">{rows.length} members</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs uppercase text-muted">
            <tr>
              {th("name", "Member", "text-left")}
              {th("money", "Balance", "text-right")}
              {th("points", "Points", "text-right")}
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.memberId} className="border-t border-border hover:bg-surface-2/50">
                <td className="px-3 py-2"><ProfileLink id={b.memberId} name={b.name} /></td>
                <td
                  className="px-3 py-2 text-right tabular-nums"
                  style={{ color: b.money < 0 ? "#cc0000" : undefined }}
                >
                  {fmtMoney(b.money)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">
                  {b.points.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
