"use client";

import { useState } from "react";

export interface Point {
  t: number; // unix seconds
  value: number;
}

/**
 * Lightweight dependency-free SVG area chart with hover readout. Good for the
 * chain-history series. Uses a viewBox so it scales responsively.
 */
export function AreaChart({
  points,
  height = 160,
  color = "#f0883e",
  unit = "",
}: {
  points: Point[];
  height?: number;
  color?: string;
  unit?: string;
}) {
  const W = 800;
  const H = height;
  const pad = { l: 8, r: 8, t: 10, b: 18 };
  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) {
    return <div className="py-8 text-center text-sm text-muted">Not enough data yet — fills in as the collector runs.</div>;
  }

  const xs = points.map((p) => p.t);
  const minT = Math.min(...xs);
  const maxT = Math.max(...xs);
  const maxV = Math.max(1, ...points.map((p) => p.value));

  const x = (t: number) => pad.l + ((t - minT) / (maxT - minT || 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / maxV) * (H - pad.t - pad.b);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(maxT).toFixed(1)},${(H - pad.b).toFixed(1)} L${x(minT).toFixed(1)},${(H - pad.b).toFixed(1)} Z`;

  const peak = points.reduce((a, b) => (b.value > a.value ? b : a));
  const hp = hover != null ? points[hover] : null;

  const fmtTime = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          let best = 0;
          let bd = Infinity;
          for (let i = 0; i < points.length; i++) {
            const d = Math.abs(x(points[i]!.t) - px);
            if (d < bd) { bd = d; best = i; }
          }
          setHover(best);
        }}
      >
        <defs>
          <linearGradient id="ac-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#ac-grad)" />
        <path d={line} fill="none" stroke={color} strokeWidth="1.5" />
        {/* peak marker */}
        <circle cx={x(peak.t)} cy={y(peak.value)} r="2.5" fill={color} />
        {hp && (
          <>
            <line x1={x(hp.t)} y1={pad.t} x2={x(hp.t)} y2={H - pad.b} stroke="#ffffff22" strokeWidth="1" />
            <circle cx={x(hp.t)} cy={y(hp.value)} r="3" fill="#fff" />
          </>
        )}
        <text x={pad.l} y={H - 4} fontSize="10" fill="#8b94a3">{fmtTime(minT)}</text>
        <text x={W - pad.r} y={H - 4} fontSize="10" fill="#8b94a3" textAnchor="end">{fmtTime(maxT)}</text>
      </svg>
      <div className="mt-1 flex items-center justify-between text-xs text-muted">
        <span>peak {peak.value}{unit}</span>
        <span>{hp ? `${fmtTime(hp.t)}: ${hp.value}${unit}` : `latest ${points[points.length - 1]!.value}${unit}`}</span>
      </div>
    </div>
  );
}
