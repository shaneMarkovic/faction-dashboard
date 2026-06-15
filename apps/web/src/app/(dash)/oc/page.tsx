import { loadActiveDashboard } from "@/lib/active-faction";
import { OcBoard } from "@/components/OcBoard";
import { EmptyState, Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function OcPage() {
  const d = await loadActiveDashboard();

  if (d.tier !== "faction") {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <h1 className="text-lg font-bold">OC Board</h1>
        <Panel>
          <EmptyState
            icon="🔒"
            title="OC board locked"
            hint="This faction's key lacks faction API access (public tier). Add a key from a member whose position has API access to unlock organized crimes."
          />
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="text-lg font-bold">OC Board</h1>
      <OcBoard crimes={d.crimes} members={d.members} now={d.fetchedAt} />
    </div>
  );
}
