"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { disconnectFinanceKey } from "@/app/(dash)/finance/actions";

const TABS = [
  { href: "/finance/networth", label: "Net worth" },
  { href: "/finance/flying", label: "Flying" },
  { href: "/finance/cashflow", label: "Cash flow" },
  { href: "/finance/trading", label: "Trading" },
];

export function FinanceTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, start] = useTransition();

  const disconnect = () => {
    if (!confirm("Disconnect your finance key? Your stored key will be revoked.")) return;
    start(async () => {
      await disconnectFinanceKey();
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label="Finance sections" className="flex flex-wrap gap-1">
        {TABS.map((t) => {
          const active = pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              data-on={active ? "true" : undefined}
              className="xp-toggle"
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      <button
        onClick={disconnect}
        disabled={pending}
        className="ml-auto text-xs text-white/80 underline hover:text-[#ffd0d0] disabled:opacity-60"
      >
        {pending ? "Disconnecting…" : "Disconnect key"}
      </button>
    </div>
  );
}
