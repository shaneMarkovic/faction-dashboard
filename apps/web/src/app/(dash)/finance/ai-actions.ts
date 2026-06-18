"use server";

import { revalidatePath } from "next/cache";
import {
  AI_PROVIDERS,
  aiKeyAad,
  checkBaseUrl,
  encryptKey,
  encryptionKey,
  isAiProvider,
  isKnownModel,
  type AiProvider,
} from "@torn/shared";
import { tryQuery } from "@/lib/db";
import { getSession } from "@/lib/session";

/** What the settings UI is allowed to see — never the key itself. */
export interface AiConfigStatus {
  configured: boolean;
  provider?: AiProvider;
  model?: string;
  /** Last 4 chars only, for display ("…1234"). */
  keyHint?: string;
  baseUrl?: string | null;
}

interface SaveInput {
  provider: string;
  model: string;
  key: string;
  baseUrl?: string;
}

/** Current AI config for the logged-in member, masked. Never returns the key. */
export async function getAiConfig(): Promise<AiConfigStatus> {
  const session = await getSession();
  if (!session) return { configured: false };

  const rows = await tryQuery<{
    provider: AiProvider;
    model: string;
    key_hint: string;
    base_url: string | null;
  }>(
    "select provider, model, key_hint, base_url from user_ai_config where member_id = $1",
    [session.tornId],
  );
  if (!rows || rows.length === 0) return { configured: false };

  const r = rows[0]!;
  return {
    configured: true,
    provider: r.provider,
    model: r.model,
    keyHint: r.key_hint,
    baseUrl: r.base_url,
  };
}

/**
 * Validate and store the member's AI provider/model/key. The key is validated
 * live against the provider, then encrypted (AAD-bound to the member) and
 * upserted. The raw key is never logged or returned.
 */
export async function saveAiConfig(
  input: SaveInput,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Session expired — sign in again." };

  const provider = (input.provider || "").trim();
  if (!isAiProvider(provider)) return { ok: false, error: "Unknown provider." };

  const model = (input.model || "").trim();
  if (!isKnownModel(provider, model)) {
    return { ok: false, error: "Pick a model for this provider." };
  }

  const key = (input.key || "").trim();
  if (!key) return { ok: false, error: "Paste your API key." };

  // base_url only for openai_compatible; SSRF-checked.
  let baseUrl: string | null = null;
  if (AI_PROVIDERS[provider].requiresBaseUrl) {
    const checked = checkBaseUrl(input.baseUrl || "");
    if (!checked.ok) return { ok: false, error: checked.error };
    baseUrl = checked.url;
  }

  const valid = await validateProviderKey(provider, key, baseUrl);
  if (!valid.ok) return { ok: false, error: valid.error };

  let encrypted: Buffer;
  try {
    encrypted = encryptKey(key, encryptionKey(), aiKeyAad(session.tornId));
  } catch {
    return { ok: false, error: "Server can't store keys right now. Try again later." };
  }

  const saved = await tryQuery(
    `insert into user_ai_config (member_id, provider, model, encrypted_key, base_url, key_hint, updated_at)
     values ($1, $2, $3, $4, $5, $6, now())
     on conflict (member_id) do update set
       provider = excluded.provider,
       model = excluded.model,
       encrypted_key = excluded.encrypted_key,
       base_url = excluded.base_url,
       key_hint = excluded.key_hint,
       updated_at = now()`,
    [session.tornId, provider, model, encrypted, baseUrl, key.slice(-4)],
  );
  if (saved == null) return { ok: false, error: "Couldn't save your config. Try again." };

  revalidatePath("/finance/flying");
  return { ok: true };
}

export async function removeAiConfig(): Promise<void> {
  const session = await getSession();
  if (!session) return;
  await tryQuery("delete from user_ai_config where member_id = $1", [session.tornId]);
  revalidatePath("/finance/flying");
}

/**
 * Cheap liveness check of (provider, key): a single authenticated GET to the
 * provider's model-list endpoint. No tokens billed. Never logs the key, and
 * surfaces only a status code — provider error bodies (which may echo the key)
 * are not propagated.
 */
async function validateProviderKey(
  provider: AiProvider,
  key: string,
  baseUrl: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const signal = AbortSignal.timeout(8000);
  try {
    let res: Response;
    switch (provider) {
      case "anthropic":
        res = await fetch("https://api.anthropic.com/v1/models", {
          headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
          signal,
        });
        return res.ok
          ? { ok: true }
          : { ok: false, error: `Anthropic rejected the key (HTTP ${res.status}).` };
      case "openai":
        res = await fetch("https://api.openai.com/v1/models", {
          headers: { authorization: `Bearer ${key}` },
          signal,
        });
        return res.ok
          ? { ok: true }
          : { ok: false, error: `OpenAI rejected the key (HTTP ${res.status}).` };
      case "google":
        // key in header (x-goog-api-key), never in the URL/query → no key in logs.
        res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
          headers: { "x-goog-api-key": key },
          signal,
        });
        return res.ok
          ? { ok: true }
          : { ok: false, error: `Google rejected the key (HTTP ${res.status}).` };
      case "openai_compatible":
        res = await fetch(`${baseUrl}/models`, {
          headers: { authorization: `Bearer ${key}` },
          signal,
        });
        return res.ok
          ? { ok: true }
          : { ok: false, error: `Endpoint rejected the key (HTTP ${res.status}).` };
    }
  } catch {
    return { ok: false, error: "Couldn't reach the provider to validate the key." };
  }
}
