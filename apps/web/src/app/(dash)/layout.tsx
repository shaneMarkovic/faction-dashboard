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
        {/* Content floats on the teal desktop (shows through). Default text is
            light so loose page headings read on the blue; chrome surfaces reset
            to black text (see globals.css) so panel content stays readable. */}
        <main className="flex-1 p-3 text-white">{children}</main>
      </div>
    </div>
  );
}
