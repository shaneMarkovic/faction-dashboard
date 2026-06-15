import { loadActiveDashboard, resolveActiveFaction } from "@/lib/active-faction";
import { loadMemberBalances } from "@/lib/data";
import { fmtMoney } from "@/lib/format";
import { MemberBalancesTable } from "@/components/MemberBalancesTable";
import { EmptyState, Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TreasuryPage() {
  const { activeId } = await resolveActiveFaction();
  const [d, memberBalances] = await Promise.all([
    loadActiveDashboard(),
    loadMemberBalances(activeId),
  ]);

  if (d.tier !== "faction" || !d.balance) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <h1 className="text-lg font-bold">Treasury</h1>
        <Panel>
          <EmptyState
            icon="🔒"
            title="Treasury locked"
            hint="Needs a key with faction API access to read faction balance."
          />
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="text-lg font-bold">Treasury</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Panel title="Faction money">
          <div className="text-4xl font-bold tabular-nums">{fmtMoney(d.balance.money)}</div>
          <div className="mt-1 text-xs text-muted">{d.balance.money.toLocaleString()} exact</div>
        </Panel>
        <Panel title="Faction points">
          <div className="text-4xl font-bold tabular-nums">{d.balance.points.toLocaleString()}</div>
        </Panel>
      </div>
      <Panel title="Per-member balances">
        {memberBalances.length > 0 ? (
          <MemberBalancesTable balances={memberBalances} />
        ) : (
          <EmptyState icon="📊" title="No member balances yet" hint="The collector populates these on its next balance poll." />
        )}
      </Panel>
    </div>
  );
}
