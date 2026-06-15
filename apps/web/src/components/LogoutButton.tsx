"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { logout } from "@/app/gate/actions";

export function LogoutButton({ name }: { name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      title={`Signed in via ${name} key — sign out`}
      aria-label={pending ? "Signing out…" : "Sign out"}
      aria-busy={pending}
      onClick={() => start(async () => { await logout(); router.push("/gate"); router.refresh(); })}
      disabled={pending}
      className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground disabled:opacity-60"
    >
      {pending ? "…" : "Sign out"}
    </button>
  );
}
