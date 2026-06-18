"use client";

import { type ReactNode, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FlyingRow } from "@/lib/finance";
import { type FlyingSortKey, setFlyingView, useFlyingView } from "@/lib/flying-view";
import { resetTravelCapacityAuto, setTravelCapacity, setTravelTimeReduction } from "@/app/(dash)/finance/actions";
import { fmtDuration, fmtMoney } from "@/lib/format";

const TREND: Record<string, { sym: string; color: string }> = {
  falling: { sym: "▼", color: "#cc0000" },
  rising: { sym: "▲", color: "#1d7d2e" },
  stable: { sym: "→", color: "#4a4a4a" },
  unknown: { sym: "·", color: "#808080" },
};

function Tag({ color, title, children }: { color: string; title: string; children: ReactNode }) {
  return (
    <span
      title={title}
      className="bevel-out ml-1.5 bg-surface px-1 align-middle text-[10px] font-bold uppercase tracking-wide"
      style={{ color }}
    >
      {children}
    </span>
  );
}

function odds(p: number, confidence: number): { text: string; color: string } {
  if (confidence < 0.3) return { text: "~", color: "#808080" };
  const pct = Math.round(p * 100);
  const color = p >= 0.7 ? "#1d7d2e" : p >= 0.4 ? "#b8860b" : "#cc0000";
  return { text: `${pct}%`, color };
}

