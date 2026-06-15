import { redirect } from "next/navigation";
import { FlyingTable } from "@/components/FlyingTable";
import { Badge, EmptyState, Panel } from "@/components/ui";
import { fmtDuration } from "@/lib/format";
import { getTravelCapacity, loadFlyingOpportunities } from "@/lib/finance";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function FlyingPage() {
  const session = await getSession();
  if (!session) redirect("/gate");

  const capacity = await getTravelCapacity(session.tornId);
  const data = await loadFlyingOpportunities(session.tornId, capacity);

  if (!data) {
    return (
      <Panel>
        <EmptyState
          icon="🔑"
          title="Couldn’t read your travel status"
          hint="Your finance key may be missing the travel permission. Use “Disconnect key” above and reconnect with the full access set."
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
        title="Foreign buying opportunities"
        right={
          <span className="text-xs text-muted">
            buy abroad → sell at Torn market · {capacity} items/trip
          </span>
        }
      >
        {data.yataStale ? (
          <EmptyState
            icon="📡"
            title="Foreign stock source unavailable"
            hint="YATA’s travel export didn’t respond. Profit estimates resume when it’s back."
          />
        ) : data.rows.length === 0 ? (
          <EmptyState icon="🧳" title="No priced items right now" hint="Item prices or foreign stock are still loading." />
        ) : (
          <FlyingTable rows={data.rows} capacity={capacity} />
        )}
      </Panel>

      <p className="text-xs text-muted">
        Foreign stock &amp; prices via YATA (community-sourced). Sell prices are
        Torn item market values — actual fills vary. Profit/trip = profit/item ×
        your travel capacity.
      </p>
    </div>
  );
}
