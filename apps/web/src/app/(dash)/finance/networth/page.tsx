import { redirect } from "next/navigation";
import { NetworthBreakdownView } from "@/components/NetworthBreakdown";
import { EmptyState, Panel } from "@/components/ui";
import { loadNetworth, loadNetworthHistory } from "@/lib/finance";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NetworthPage() {
  const session = await getSession();
  if (!session) redirect("/gate");

  const [data, history] = await Promise.all([
    loadNetworth(session.tornId),
    loadNetworthHistory(session.tornId),
  ]);

  if (!data) {
    return (
      <Panel>
        <EmptyState
          icon="🔑"
          title="Couldn’t read your net worth"
          hint="Your finance key may be missing the networth permission. Use “Disconnect key” above and reconnect with the full access set."
        />
      </Panel>
    );
  }

  return <NetworthBreakdownView breakdown={data.breakdown} history={history} />;
}