export function FlyingTable({
  rows,
  capacity,
  capacityOverride,
  detectedCapacity,
  timeReduction,
}: {
  rows: FlyingRow[];
  capacity: number;
  capacityOverride: number | null;
  detectedCapacity: number | null;
  timeReduction: number;
}) {
  // View state (country/sort/asc/under5h/minOdds) is shared so the AI co-pilot
  // can drive it too — see lib/flying-view.ts.
  const view = useFlyingView();
  const { country, sort, asc, under5h, minOdds } = view;

  const [cap, setCap] = useState(String(capacity));
  const [red, setRed] = useState(String(timeReduction));
  const [pending, start] = useTransition();
  const router = useRouter();

  const countries = useMemo(
    () => Array.from(new Set(rows.map((r) => r.countryName))).sort(),
    [rows],
  );

  const list = useMemo(() => {
    let out = rows.slice();
    if (country !== "all") out = out.filter((r) => r.countryName === country);
    if (under5h) out = out.filter((r) => !r.longHaul);
    // Odds filter only applies once a forecast is confident enough to trust.
    if (minOdds > 0) out = out.filter((r) => r.forecastConfidence >= 0.3 && r.pSuccess >= minOdds);
    const dir = asc ? 1 : -1;
    out.sort((a, b) => dir * (a[sort] - b[sort]));
    return out;
  }, [rows, country, sort, asc, under5h, minOdds]);

  const save = (fn: () => Promise<void>) => start(async () => { await fn(); router.refresh(); });
  const saveCap = () => { const n = Number(cap); if (Number.isFinite(n)) save(() => setTravelCapacity(n)); };
  const useAuto = () => { setCap(String(detectedCapacity ?? capacity)); save(() => resetTravelCapacityAuto()); };
  const saveRed = () => { const n = Number(red); if (Number.isFinite(n)) save(() => setTravelTimeReduction(n)); };
  const presetRed = (n: number) => { setRed(String(n)); save(() => setTravelTimeReduction(n)); };

  const toggle = (key: FlyingSortKey) =>
    sort === key ? setFlyingView({ asc: !asc }) : setFlyingView({ sort: key, asc: false });

  const th = (key: FlyingSortKey, label: string) => (
    <th
      scope="col"
      aria-sort={sort === key ? (asc ? "ascending" : "descending") : "none"}
      className="select-none text-right"
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
            onChange={(e) => setFlyingView({ country: e.target.value })}
            className="xp-field"
          >
            <option value="all">All</option>
            {countries.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2" title="Items you can carry per trip. Auto-detected from your perks; type to override.">
          Capacity
          <input
            type="number" min={1} max={50} value={cap}
            onChange={(e) => setCap(e.target.value)}
            onBlur={saveCap}
            onKeyDown={(e) => e.key === "Enter" && saveCap()}
            className="xp-field w-16"
          />
          {capacityOverride != null ? (
            <span className="text-muted">
              manual{detectedCapacity != null && ` · auto ${detectedCapacity}`}{" "}
              <button type="button" onClick={useAuto} className="text-[#0000cc] hover:underline">use auto</button>
            </span>
          ) : (
            <span className="text-muted">{detectedCapacity != null ? "auto-detected" : "default"}</span>
          )}
        </label>
        <label className="flex items-center gap-2" title="Flight-time reduction from business class, perks, education, etc.">
          Time −%
          <input
            type="number" min={0} max={90} value={red}
            onChange={(e) => setRed(e.target.value)}
            onBlur={saveRed}
            onKeyDown={(e) => e.key === "Enter" && saveRed()}
            className="xp-field w-16"
          />
          <span className="flex gap-1">
            <button type="button" onClick={() => presetRed(0)} className="xp-toggle" title="No reduction (standard flights)">std</button>
            <button type="button" onClick={() => presetRed(30)} className="xp-toggle" title="Private island airstrip ≈ 30%">airstrip</button>
            <button type="button" onClick={() => presetRed(48)} className="xp-toggle" title="Airstrip + “Mailing Yourself Abroad” book (≈48% combined)">+book</button>
          </span>
        </label>
        <label className="flex items-center gap-2" title="Hide destinations whose round trip is over ~5h — they cost energy/nerve and waste regen unless you're stacked or at war.">
          <input type="checkbox" checked={under5h} onChange={(e) => setFlyingView({ under5h: e.target.checked })} />
          Under 5h
        </label>
        <label className="flex items-center gap-2" title="Only show runs whose arrival odds clear this bar (confident forecasts only).">
          Min odds
          <select
            value={String(minOdds)}
            onChange={(e) => setFlyingView({ minOdds: Number(e.target.value) })}
            className="xp-field"
          >
            <option value="0">Any</option>
            <option value="0.4">40%+</option>
            <option value="0.7">70%+</option>
          </select>
        </label>
        {pending && <span>saving…</span>}
        <span className="ml-auto">{list.length} items</span>
      </div>

      <div className="bevel-in max-h-[60vh] overflow-auto">
        <table className="xp-table">
          <thead className="sticky top-0 z-10">
            <tr>
              <th scope="col" className="text-left">Item</th>
              <th scope="col" className="text-left">Country</th>
              {th("stock", "Stock")}
              <th scope="col" className="text-right">Buy</th>
              <th scope="col" className="text-right">Sell</th>
              {th("profitPerItem", "Profit/item")}
              {th("tripProfit", "Trip profit")}
              <th scope="col" className="text-right">Round trip</th>
              {th("predictedOnArrival", "On arrival")}
              <th scope="col" className="text-right" title="Estimated chance a full run is still in stock when you land">Odds</th>
              {th("profitPerHour", "Profit/hr")}
              {th("roiPct", "ROI")}
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const pos = r.profitPerItem >= 0;
              const color = pos ? "#1d7d2e" : "#cc0000";
              return (
                <tr key={`${r.countryCode}-${r.itemId}`}>
                  <td className="px-3 py-2">
                    {r.itemName}
                    {r.museumValue && <Tag color="#6f42c1" title="Redeemable for Museum points — worth more than market margin shows">museum</Tag>}
                    {r.variableQuality && <Tag color="#b8860b" title="Random quality on purchase and slow to sell — listed value isn't reliable">var. quality</Tag>}
                    {r.irregularRestock && <Tag color="#606060" title="Restocks off the 15-min cycle — arrival odds held low">irregular</Tag>}
                  </td>
                  <td className="px-3 py-2 text-muted">
                    {r.countryName}
                    {r.longHaul && <span className="ml-1 text-xs" style={{ color: "#b8860b" }} title={`Over 5h round trip — drain ~${r.energyCost} energy & ${r.nerveCost} nerve before flying or you waste the regen.`}>5h+</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: r.lowStock ? "#b8860b" : "#4a4a4a" }}>
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
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.predictedOnArrival.toLocaleString()}
                    <span className="ml-1" style={{ color: TREND[r.trend]!.color }} title={r.trend}>{TREND[r.trend]!.sym}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: odds(r.pSuccess, r.forecastConfidence).color }}>
                    {odds(r.pSuccess, r.forecastConfidence).text}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color }}>{fmtMoney(r.profitPerHour)}</td>
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
