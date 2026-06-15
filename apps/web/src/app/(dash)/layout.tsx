import { Sidebar } from "@/components/Sidebar";
import { FactionSwitcher } from "@/components/FactionSwitcher";
import { LiveRefresh } from "@/components/LiveRefresh";
import { LogoutButton } from "@/components/LogoutButton";
import { resolveActiveFaction } from "@/lib/active-faction";
import { getSession } from "@/lib/session";

export default async function DashLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { factions, activeId } = await resolveActiveFaction();
  const active = factions.find((f) => f.id === activeId);
  const session = await getSession();

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface/60 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-base font-bold">
              {active ? active.name : "Faction"}{" "}
              {active?.tag && <span className="text-muted">[{active.tag}]</span>}
            </div>
            <div className="text-xs text-muted">Faction Command Center</div>
          </div>
          <div className="flex items-center gap-3">
            <LiveRefresh factionId={activeId} />
            <FactionSwitcher factions={factions} activeId={activeId} />
            {session && <LogoutButton name={session.name} />}
          </div>
        </header>
        <main className="flex-1 p-4">{children}</main>
      </div>
    </div>
  );
}
