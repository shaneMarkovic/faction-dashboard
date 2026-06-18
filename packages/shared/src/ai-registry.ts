/**
 * AI provider + model registry for the Flying Co-Pilot.
 * See docs/flying-copilot-design.md §6.
 *
 * One curated source of truth for the providers/models offered in the settings
 * UI and accepted by the server. Claude model IDs are authoritative; the
 * OpenAI/Google lists are STUBS — confirm them against each provider's current
 * catalog when wiring Phase 1 (the chat route), then update here.
 */

export type AiProvider = "anthropic" | "openai" | "google" | "openai_compatible";

export interface ProviderInfo {
  /** Human label for the dropdown. */
  label: string;
  /** Placeholder shown in the key input (a format hint, not a real key). */
  keyHint: string;
  /** Curated model ids. Empty when the user supplies their own (custom). */
  models: readonly string[];
  /** Requires a user-supplied base_url (OpenAI-compatible endpoints). */
  requiresBaseUrl?: boolean;
  /** Accepts a free-form model id instead of one from `models`. */
  allowsCustomModel?: boolean;
}

export const AI_PROVIDERS: Record<AiProvider, ProviderInfo> = {
  anthropic: {
    label: "Claude (Anthropic)",
    keyHint: "sk-ant-…",
    // Authoritative as of the design date.
    models: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"],
  },
  openai: {
    label: "ChatGPT (OpenAI)",
    keyHint: "sk-…",
    // STUB — confirm against OpenAI's current catalog before Phase 1.
    models: ["gpt-5", "gpt-5-mini", "gpt-4.1"],
  },
  google: {
    label: "Gemini (Google)",
    keyHint: "AIza…",
    // STUB — confirm against Google's current catalog before Phase 1.
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
  },
  openai_compatible: {
    label: "Custom (OpenAI-compatible)",
    keyHint: "varies by host",
    models: [],
    requiresBaseUrl: true,
    allowsCustomModel: true,
  },
};

export const AI_PROVIDER_IDS = Object.keys(AI_PROVIDERS) as AiProvider[];

export function isAiProvider(v: unknown): v is AiProvider {
  return typeof v === "string" && v in AI_PROVIDERS;
}

/** True if `model` is acceptable for `provider` (known id, or any non-empty
 * string for providers that allow custom models). */
export function isKnownModel(provider: AiProvider, model: string): boolean {
  const info = AI_PROVIDERS[provider];
  if (!info) return false;
  if (info.allowsCustomModel) return model.trim().length > 0;
  return info.models.includes(model);
}

/** AAD that binds an encrypted LLM key to its owning member (§5.3). */
export function aiKeyAad(memberId: number): Buffer {
  return Buffer.from(`llm:${memberId}`);
}

/**
 * Structural SSRF guard for a user-supplied `base_url` (openai_compatible).
 * https only; rejects loopback / private / link-local / metadata hosts.
 *
 * NOTE: this is the structural check done at save time. A DNS-resolve recheck
 * at call time (defeating DNS rebinding) is added with the chat route in
 * Phase 1 — see docs/flying-copilot-design.md §5.1 / §6.
 */
export function checkBaseUrl(
  raw: string,
): { ok: true; url: string } | { ok: false; error: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: "Base URL is not a valid URL." };
  }
  if (u.protocol !== "https:") {
    return { ok: false, error: "Base URL must use https." };
  }
  if (isBlockedHost(u.hostname)) {
    return { ok: false, error: "Base URL host is not allowed (private/loopback/metadata)." };
  }
  // Normalize: strip trailing slash so callers can append "/models" etc.
  return { ok: true, url: u.toString().replace(/\/$/, "") };
}

function isBlockedHost(hostnameRaw: string): boolean {
  const host = hostnameRaw.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (host === "localhost" || host.endsWith(".localhost") || host === "metadata.google.internal") {
    return true;
  }
  // IPv6 loopback / link-local / unique-local.
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) {
    return true;
  }
  // IPv4 literal ranges: loopback, 0.x, link-local (incl. 169.254.169.254 metadata),
  // and private 10/172.16-31/192.168.
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 0 || a === 10) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}
