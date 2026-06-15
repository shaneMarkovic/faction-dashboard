import type { ReactNode } from "react";

export function Badge({
  children,
  color = "#8b94a3",
  title,
}: {
  children: ReactNode;
  color?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ color, background: `${color}1f` }}
    >
      {children}
    </span>
  );
}

export function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />;
}

export function ProgressBar({ value, max, color = "#3fb950" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export function Panel({
  title,
  right,
  children,
  className = "",
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-border bg-surface p-4 ${className}`}>
      {(title || right) && (
        <header className="mb-3 flex items-center justify-between">
          {title && (
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
          )}
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-8 text-center">
      <div className="text-2xl opacity-60">{icon}</div>
      <div className="text-sm font-medium">{title}</div>
      {hint && <div className="max-w-xs text-xs text-muted">{hint}</div>}
    </div>
  );
}

export const STATUS_COLOR: Record<string, string> = {
  Okay: "#3fb950",
  Hospital: "#f85149",
  Traveling: "#58a6ff",
  Abroad: "#58a6ff",
  Jail: "#d29922",
  Federal: "#d29922",
  Fallen: "#8b94a3",
};
