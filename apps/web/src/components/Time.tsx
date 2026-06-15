"use client";

import { useEffect, useState } from "react";
import { fmtDuration } from "@/lib/format";

/**
 * Live countdown. `seconds` is the remaining time AS COMPUTED BY THE SERVER at
 * render time; we then tick down using the browser's own clock (elapsed since
 * mount). This avoids comparing an absolute server timestamp against a skewed
 * browser clock — which made the chain timer jump on every refresh. When the
 * server sends a new `seconds` (e.g. a chain hit reset it), we re-sync.
 */
export function Countdown({
  seconds,
  zero = "now",
  className,
  urgentUnder,
}: {
  seconds: number;
  zero?: string;
  className?: string;
  urgentUnder?: number;
}) {
  const start = Math.max(0, Math.round(seconds));
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(0);
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [start]); // re-sync whenever the server-provided remaining time changes

  const left = Math.max(0, start - elapsed);
  const urgent = urgentUnder != null && left > 0 && left < urgentUnder;
  return (
    <span suppressHydrationWarning className={className} style={urgent ? { color: "#f85149" } : undefined}>
      {left <= 0 ? zero : fmtDuration(left)}
    </span>
  );
}

/** Live "Xs ago". `since` is seconds-elapsed at server render; ticks up locally. */
export function TimeAgo({ since, className }: { since: number; className?: string }) {
  const [extra, setExtra] = useState(0);
  useEffect(() => {
    setExtra(0);
    const t0 = Date.now();
    const id = setInterval(() => setExtra(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [since]);

  const d = Math.max(0, Math.round(since) + extra);
  let text: string;
  if (d < 60) text = `${d}s ago`;
  else if (d < 3600) text = `${Math.floor(d / 60)}m ago`;
  else if (d < 86400) text = `${Math.floor(d / 3600)}h ago`;
  else text = `${Math.floor(d / 86400)}d ago`;
  return (
    <span suppressHydrationWarning className={className}>
      {text}
    </span>
  );
}
