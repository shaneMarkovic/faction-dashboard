"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { authenticate } from "./actions";

export default function GatePage() {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const submit = () => {
    setError(null);
    start(async () => {
      const res = await authenticate(key);
      if (res.ok) {
        router.push("/");
        router.refresh();
      } else {
        setError(res.error ?? "Access denied.");
      }
    });
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6">
        <h1 className="text-lg font-bold">⚡ Torn Ops</h1>
        <p className="mt-1 text-sm text-muted">
          Faction members only. Enter your Torn API key to verify your faction and continue.
        </p>

        <div className="mt-5 space-y-2">
          <label className="text-xs font-medium text-muted">Torn API key</label>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Paste your key…"
            autoFocus
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-muted"
          />
          <button
            onClick={submit}
            disabled={pending}
            className="w-full rounded-md bg-[#22c48a] px-4 py-2 text-sm font-semibold text-[#0f0f0f] disabled:opacity-60"
          >
            {pending ? "Verifying…" : "Enter dashboard"}
          </button>
          {error && <p className="text-sm text-[#f85149]">{error}</p>}
        </div>

        <div className="mt-5 space-y-1 border-t border-border pt-4 text-xs text-muted">
          <p>
            Generate a key at{" "}
            <a
              href="https://www.torn.com/preferences.php#tab=api"
              target="_blank"
              rel="noreferrer"
              className="text-[#58a6ff] hover:underline"
            >
              Torn → Settings → API
            </a>
            . A <strong>Public</strong>-access key is enough to verify membership.
          </p>
          <p>
            We use it to confirm your faction. If your faction has no key powering
            the dashboard yet, a <strong>faction-access</strong> key is stored
            encrypted so we can keep it live — you can revoke it anytime.
          </p>
        </div>
      </div>
    </main>
  );
}
