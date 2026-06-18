import type { ReactNode } from "react";

export function Badge({
  children,
  color = "#404040",
  title,
}: {
  children: ReactNode;
  color?: string;
  title?: string;
}) {
  // Flat, beveled tag instead of a translucent SaaS pill. A colored square
  // "LED" sits to the left so the status still reads at a glance.
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 bevel-out bg-surface px-1.5 py-px text-[11px] font-bold uppercase tracking-wide"
      style={{ color }}
    >
      <span className="inline-block h-2 w-2 shrink-0" style={{ background: color }} aria-hidden="true" />
      {children}
    </span>
  );
}

export function Dot({ color }: { color: string }) {
  // A square LED reads more "status panel" than a round dot.
  return <span className="inline-block h-2.5 w-2.5 shrink-0 border border-black/40" style={{ background: color }} />;
}

/** A small beveled button. Renders an <a> when href is supplied, else a <button>. */
export function Button({
  children,
  href,
  onClick,
  type = "button",
  title,
  className = "",
}: {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  title?: string;
  className?: string;
}) {
  if (href) {
    return (
      <a href={href} title={title} className={`xp-btn ${className}`}>
        {children}
      </a>
    );
  }
  return (
    <button type={type} onClick={onClick} title={title} className={`xp-btn ${className}`}>
      {children}
    </button>
  );
}

/** A Torn member name that links to their in-game profile (opens in a new tab). */
export function ProfileLink({
  id,
  name,
  className = "",
}: {
  id: number;
  name: string;
  className?: string;
}) {
  return (
    <a
      href={`https://www.torn.com/profiles.php?XID=${id}`}
      target="_blank"
      rel="noreferrer"
      title={`Open ${name}'s Torn profile`}
      className={`text-[#0000cc] underline hover:text-[#cc0000] ${className}`}
    >
      {name}
    </a>
  );
}

/** A faction name that links to its in-game profile. Plain text if id is unknown. */
export function FactionLink({
  id,
  name,
  className = "",
}: {
  id: number;
  name: string;
  className?: string;
}) {
  if (!id) return <span className={className}>{name}</span>;
  return (
    <a
      href={`https://www.torn.com/factions.php?step=profile&ID=${id}`}
      target="_blank"
      rel="noreferrer"
      title={`Open ${name}'s Torn faction page`}
      className={`text-[#0000cc] underline hover:text-[#cc0000] ${className}`}
    >
      {name}
    </a>
  );
}

export function ProgressBar({ value, max, color = "#1d7d2e" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  // Segmented "defrag/loading" style fill inside a sunken well.
  return (
    <div className="bevel-in h-3.5 w-full overflow-hidden p-px">
      <div
        className="h-full transition-all"
        style={{
          width: `${pct}%`,
          background: `repeating-linear-gradient(90deg, ${color} 0 7px, transparent 7px 9px)`,
        }}
      />
    </div>
  );
}

export function Panel({
  title,
  right,
  children,
  className = "",
  idle = false,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  idle?: boolean;
}) {
  return (
    <section className={`xp-window ${className}`}>
      {(title || right) && (
        <header className={`xp-titlebar ${idle ? "xp-titlebar--idle" : ""} mb-[3px]`}>
          {title && <h2 className="truncate">{title}</h2>}
          {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
        </header>
      )}
      <div className="px-2 py-1.5">{children}</div>
    </section>
  );
}

export function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-6 text-center">
      <div className="text-2xl opacity-70" aria-hidden="true">{icon}</div>
      <div className="text-sm font-bold">{title}</div>
      {hint && <div className="max-w-xs text-[11px] text-muted">{hint}</div>}
    </div>
  );
}

export const STATUS_COLOR: Record<string, string> = {
  Okay: "#1d7d2e",
  Hospital: "#cc0000",
  Traveling: "#0058e6",
  Abroad: "#0058e6",
  Jail: "#b8860b",
  Federal: "#b8860b",
  Fallen: "#606060",
};
