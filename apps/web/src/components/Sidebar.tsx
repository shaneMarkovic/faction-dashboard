"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Overview", icon: "◆" },
  { href: "/members", label: "Members", icon: "👥" },
  { href: "/oc", label: "OC Board", icon: "🎯" },
  { href: "/war", label: "War", icon: "⚔" },
  { href: "/treasury", label: "Treasury", icon: "💰" },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav className="flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-border bg-surface p-2 md:w-52 md:flex-col md:border-b-0 md:border-r md:p-3">
      <div className="hidden px-2 pb-3 text-sm font-bold md:block">⚡ Torn Ops</div>
      {NAV.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            <span className="text-xs opacity-80">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
