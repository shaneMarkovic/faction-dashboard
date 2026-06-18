"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/members", label: "Members" },
  { href: "/oc", label: "OC Board" },
  { href: "/war", label: "War" },
  { href: "/treasury", label: "Treasury" },
  { href: "/finance", label: "Finance" },
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
      className="xp-window m-1 flex shrink-0 flex-row gap-px overflow-x-auto md:m-1 md:w-48 md:flex-col"
    >
      <div className="xp-titlebar mb-px hidden md:flex">
        <span className="truncate">⚡ Torn Ops</span>
      </div>
      <ul className="flex flex-row gap-px p-px md:flex-col">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                ref={active ? activeRef : undefined}
                aria-current={active ? "page" : undefined}
                className={`block whitespace-nowrap px-3 py-1 text-[12px] font-bold ${
                  active
                    ? "bg-[var(--select)] text-white"
                    : "text-black hover:bg-[#d8d4c0]"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
