import type { CashflowWeek, CategoryFlow } from "@/lib/finance";
import type { UserLogEntry } from "@torn/shared";
import { fmtMoney, relativeFromUnix } from "@/lib/format";
import { Panel } from "./ui";

/**
 * Weekly income/expense bars + per-category breakdown + recent money movements.
 * Net can be negative, so we render explicit two-tone bars rather than the
 * (positive-only) AreaChart.
 */
export function CashflowSummary({
  weeks,
  byCategory,
  recent,
}: {
  weeks: CashflowWeek[];
  byCategory: CategoryFlow[];
  recent: UserLogEntry[];
}) {
  const maxBar = Math.max(1, ...weeks.map((w) => Math.max(w.income, w.expense)));
  const totalNet = weeks.reduce((n, w) => n + w.net, 0);
  const fmtWeek = (t: number) => new Date(t * 1000).toLocaleDateString([], { month: "short", day: "numeric" });

  const incomeCats = byCategory.filter((c) => c.income > 0).sort((a, b) => b.income - a.income);
  const expenseCats = byCategory.filter((c) => c.expense > 0).sort((a, b) => b.expense - a.expense);
  const maxCat = Math.max(1, ...byCategory.map((c) => Math.max(c.income, c.expense)));

  const catList = (rows: CategoryFlow[], pick: "income" | "expense", color: string) => (
    <div className="space-y-1.5">
      {rows.length === 0 ? (
        <div className="py-4 text-center text-xs text-muted">Nothing yet.</div>
      ) : (
        rows.map((c) => (
          <div key={c.category} className="flex items-center gap-2 text-xs">
            <div className="w-28 shrink-0 truncate text-muted" title={c.category}>{c.category}</div>
            <div className="h-2 flex-1 rounded-full bg-surface-2">
              <div className="h-full rounded-full" style={{ width: `${(c[pick] / maxCat) * 100}%`, background: color }} />
            </div>
            <div className="w-20 shrink-0 text-right tabular-nums" style={{ color }}>{fmtMoney(c[pick])}</div>
          </div>
        ))
      )}
    </div>
  );

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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Income by category">{catList(incomeCats, "income", "#3fb950")}</Panel>
        <Panel title="Expenses by category">{catList(expenseCats, "expense", "#f85149")}</Panel>
      </div>

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
        Classified from your activity log by transaction type. Bank deposits,
        withdrawals and faction balance moves are treated as transfers (excluded).
        Uncommon log types may be missed. History accumulates from when you connected.
      </p>
    </div>
  );
}
