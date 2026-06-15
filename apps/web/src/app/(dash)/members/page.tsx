import { loadActiveDashboard } from "@/lib/active-faction";
import { MembersTable } from "@/components/MembersTable";
import { Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

type FilterKey = "all" | "online" | "hospital" | "revivable" | "inactive" | "idle";
const VALID: FilterKey[] = ["all", "online", "hospital", "revivable", "inactive", "idle"];

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;
  const d = await loadActiveDashboard();
  const initial = (VALID as string[]).includes(filter ?? "") ? (filter as FilterKey) : "all";

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="text-lg font-bold">Members</h1>
      <Panel>
        <MembersTable members={d.members} now={d.fetchedAt} initialFilter={initial} />
      </Panel>
    </div>
  );
}
