import type { CashflowWeek } from "@/lib/finance";
import type { UserLogEntry } from "@torn/shared";
import { fmtMoney, relativeFromUnix } from "@/lib/format";
import { Panel } from "./ui";

/**
 * Weekly income/expense bars + recent money movements. Net can be negative, so
 * we render explicit two-tone bars rather than the (positive-only) AreaChart.
 */
export function CashflowSummary({
  weeks,
  recent,
}: {
  weeks: CashflowWeek[];
  recent: UserLogEntry[];
}) {
  const maxBar = Math.max(1, ...weeks.map((w) => Math.max(w.income, w.expense)));
  const totalNet = weeks.reduce((n, w) => n + w.net, 0);
  const fmtWeek = (t: number) => new Date(t * 1000).toLocaleDateString([], { month: "short", day: "numeric" });

  return (
    <div className="space-y-5">
      <Panel
        title="Weekly cash flow"
        right={
          <span className="text-sm tabular-nums" style={{ color: totalNet >= 0 ? "#3fb950" : "#f85149" }}>
            net {fmtMoney(totalNet)}
          </span>
        }
      >
        {weeks.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted">
            No money movements recorded yet — this fills in from your activity log starting now.
          </div>
        ) : (
          <div className="space-y-3">
            {weeks.map((w) => (
              <div key={w.weekStart} className="flex items-center gap-3 text-xs">
                <div className="w-16 shrink-0 text-muted">{fmtWeek(w.weekStart)}</div>
                <div className="flex-1 space-y-1">
                  <div className="h-2 rounded-full bg-surface-2">
                    <div className="h-full rounded-full" style={{ width: `${(w.income / maxBar) * 100}%`, background: "#3fb950" }} />
                  </div>
                  <div className="h-2 rounded-full bg-surface-2">
                    <div className="h-full rounded-full" style={{ width: `${(w.expense / maxBar) * 100}%`, background: "#f85149" }} />
                  </div>
                </div>
                <div className="w-44 shrink-0 text-right tabular-nums">
                  <span style={{ color: "#3fb950" }}>{fmtMoney(w.income)}</span>
                  {" / "}
                  <span style={{ color: "#f85149" }}>{fmtMoney(w.expense)}</span>
                </div>
              </div>
            ))}
            <div className="flex gap-4 pt-1 text-xs text-muted">
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: "#3fb950" }} />income</span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: "#f85149" }} />expense</span>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Recent money movements">
        {recent.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted">Nothing recent.</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <tbody>
                {recent.map((e) => (
                  <tr key={e.id} className="border-t border-border first:border-t-0">
                    <td className="px-3 py-2">{e.title || e.category}</td>
                    <td className="px-3 py-2 text-right text-xs text-muted">{relativeFromUnix(e.timestamp)}</td>
                    <td
                      className="px-3 py-2 text-right tabular-nums"
                      style={{ color: e.money >= 0 ? "#3fb950" : "#f85149" }}
                    >
                      {fmtMoney(e.money)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="text-xs text-muted">
        Beta: income/expense are inferred from your activity log and may not catch
        every transaction type. History accumulates from when you connected.
      </p>
    </div>
  );
}
