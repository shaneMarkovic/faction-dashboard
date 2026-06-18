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
      <div className="xp-window w-full max-w-sm">
        <div className="xp-titlebar mb-2">
          <span>⚡ Torn Ops — Sign in</span>
        </div>
        <div className="p-4">
        <p className="text-sm text-muted">
          Faction members only. Enter your Torn API key to verify your faction and continue.
        </p>

        <div className="mt-5 space-y-2">
          <label htmlFor="torn-api-key" className="text-xs font-bold">Torn API key</label>
          <input
            id="torn-api-key"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Paste your key…"
            autoFocus
            className="xp-field w-full"
          />
          <button
            onClick={submit}
            disabled={pending}
            aria-busy={pending}
            className="w-full xp-btn disabled:opacity-60"
          >
            {pending ? "Verifying…" : "Enter dashboard"}
          </button>
          {error && <p role="alert" className="text-sm text-[#cc0000]">{error}</p>}
        </div>

        <div className="mt-5 space-y-1 border-t border-border pt-4 text-xs text-muted">
          <p>
            Generate a key at{" "}
            <a
              href="https://www.torn.com/preferences.php#tab=api"
              target="_blank"
              rel="noreferrer"
              className="text-[#0000cc] hover:underline"
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
      </div>
    </main>
  );
}
