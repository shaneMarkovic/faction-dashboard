import { redirect } from "next/navigation";
import { EmptyState, Panel } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import { loadTradingStats } from "@/lib/finance";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

const fmtNum = (n: number | null) => (n == null ? "—" : n.toLocaleString());

export default async function TradingPage() {
  const session = await getSession();
  if (!session) redirect("/gate");

  const data = await loadTradingStats(session.tornId);

  if (!data) {
    return (
      <Panel>
        <EmptyState
          icon="🔑"
          title="Couldn’t read your trading stats"
          hint="Your finance key may be missing the personalstats/bazaar/stocks permissions. Use “Disconnect key” above and reconnect with the full access set."
        />
      </Panel>
    );
  }

  const { stats, stocksValue, holdings } = data;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Trades" value={fmtNum(stats.trades)} />
        <Stat label="Items bought" value={fmtNum(stats.itemsBought)} />
        <Stat label="Bought abroad" value={fmtNum(stats.itemsBoughtAbroad)} />
        <Stat label="City finds" value={fmtNum(stats.cityFinds)} />
        <Stat label="Money mugged" value={stats.moneyMugged == null ? "—" : fmtMoney(stats.moneyMugged)} />
        <Stat label="Times travelled" value={fmtNum(stats.travelTimes)} />
        <Stat label="Stocks value" value={fmtMoney(stocksValue)} />
      </div>

      <Panel title="Stock holdings">
        {holdings.length === 0 ? (
          <EmptyState icon="📈" title="No stock holdings" hint="Stocks you own will appear here, valued at the current price." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Stock</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Shares</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => (
                  <tr key={h.stockId} className="border-t border-border hover:bg-surface-2/50">
                    <td className="px-3 py-2">{h.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{h.shares.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(h.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
