import { loadActiveDashboard, resolveActiveFaction } from "@/lib/active-faction";
import { loadMemberProgress, loadWarRules } from "@/lib/data";
import { Badge, EmptyState, Panel, ProgressBar } from "@/components/ui";
import { WarRulesEditor } from "@/components/WarRulesEditor";
import { Countdown } from "@/components/Time";

export const dynamic = "force-dynamic";

export default async function WarPage() {
  const { activeId } = await resolveActiveFaction();
  const [d, rules, progress] = await Promise.all([
    loadActiveDashboard(),
    loadWarRules(activeId),
    loadMemberProgress(activeId),
  ]);
  const now = d.fetchedAt;
  const blocked = progress.filter((p) => p.blocked);
  const active = d.wars.find((w) => w.end == null || w.end > now);
  const history = d.wars
    .filter((w) => w.end != null && w.end <= now)
    .sort((a, b) => b.start - a.start);

  const wins = history.filter((w) => w.score > w.opponentScore).length;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Ranked War</h1>
        <span className="text-xs text-muted">{wins}W–{history.length - wins}L · {history.length} wars</span>
      </div>

      <Panel title="Active war">
        {active ? (
          <div className="space-y-3">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-4xl font-bold tabular-nums">{active.score}</div>
                <div className="text-xs text-muted">{d.faction.tag}</div>
              </div>
              <div className="text-center text-muted">
                <div className="text-xs">target</div>
                <div className="font-bold tabular-nums">{active.target.toLocaleString()}</div>
              </div>
              <div className="text-right">
                <div className="text-4xl font-bold tabular-nums">{active.opponentScore}</div>
                <div className="text-xs text-muted">{active.opponentName}</div>
              </div>
            </div>
            <ProgressBar
              value={active.score}
              max={Math.max(active.target, active.score + active.opponentScore)}
              color={active.score >= active.opponentScore ? "#3fb950" : "#f85149"}
            />
            <div className="text-center text-xs text-muted">
              {active.score >= active.opponentScore ? "Leading" : "Behind"} by{" "}
              {Math.abs(active.score - active.opponentScore)}
              {active.end != null && active.end > now && (
                <> · ends in <Countdown seconds={active.end - now} /></>
              )}
            </div>
          </div>
        ) : (
          <EmptyState icon="⚔" title="No active war" hint="Live score, lead, and target appear here during a ranked war." />
        )}
      </Panel>

      <Panel
        title="War Enforcer"
        right={
          <span className="text-xs text-muted">
            {blocked.length > 0 ? `${blocked.length} members blocked` : "no blocks active"}
          </span>
        }
      >
        <p className="mb-3 text-xs text-muted">
          Caps the userscript enforces on torn.com during a war. 0 = no limit. Changes apply on the next collector cycle.
        </p>
        <WarRulesEditor factionId={activeId} rules={rules} />

        {blocked.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <div className="mb-2 text-xs font-medium text-muted">Currently blocked</div>
            <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
              {blocked.map((p) => (
                <li key={p.memberId} className="flex items-center justify-between gap-2">
                  <span className="truncate">{p.name}</span>
                  <span className="flex gap-1">
                    {p.reasons.includes("faction_target") && <Badge color="#f85149">faction cap</Badge>}
                    {p.reasons.includes("member_score") && <Badge color="#d29922">score</Badge>}
                    {p.reasons.includes("attack_limit") && <Badge color="#a371f7">hits</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      <Panel title="History">
        {history.length === 0 ? (
          <EmptyState icon="📜" title="No war history yet" />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Opponent</th>
                  <th className="px-3 py-2 text-right font-medium">Score</th>
                  <th className="px-3 py-2 text-right font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 30).map((w) => {
                  const win = w.score > w.opponentScore;
                  return (
                    <tr key={w.id} className="border-t border-border">
                      <td className="px-3 py-2">{w.opponentName}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {w.score}–{w.opponentScore}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Badge color={win ? "#3fb950" : "#f85149"}>{win ? "WIN" : "LOSS"}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
