/**
 * Resolve a member's configured AI provider/model into an AI SDK model
 * instance, using their own (decrypted) key. Server-only — the plaintext key
 * lives for the duration of the request and never leaves this module.
 *
 * See docs/flying-copilot-design.md §7.
 */

import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { type AiProvider, aiKeyAad, decryptKey, encryptionKey } from "@torn/shared";
import { tryQuery } from "@/lib/db";

export interface ResolvedModel {
  model: LanguageModel;
  /** Friendly provider name for error messages (never includes the key). */
  providerLabel: string;
}

/**
 * Build the model for a member, or null if they have no config / the key can't
 * be decrypted (rotated master key, tamper, or AAD mismatch from a moved row).
 */
export async function resolveMemberModel(memberId: number): Promise<ResolvedModel | null> {
  const rows = await tryQuery<{
    provider: AiProvider;
    model: string;
    encrypted_key: Buffer;
    base_url: string | null;
  }>(
    "select provider, model, encrypted_key, base_url from user_ai_config where member_id = $1",
    [memberId],
  );
  const row = rows?.[0];
  if (!row) return null;

  let key: string;
  try {
    key = decryptKey(row.encrypted_key, encryptionKey(), aiKeyAad(memberId));
  } catch {
    return null;
  }

  switch (row.provider) {
    case "anthropic":
      return { model: createAnthropic({ apiKey: key })(row.model), providerLabel: "Claude" };
    case "openai":
      return { model: createOpenAI({ apiKey: key })(row.model), providerLabel: "OpenAI" };
    case "google":
      return { model: createGoogleGenerativeAI({ apiKey: key })(row.model), providerLabel: "Gemini" };
    case "openai_compatible":
      return {
        model: createOpenAI({ apiKey: key, baseURL: row.base_url ?? undefined })(row.model),
        providerLabel: "your endpoint",
      };
  }
}
