import { redirect } from "next/navigation";
import { CashflowSummary } from "@/components/CashflowSummary";
import { EmptyState, Panel } from "@/components/ui";
import { loadCashflow } from "@/lib/finance";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function CashflowPage() {
  const session = await getSession();
  if (!session) redirect("/gate");

  const data = await loadCashflow(session.tornId);

  if (!data) {
    return (
      <Panel>
        <EmptyState
          icon="🔑"
          title="Couldn’t read your activity log"
          hint="Your finance key may be missing the log permission. Use “Disconnect key” above and reconnect with the full access set."
        />
      </Panel>
    );
  }

  return <CashflowSummary weeks={data.weeks} recent={data.recent} />;
}
