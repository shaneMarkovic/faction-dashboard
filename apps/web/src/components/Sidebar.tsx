"use client";

import { useEffect, useRef } from "react";
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
  const activeRef = useRef<HTMLAnchorElement | null>(null);

  // On mobile the nav scrolls horizontally; keep the active item in view so it
  // isn't stuck off-screen after navigating.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [pathname]);

  return (
    <nav
      aria-label="Primary"
      className="flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-border bg-surface p-2 md:w-52 md:flex-col md:border-b-0 md:border-r md:p-3"
    >
      <div className="hidden px-2 pb-3 text-sm font-bold md:block">
        <span aria-hidden="true">⚡</span> Torn Ops
      </div>
      {NAV.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            ref={active ? activeRef : undefined}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            <span className="text-xs opacity-80" aria-hidden="true">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
