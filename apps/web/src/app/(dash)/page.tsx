import Link from "next/link";
import { loadActiveDashboard, resolveActiveFaction } from "@/lib/active-faction";
import { loadChainHistory } from "@/lib/data";
import { fmtMoney } from "@/lib/format";
import { Badge, Dot, EmptyState, FactionLink, Panel, ProfileLink, ProgressBar, STATUS_COLOR } from "@/components/ui";
import { Countdown, TimeAgo } from "@/components/Time";
import { AreaChart } from "@/components/AreaChart";

export const dynamic = "force-dynamic";

function StatTile({ label, value, sub, href }: { label: string; value: React.ReactNode; sub?: React.ReactNode; href?: string }) {
  const inner = (
    <div className="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-muted">
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-muted">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default async function OverviewPage() {
  const { activeId } = await resolveActiveFaction();
  const [d, chainHistory] = await Promise.all([loadActiveDashboard(), loadChainHistory(activeId, 12)]);
  const now = d.fetchedAt;
  const dataAge = Math.max(0, Math.floor(Date.now() / 1000) - d.fetchedAt);

  const online = d.members.filter((m) => now - m.lastActionTs < 15 * 60).length;
  const inOc = d.members.filter((m) => m.isInOc).length;
  const hospital = d.members.filter((m) => m.statusState === "Hospital").length;
  // "Needs a revive" = in hospital right now AND has revives enabled. `isRevivable`
  // alone is just the member's setting (most leave it on), not an action item.
  const needsRevive = d.members.filter((m) => m.isRevivable && m.statusState === "Hospital").length;
  const inactive = d.members.filter((m) => now - m.lastActionTs > 3 * 86400).length;

  const activeCrimes = d.crimes.filter((c) => c.status === "Recruiting" || c.status === "Planning");
  const emptySlots = activeCrimes.reduce((n, c) => n + c.slots.filter((s) => s.userId == null).length, 0);
  const readyCrimes = d.crimes.filter((c) => c.readyAt != null && c.readyAt <= now).length;

  const chain = d.chain;
  const chainActive = !!chain && chain.current > 0 && chain.timeout > 0;
  const activeWar = d.wars.find((w) => w.end == null || w.end > now);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Overview</h1>
        <span className="text-xs text-muted">
          {d.source === "live" ? "Live from Torn" : "Cached"} · updated <TimeAgo since={dataAge} />
        </span>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="members" value={d.members.length} sub={`${online} active`} href="/members" />
        <StatTile label="in OC" value={inOc} sub={`${emptySlots} slots open`} href="/oc" />
        <StatTile label="hospital" value={hospital} href="/members" />
        <StatTile label="needs revive" value={needsRevive} href="/members?filter=revivable" />
        <StatTile
          label="treasury"
          value={d.balance ? fmtMoney(d.balance.money) : "—"}
          href="/treasury"
        />
        <StatTile
          label="chain"
          value={chainActive ? chain!.current : "idle"}
          sub={chainActive ? <Countdown seconds={chain!.secondsLeft} urgentUnder={120} /> : undefined}
          href="/war"
        />
      </div>

      {/* Needs attention */}
      <Panel title="Needs attention">
        <ul className="space-y-2 text-sm">
          {emptySlots > 0 && (
            <li className="flex items-center justify-between">
              <span>
                <Badge color="#a371f7">OC</Badge> {emptySlots} empty slots across {activeCrimes.length} crimes
              </span>
              <Link href="/oc" className="text-xs text-[#58a6ff] hover:underline">Assign →</Link>
            </li>
          )}
          {readyCrimes > 0 && (
            <li className="flex items-center justify-between">
              <span><Badge color="#3fb950">Ready</Badge> {readyCrimes} crimes ready to execute</span>
              <Link href="/oc" className="text-xs text-[#58a6ff] hover:underline">View →</Link>
            </li>
          )}
          {needsRevive > 0 && (
            <li className="flex items-center justify-between">
              <span><Badge color="#f85149">Revive</Badge> {needsRevive} {needsRevive === 1 ? "member needs" : "members need"} a revive</span>
              <Link href="/members?filter=revivable" className="text-xs text-[#58a6ff] hover:underline">Revive board →</Link>
            </li>
          )}
          {inactive > 0 && (
            <li className="flex items-center justify-between">
              <span><Badge color="#d29922">Inactive</Badge> {inactive} members idle 3+ days</span>
              <Link href="/members?filter=inactive" className="text-xs text-[#58a6ff] hover:underline">Review →</Link>
            </li>
          )}
          {emptySlots === 0 && readyCrimes === 0 && needsRevive === 0 && inactive === 0 && (
            <EmptyState icon="✓" title="All clear" hint="No open OC slots, revives, or inactive members right now." />
          )}
        </ul>
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Chain */}
        <Panel title="Chain">
          {chainActive ? (
            <div className="space-y-2">
              <div className="flex items-end justify-between">
                <div className="text-3xl font-bold tabular-nums">{chain!.current}</div>
                <div className="text-right">
                  <div className="text-2xl font-bold tabular-nums">
                    <Countdown seconds={chain!.secondsLeft} urgentUnder={120} />
                  </div>
                  <div className="text-xs text-muted">until drop · x{chain!.modifier}</div>
                </div>
              </div>
              <ProgressBar value={chain!.secondsLeft} max={300} color={chain!.secondsLeft < 120 ? "#f85149" : "#f0883e"} />
            </div>
          ) : (
            <EmptyState icon="⛓" title="No active chain" hint="The chain timer and warmer alarm light up here when a chain starts." />
          )}
        </Panel>

        {/* War */}
        <Panel title="Ranked War">
          {activeWar ? (
            <div className="flex items-end justify-between">
              <div>
                <div className="text-3xl font-bold tabular-nums">{activeWar.score}</div>
                <div className="text-xs text-muted">{d.faction.tag}</div>
              </div>
              <div className="text-muted">vs</div>
              <div className="text-right">
                <div className="text-3xl font-bold tabular-nums">{activeWar.opponentScore}</div>
                <FactionLink id={activeWar.opponentId} name={activeWar.opponentName} className="text-xs text-muted" />
              </div>
            </div>
          ) : (
            <EmptyState icon="⚔" title="No active war" hint={`${d.wars.length} ranked wars in history — see the War page.`} />
          )}
        </Panel>
      </div>

      {/* Chain history */}
      <Panel title="Chain — last 12h">
        <AreaChart points={chainHistory} color="#f0883e" />
      </Panel>

      {/* Recently active */}
      <Panel title="Recently active" right={<Link href="/members" className="text-xs text-[#58a6ff] hover:underline">All members →</Link>}>
        <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
          {d.members
            .slice()
            .sort((a, b) => b.lastActionTs - a.lastActionTs)
            .slice(0, 8)
            .map((m) => (
              <li key={m.tornId} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 truncate">
                  <Dot color={STATUS_COLOR[m.statusState] ?? "#8b94a3"} />
                  <ProfileLink id={m.tornId} name={m.name} className="truncate" />
                  <span className="text-xs text-muted">{m.position}</span>
                </span>
                <TimeAgo since={now - m.lastActionTs} className="shrink-0 text-xs text-muted" />
              </li>
            ))}
        </ul>
      </Panel>
    </div>
  );
}
