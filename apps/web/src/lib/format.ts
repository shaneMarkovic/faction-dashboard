export function fmtMoney(n: number): string {
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "b";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "m";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "k";
  return "$" + n.toString();
}

export function fmtDuration(sec: number): string {
  if (sec <= 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h ? `${h}h` : "", m || h ? `${m}m` : "", `${s}s`].filter(Boolean).join(" ");
}

export function relativeFromUnix(ts: number, now: number = Math.floor(Date.now() / 1000)): string {
  const d = now - ts;
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}
