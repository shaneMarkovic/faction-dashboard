"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AiProvider, ProviderInfo } from "@torn/shared";
import {
  type AiConfigStatus,
  removeAiConfig,
  saveAiConfig,
  updateAiModel,
} from "@/app/(dash)/finance/ai-actions";

type Providers = Record<AiProvider, ProviderInfo>;

export function AiSettingsForm({
  providers,
  initial,
}: {
  providers: Providers;
  initial: AiConfigStatus;
}) {
  const entries = useMemo(
    () => Object.entries(providers) as [AiProvider, ProviderInfo][],
    [providers],
  );

  const [editing, setEditing] = useState(!initial.configured);
  const [provider, setProvider] = useState<AiProvider>(initial.provider ?? "anthropic");
  const info = providers[provider];

  const [model, setModel] = useState(initial.model ?? info.models[0] ?? "");
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl ?? "");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  const onProvider = (p: AiProvider) => {
    setProvider(p);
    const next = providers[p];
    setModel(next.allowsCustomModel ? "" : (next.models[0] ?? ""));
    setError(null);
  };

  // Same provider already configured, and no new key typed → switch model only,
  // keeping the stored key. Otherwise do a full (re)validate + save.
  const sameProvider = initial.configured && provider === initial.provider;
  const modelOnly = sameProvider && !key.trim();

  const submit = () => {
    setError(null);
    setSaved(false);
    start(async () => {
      const res = modelOnly
        ? await updateAiModel(model)
        : await saveAiConfig({ provider, model, key, baseUrl });
      if (res.ok) {
        setKey("");
        setSaved(true);
        setEditing(false);
        router.refresh();
      } else {
        setError(res.error ?? "Couldn't save that.");
      }
    });
  };

  const remove = () => {
    setError(null);
    start(async () => {
      await removeAiConfig();
      setKey("");
      setEditing(true);
      router.refresh();
    });
  };

  // Compact summary when configured and not editing.
  if (initial.configured && !editing) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">
            {providers[initial.provider!]?.label ?? initial.provider}
          </span>
          <span className="text-muted">{initial.model}</span>
          <span className="text-xs text-muted">key …{initial.keyHint}</span>
          {saved && <span className="text-xs text-[#3fb950]">saved ✓</span>}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:text-foreground"
          >
            Change
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-[#f85149] hover:bg-surface-2 disabled:opacity-60"
          >
            Remove
          </button>
        </div>
        <p className="text-xs text-muted">
          Your key is encrypted at rest and used only to power your co-pilot
          chats. Removing it here does not revoke it at the provider — rotate it
          in your provider account if it may have leaked.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Provider
          <select
            value={provider}
            onChange={(e) => onProvider(e.target.value as AiProvider)}
            className="rounded-md border border-border bg-surface-2 px-2 py-2 text-sm text-foreground outline-none"
          >
            {entries.map(([id, p]) => (
              <option key={id} value={id}>{p.label}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted">
          Model
          {info.allowsCustomModel ? (
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="model id (e.g. llama-3.1-70b)"
              className="rounded-md border border-border bg-surface-2 px-2 py-2 text-sm text-foreground outline-none"
            />
          ) : (
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="rounded-md border border-border bg-surface-2 px-2 py-2 text-sm text-foreground outline-none"
            >
              {info.models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}
        </label>
      </div>

      {info.requiresBaseUrl && (
        <label className="flex flex-col gap-1 text-xs text-muted">
          Base URL
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://your-endpoint.example.com/v1"
            className="rounded-md border border-border bg-surface-2 px-2 py-2 text-sm text-foreground outline-none"
          />
        </label>
      )}

      <label className="flex flex-col gap-1 text-xs text-muted">
        {sameProvider ? "API key — leave blank to keep current" : "API key"}
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={sameProvider ? `keeping …${initial.keyHint}` : info.keyHint}
          aria-label="AI provider API key"
          className="rounded-md border border-border bg-surface-2 px-2 py-2 text-sm text-foreground outline-none"
        />
      </label>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          aria-busy={pending}
          className="rounded-md bg-[#22c48a] px-4 py-2 text-sm font-semibold text-[#0f0f0f] disabled:opacity-60"
        >
          {pending ? (modelOnly ? "Saving…" : "Validating…") : modelOnly ? "Save model" : "Save key"}
        </button>
        {initial.configured && (
          <button
            type="button"
            onClick={() => { setEditing(false); setError(null); }}
            className="rounded-md border border-border px-3 py-2 text-sm hover:text-foreground"
          >
            Cancel
          </button>
        )}
        {error && <p role="alert" className="text-sm text-[#f85149]">{error}</p>}
      </div>

      <p className="text-xs text-muted">
        Bring your own key — you pick the provider and pay for usage on your own
        account. The key is validated against the provider, then stored encrypted
        (AES-256-GCM, bound to your account) and never shown again. Tip: set a
        spend limit on the key in your provider account.
      </p>
    </div>
  );
}
