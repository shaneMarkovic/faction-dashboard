import { redirect } from "next/navigation";
import { getAiConfig } from "@/app/(dash)/finance/ai-actions";
import { AiSettings } from "@/components/AiSettings";
import { CoPilotDock } from "@/components/CoPilotDock";
import { FlyingTable } from "@/components/FlyingTable";
import { Countdown, TimeAgo } from "@/components/Time";
import { Badge, EmptyState, Panel } from "@/components/ui";
import { listAiChatsFor } from "@/lib/ai/chat-store";
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
          <div className="text-lg font-bold tabular-nums text-[#3fb950]">{fmtMoney(row.profitPerHour)}/hr</div>
          <div className="text-xs text-muted">{fmtMoney(row.tripProfit)} per trip ({row.tripUnits} items)</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {row.cashLimited && <Badge color="#d29922" title={`A full trip costs ${fmtMoney(row.costPerTrip)} — you're ${fmtMoney(row.cashShort)} short`}>need {fmtMoney(row.cashShort)}</Badge>}
          {row.lowStock && <Badge color="#f85149">low stock</Badge>}
          {row.museumValue && <Badge color="#a371f7" title="Redeemable for Museum points — worth more than the market margin shows">museum</Badge>}
        </div>
      </div>
      {row.longHaul && (
        <div
          className="mt-2 text-xs"
          style={{ color: "#d29922" }}
          title="Energy and nerve keep regenerating while you fly — anything over a full bar is wasted. Spend them down before you leave. Best done while stacked for war or working the abroad merit."
        >
          ⏳ over 5h round trip — drain ~{row.energyCost} energy &amp; {row.nerveCost} nerve before flying or you waste the regen
        </div>
      )}
      <div className="mt-2 border-t border-border pt-2 text-xs" style={{ color: oddsColor }}>
        ~{row.predictedOnArrival.toLocaleString()} left · {oddsText}
        {row.irregularRestock && <span className="text-muted"> · irregular restock</span>}
      </div>
    </div>
  );
}

/** Seasonal travel events that change the math (dates approximate per guide). */
function seasonalEvent(): { title: string; hint: string } | null {
  const month = new Date().getUTCMonth(); // 0 = Jan
  if (month === 4) return { title: "🏛 Museum Day (May)", hint: "Plushie & flower point prices swing through the event — values are elevated for much of the lead-up, then dip from oversupply." };
  if (month === 8) return { title: "🌴 Tourism Day (September)", hint: "Carrying capacity is doubled while the event runs — bump your capacity below and lean into the long-haul merits." };
  return null;
}

export default async function FlyingPage() {
  const session = await getSession();
  if (!session) redirect("/gate");

  const prefs = await getFinancePrefs(session.tornId);
  const data = await loadFlyingOpportunities(session.tornId, prefs.capacityOverride, prefs.timeReduction);
  const ai = await getAiConfig();
  const chats = await listAiChatsFor(session.tornId);

  const stockAbsolute = data?.stockUpdatedAt ? new Date(data.stockUpdatedAt * 1000).toLocaleString() : null;
  const event = seasonalEvent();

  return (
    <div className="space-y-4">
      {/* Compact status strip — replaces the old stacked banners. */}
      <div className="flex flex-wrap items-center gap-2">
        {data?.travel?.traveling && (
          <Badge color="#58a6ff">
            ✈ {data.travel.destination ?? "In transit"}
            {data.travel.timeLeft != null && (
              <>
                {" · "}
                <Countdown seconds={data.travel.timeLeft} />
              </>
            )}
          </Badge>
        )}
        {data && (
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-muted">
            💵 wallet <span className="tabular-nums text-foreground">{fmtMoney(data.wallet)}</span>
          </span>
        )}
        {data && (
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-muted">
            🧳 capacity <span className="tabular-nums text-foreground">{data.capacity}</span>
          </span>
        )}
        {data && !data.forecastReady && <Badge color="#d29922">⏳ forecast warming up</Badge>}
        {event && (
          <Badge color="#a371f7" title={event.hint}>
            {event.title}
          </Badge>
        )}
        {data?.stockUpdatedAt != null && (
          <span className="ml-auto text-xs text-muted" title={stockAbsolute ?? undefined}>
            stock updated <TimeAgo at={data.stockUpdatedAt} />
          </span>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        {/* Main column: recommendations + collapsible table + how-it-works */}
        <div className="min-w-0 space-y-4">
          <Panel title="Recommended runs" right={<span className="text-xs text-muted">risk-adjusted profit/hr</span>}>
            {!data ? (
              <EmptyState
                icon="🔌"
                title="Couldn’t reach your live flying data"
                hint="Temporary hiccup, or your key needs the travel/money permission. The co-pilot still works for your finances — refresh, or reconnect your key."
              />
            ) : data.yataStale ? (
              <EmptyState icon="📡" title="No stock data yet" hint="The collector hasn’t recorded any foreign stock yet. It populates within a minute or two of starting." />
            ) : data.recommendations.length === 0 ? (
              <EmptyState icon="🧳" title="Nothing profitable in stock right now" hint="Check back as foreign shops restock." />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {data.recommendations.map((r, i) => (
                  <RunCard key={`${r.countryCode}-${r.itemId}`} row={r} rank={i + 1} />
                ))}
              </div>
            )}
          </Panel>

          {data && data.rows.length > 0 && (
            <details open className="group rounded-xl border border-border bg-surface">
              <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 text-sm font-semibold">
                <span className="text-muted transition group-open:rotate-90">▸</span>
                All opportunities <span className="font-normal text-muted">({data.rows.length})</span>
              </summary>
              <div className="border-t border-border p-4">
                <FlyingTable
                  rows={data.rows}
                  capacity={data.capacity}
                  capacityOverride={data.capacityOverride}
                  detectedCapacity={data.detectedCapacity}
                  timeReduction={data.timeReduction}
                />
              </div>
            </details>
          )}

          <details className="group rounded-xl border border-border bg-surface">
            <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
              <span className="transition group-open:rotate-90">▸</span> How the numbers work
            </summary>
            <div className="border-t border-border p-4 text-xs leading-relaxed text-muted">
              Profit/hr uses standard flight times minus your reduction (private island airstrip ≈ 30%; “Mailing
              Yourself Abroad” book another 25%). “On arrival” &amp; odds forecast stock when you land, from observed
              depletion/restock history — confidence grows as we collect data, so early numbers are rough. Drugs &amp;
              contraband restock irregularly, so their odds are deliberately held low. Weapons/armor are kept out of
              the recommendations (random quality on purchase). “Museum” items are worth more than market margin shows
              once redeemed for points. Energy/nerve costs and event dates are from the community travel guide — verify
              against the Torn wiki. Stock &amp; foreign prices via YATA; sell prices are Torn item market values —
              actual fills vary.
            </div>
          </details>
        </div>

        {/* Co-pilot: sticky sidebar on desktop, drawer on mobile */}
        <CoPilotDock
          configured={ai.configured}
          initialChats={chats}
          settings={<AiSettings />}
        />
      </div>
    </div>
  );
}
