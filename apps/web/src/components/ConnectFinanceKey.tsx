"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { connectFinanceKey } from "@/app/(dash)/finance/actions";

/** Selections the personal finance key needs, for the Torn key-creation link. */
const FINANCE_SELECTIONS = [
  "money",
  "personalstats",
  "log",
  "travel",
  "stocks",
  "perks",
  "bars",
];

// VERIFY: confirm Torn's key-creation deep-link format (param names + fragment
// ordering) against live Torn before relying on the pre-selected scopes. The
// plain API settings page is always a safe fallback.
const KEY_DEEP_LINK =
  "https://www.torn.com/preferences.php#tab=api?step=addNewKey" +
  "&title=Faction+Dashboard+Finance" +
  `&user=${FINANCE_SELECTIONS.join(",")}`;

export function ConnectFinanceKey({ reconnect = false }: { reconnect?: boolean }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const submit = () => {
    setError(null);
    start(async () => {
      const res = await connectFinanceKey(key);
      if (res.ok) {
        setKey("");
        router.refresh();
      } else {
        setError(res.error ?? "Couldn't connect that key.");
      }
    });
  };

  return (
    <div className="mx-auto max-w-lg">
      <div className="rounded-2xl border border-border bg-surface p-6">
        <h1 className="text-lg font-bold">💵 {reconnect ? "Reconnect your finance key" : "Connect your finance data"}</h1>
        <p className="mt-1 text-sm text-muted">
          {reconnect
            ? "Your finance key looks invalid or is missing a permission. Create a fresh key with the access below and paste it again."
            : "Finance reads your own money, net worth, activity log and travel. It needs a personal key with custom access — separate from your login key."}
        </p>

        <ol className="mt-4 space-y-2 text-sm text-muted">
          <li>
            <span className="font-medium text-foreground">1.</span> Create a{" "}
            <strong>Custom</strong> key on Torn with these selections:
            <div className="mt-1 flex flex-wrap gap-1">
              {FINANCE_SELECTIONS.map((s) => (
                <span key={s} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">{s}</span>
              ))}
            </div>
          </li>
          <li>
            <span className="font-medium text-foreground">2.</span>{" "}
            <a
              href={KEY_DEEP_LINK}
              target="_blank"
              rel="noreferrer"
              className="text-[#0000cc] hover:underline"
            >
              Open Torn’s key creator with these pre-selected →
            </a>{" "}
            <span className="text-xs">
              (or go to{" "}
              <a
                href="https://www.torn.com/preferences.php#tab=api"
                target="_blank"
                rel="noreferrer"
                className="text-[#0000cc] hover:underline"
              >
                Settings → API
              </a>
              )
            </span>
          </li>
          <li>
            <span className="font-medium text-foreground">3.</span> Paste the new key:
          </li>
        </ol>

        <div className="mt-3 space-y-2">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Paste your finance key…"
            aria-label="Finance API key"
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-muted"
          />
          <button
            onClick={submit}
            disabled={pending}
            aria-busy={pending}
            className="w-full xp-btn disabled:opacity-60"
          >
            {pending ? "Connecting…" : "Connect finance key"}
          </button>
          {error && <p role="alert" className="text-sm text-[#cc0000]">{error}</p>}
        </div>

        <p className="mt-4 border-t border-border pt-3 text-xs text-muted">
          Stored encrypted (AES-256-GCM), never shown to other members, and used
          only to read your own data. Disconnect anytime from the Finance tabs.
        </p>
      </div>
    </div>
  );
}
