import { redirect } from "next/navigation";
import { FlyingTable } from "@/components/FlyingTable";
import { TimeAgo } from "@/components/Time";
import { Badge, EmptyState, Panel } from "@/components/ui";
import { fmtDuration, fmtMoney } from "@/lib/format";
import { getFinancePrefs, loadFlyingOpportunities, type FlyingRow } from "@/lib/finance";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

function RunCard({ row, rank }: { row: FlyingRow; rank: number }) {
  const oddsColor = row.forecastConfidence < 0.3 ? "#8b94a3" : row.pSuccess >= 0.7 ? "#3fb950" : row.pSuccess >= 0.4 ? "#d29922" : "#f85149";
  const oddsText = row.forecastConfidence < 0.3 ? "warming up" : `${Math.round(row.pSuccess * 100)}% still stocked on arrival`;
  return (
    <div className="rounded-xl border border-border bg-surface-2/40 p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted">#{rank} · {row.countryName}</div>
        <div className="text-xs tabular-nums text-muted">{fmtDuration(row.roundTripMin * 60)} round trip</div>
      </div>
      <div className="mt-1 font-semibold">{row.itemName}</div>
      <div className="mt-2 flex items-end justify-between">
        <div>
          <div className="text-lg font-bold tabular-nums text-[#3fb950]">{fmtMoney(row.profitPerMin)}/min</div>
          <div className="text-xs text-muted">{fmtMoney(row.tripProfit)} per trip ({row.tripUnits} items)</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {row.cashLimited && <Badge color="#d29922" title={`A full trip costs ${fmtMoney(row.costPerTrip)}`}>need cash</Badge>}
          {row.lowStock && <Badge color="#f85149">low stock</Badge>}
        </div>
      </div>
      <div className="mt-2 border-t border-border pt-2 text-xs" style={{ color: oddsColor }}>
        ~{row.predictedOnArrival.toLocaleString()} left · {oddsText}
      </div>
    </div>
  );
}

export default async function FlyingPage() {
  const session = await getSession();
  if (!session) redirect("/gate");

  const prefs = await getFinancePrefs(session.tornId);
  const data = await loadFlyingOpportunities(session.tornId, prefs.capacity, prefs.timeReduction);

  const stockSince = data?.stockUpdatedAt ? Math.max(0, Math.floor(Date.now() / 1000) - data.stockUpdatedAt) : null;
  const stockAbsolute = data?.stockUpdatedAt ? new Date(data.stockUpdatedAt * 1000).toLocaleString() : null;

  if (!data) {
    return (
      <Panel>
        <EmptyState
          icon="🔌"
          title="Couldn’t reach your finance data"
          hint="Temporary connection hiccup, or your key needs the travel/money permission. Refresh in a moment; if it persists, reconnect your key from above."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      {data.travel?.traveling && (
        <Panel>
          <div className="flex items-center gap-3">
            <Badge color="#58a6ff">✈ Traveling</Badge>
            <span className="text-sm">
              {data.travel.destination ? `To ${data.travel.destination}` : "In transit"}
              {data.travel.timeLeft != null && (
                <span className="text-muted"> — lands in {fmtDuration(data.travel.timeLeft)}</span>
              )}
            </span>
          </div>
        </Panel>
      )}

      <Panel
        title="Recommended runs right now"
        right={
          <span className="text-xs text-muted">
            risk-adjusted profit/min · wallet {fmtMoney(data.wallet)}
            {!data.forecastReady && " · forecast warming up"}
          </span>
        }
      >
        {data.yataStale ? (
          <EmptyState icon="📡" title="No stock data yet" hint="The collector hasn’t recorded any foreign stock yet. It populates within a minute or two of starting." />
        ) : data.recommendations.length === 0 ? (
          <EmptyState icon="🧳" title="Nothing profitable in stock right now" hint="Check back as foreign shops restock." />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.recommendations.map((r, i) => (
              <RunCard key={`${r.countryCode}-${r.itemId}`} row={r} rank={i + 1} />
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="All buying opportunities"
        right={
          stockSince != null ? (
            <span className="text-xs text-muted" title={stockAbsolute ?? undefined}>
              stock updated <TimeAgo since={stockSince} />
            </span>
          ) : undefined
        }
      >
        {data.rows.length === 0 ? (
          <EmptyState icon="🧳" title="No priced items right now" hint="Item prices or foreign stock are still loading." />
        ) : (
          <FlyingTable
            rows={data.rows}
            capacity={data.capacity}
            timeReduction={data.timeReduction}
          />
        )}
      </Panel>

      <p className="text-xs text-muted">
        Profit/min uses standard flight times minus your reduction (business
        class, perks…). “On arrival” &amp; odds forecast stock when you land,
        from observed depletion/restock history — confidence grows as we collect
        data, so early numbers are rough. Stock &amp; foreign prices via YATA;
        sell prices are Torn item market values — actual fills vary.
      </p>
    </div>
  );
}
