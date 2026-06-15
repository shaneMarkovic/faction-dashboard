"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FlyingRow } from "@/lib/finance";
import { setTravelCapacity, setTravelTimeReduction } from "@/app/(dash)/finance/actions";
import { fmtDuration, fmtMoney } from "@/lib/format";

type SortKey = "profitPerMin" | "tripProfit" | "profitPerItem" | "roiPct" | "stock";

export function FlyingTable({
  rows,
  capacity,
  timeReduction,
}: {
  rows: FlyingRow[];
  capacity: number;
  timeReduction: number;
}) {
  const [country, setCountry] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("profitPerMin");
  const [asc, setAsc] = useState(false);
  const [cap, setCap] = useState(String(capacity));
  const [red, setRed] = useState(String(timeReduction));
  const [pending, start] = useTransition();
  const router = useRouter();

  const countries = useMemo(
    () => Array.from(new Set(rows.map((r) => r.countryName))).sort(),
    [rows],
  );

  const view = useMemo(() => {
    let out = rows.slice();
    if (country !== "all") out = out.filter((r) => r.countryName === country);
    const dir = asc ? 1 : -1;
    out.sort((a, b) => dir * (a[sort] - b[sort]));
    return out;
  }, [rows, country, sort, asc]);

  const save = (fn: () => Promise<void>) => start(async () => { await fn(); router.refresh(); });
  const saveCap = () => { const n = Number(cap); if (Number.isFinite(n)) save(() => setTravelCapacity(n)); };
  const saveRed = () => { const n = Number(red); if (Number.isFinite(n)) save(() => setTravelTimeReduction(n)); };

  const toggle = (key: SortKey) =>
    sort === key ? setAsc(!asc) : (setSort(key), setAsc(false));

  const th = (key: SortKey, label: string) => (
    <th
      scope="col"
      aria-sort={sort === key ? (asc ? "ascending" : "descending") : "none"}
      className="select-none px-3 py-2 text-right font-medium"
    >
      <button type="button" onClick={() => toggle(key)} className="inline-flex items-center gap-1 hover:text-foreground">
        {label} {sort === key && <span aria-hidden="true">{asc ? "▲" : "▼"}</span>}
      </button>
    </th>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <label className="flex items-center gap-2">
          Country
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="rounded-md border border-border bg-surface-2 px-2 py-1 text-sm text-foreground outline-none"
          >
            <option value="all">All</option>
            {countries.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Capacity
          <input
            type="number" min={1} max={50} value={cap}
            onChange={(e) => setCap(e.target.value)}
            onBlur={saveCap}
            onKeyDown={(e) => e.key === "Enter" && saveCap()}
            className="w-16 rounded-md border border-border bg-surface-2 px-2 py-1 text-sm text-foreground outline-none"
          />
        </label>
        <label className="flex items-center gap-2" title="Flight-time reduction from business class, perks, education, etc.">
          Time −%
          <input
            type="number" min={0} max={90} value={red}
            onChange={(e) => setRed(e.target.value)}
            onBlur={saveRed}
            onKeyDown={(e) => e.key === "Enter" && saveRed()}
            className="w-16 rounded-md border border-border bg-surface-2 px-2 py-1 text-sm text-foreground outline-none"
          />
        </label>
        {pending && <span>saving…</span>}
        <span className="ml-auto">{view.length} items</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs uppercase text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">Item</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Country</th>
              {th("stock", "Stock")}
              <th scope="col" className="px-3 py-2 text-right font-medium">Buy</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Sell</th>
              {th("profitPerItem", "Profit/item")}
              {th("tripProfit", "Trip profit")}
              <th scope="col" className="px-3 py-2 text-right font-medium">Round trip</th>
              {th("profitPerMin", "Profit/min")}
              {th("roiPct", "ROI")}
            </tr>
          </thead>
          <tbody>
            {view.map((r) => {
              const pos = r.profitPerItem >= 0;
              const color = pos ? "#3fb950" : "#f85149";
              return (
                <tr key={`${r.countryCode}-${r.itemId}`} className="border-t border-border hover:bg-surface-2/50">
                  <td className="px-3 py-2">{r.itemName}</td>
                  <td className="px-3 py-2 text-muted">{r.countryName}</td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: r.lowStock ? "#d29922" : "#a4adbb" }}>
                    {r.stock.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.buyPrice)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.homePrice)}</td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color }}>{fmtMoney(r.profitPerItem)}</td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color }}>
                    {fmtMoney(r.tripProfit)}
                    <span className="ml-1 text-xs text-muted">×{r.tripUnits}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{fmtDuration(r.roundTripMin * 60)}</td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color }}>{fmtMoney(r.profitPerMin)}</td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color }}>{r.roiPct.toFixed(0)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
