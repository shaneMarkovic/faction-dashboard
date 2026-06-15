import type { NetworthBreakdown as Breakdown } from "@torn/shared";
import { fmtMoney } from "@/lib/format";
import { AreaChart } from "./AreaChart";
import { Panel, ProgressBar } from "./ui";

export interface NetworthHistoryPoint {
  t: number;
  value: number;
}

const ROW_LABELS: { key: keyof Breakdown; label: string }[] = [
  { key: "wallet", label: "Wallet" },
  { key: "bank", label: "Bank" },
  { key: "cayman", label: "Cayman bank" },
  { key: "vault", label: "Vault" },
  { key: "points", label: "Points" },
  { key: "items", label: "Items" },
  { key: "displaycase", label: "Display case" },
  { key: "itemmarket", label: "Item market" },
  { key: "properties", label: "Properties" },
  { key: "stockmarket", label: "Stocks" },
  { key: "company", label: "Company" },
  { key: "other", label: "Other" },
];

export function NetworthBreakdownView({
  breakdown,
  history,
}: {
  breakdown: Breakdown;
  history: NetworthHistoryPoint[];
}) {
  const rows = ROW_LABELS.map((r) => ({ ...r, value: breakdown[r.key] }))
    .filter((r) => r.value !== 0)
    .sort((a, b) => b.value - a.value);

  // AreaChart renders raw values; scale to millions for a readable axis.
  const chartPoints = history.map((p) => ({ t: p.t, value: Math.round(p.value / 1e6) }));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Net worth" className="lg:col-span-1">
          <div className="text-4xl font-bold tabular-nums">{fmtMoney(breakdown.total)}</div>
          <div className="mt-1 text-xs text-muted">{breakdown.total.toLocaleString()} exact</div>
        </Panel>
        <Panel title="History (millions)" className="lg:col-span-2">
          {chartPoints.length >= 2 ? (
            <AreaChart points={chartPoints} color="#3fb950" unit="m" />
          ) : (
            <div className="py-8 text-center text-sm text-muted">
              History builds over time — and seeds from your personal stats on first connect.
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Breakdown">
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center gap-3">
              <div className="w-28 shrink-0 text-sm text-muted">{r.label}</div>
              <div className="flex-1">
                <ProgressBar value={Math.abs(r.value)} max={Math.abs(breakdown.total) || 1} color="#3fb950" />
              </div>
              <div
                className="w-24 shrink-0 text-right text-sm tabular-nums"
                style={{ color: r.value < 0 ? "#f85149" : undefined }}
              >
                {fmtMoney(r.value)}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
