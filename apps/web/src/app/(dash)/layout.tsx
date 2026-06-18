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
      <div className="flex min-w-0 flex-1 flex-col p-1">
        <header className="xp-window mb-1 flex flex-col">
          <div className="xp-titlebar">
            <span className="truncate">
              {active ? active.name : "Faction"}
              {active?.tag && <span className="font-normal opacity-90"> [{active.tag}]</span>}
              <span className="font-normal opacity-90"> — Faction Command Center</span>
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 px-2 py-1">
            <LiveRefresh factionId={activeId} />
            <FactionSwitcher factions={factions} activeId={activeId} />
            {session && <LogoutButton name={session.name} />}
          </div>
        </header>
        {/* Recessed light "client workspace" so page headings, tab strips and
            plain text don't sit on the saturated teal desktop (unreadable).
            Panels/windows float on top of this gray, classic MDI-app style. */}
        <main className="flex-1 bg-[#d6d3c6] p-3 [box-shadow:inset_1px_1px_0_#b8b4a2,inset_-1px_-1px_0_#fbfaf6]">
          {children}
        </main>
      </div>
    </div>
  );
}
