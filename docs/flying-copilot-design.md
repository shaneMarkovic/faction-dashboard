# Flying Co-Pilot — AI Chatbot Design

**Status:** Design proposal
**Scope:** Travel-trading assistant for `finance/flying`
**Capability:** Read-only advisor + drive the flying table UI (no Torn actions)
**AI:** Per-user, bring-your-own-key, multi-provider (Claude / OpenAI / Gemini)
**Date:** 2026-06-18

---

## 1. Goal & non-goals

### Goal
A conversational co-pilot embedded on [finance/flying](apps/web/src/app/(dash)/finance/flying/page.tsx) that turns the existing structured trading data into **reasoning and explanation**, and can **drive the table** (filter/sort/tune) in response to natural language.

The value is not "a chatbot." We already compute 27 metrics per opportunity and a probabilistic arrival forecast. What's missing is the layer that:
- explains *why* a run is recommended (and what the tradeoff is),
- makes the model's **uncertainty** (`pSuccess`, `forecastConfidence`) legible — currently invisible behind a color/`~` glyph,
- answers "is it worth flying to X right now?" against the user's actual capacity, wallet, and travel-time reduction,
- lets the user filter/sort the table by talking instead of clicking.

### Per-user AI configuration (new requirement)
Each member chooses their **provider** (Claude / OpenAI / Gemini / …), their **model**, and supplies their **own API key**. The app stores no shared LLM key and pays for no inference — cost is the user's, on their own account. Keys are encrypted at rest with the existing pattern.

### Non-goals (this phase)
- **No Torn actions.** Never buys, sells, or initiates travel. Read + UI control only.
- **No new trading data sources.** Reasons over what [finance.ts](apps/web/src/lib/finance.ts) and [forecast.ts](packages/shared/src/forecast.ts) already produce.
- **No invented numbers.** Every figure comes from a tool result (see §9).

---

## 2. Multi-provider strategy

The single biggest design force here is that **tool-calling shapes differ across providers** — Anthropic tools, OpenAI function calling, and Gemini function declarations are all different wire formats, with different streaming events and different reasoning/caching knobs. Hand-rolling three SDKs and keeping their tool loops in sync is the bulk of the work and the bulk of the bugs.

**Recommendation: use the Vercel AI SDK (`ai` package) as the provider abstraction.**

- One unified API (`streamText` / `generateText` + `tool()`) over `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`.
- Tools are defined **once**, provider-neutral (Zod schema + optional `execute`); the SDK translates to each provider's format.
- Uniform streaming, uniform tool-call handling, uniform message format.
- Natural fit for Next.js 16 / React 19 / TypeScript (this stack).
- Extensible: any OpenAI-compatible endpoint (local models, OpenRouter, etc.) works through `@ai-sdk/openai` with a custom `baseURL` — so "which providers" isn't locked to three.

Trade-off: a new dependency, and provider-specific features (Anthropic prompt caching, extended thinking) are exposed through per-provider `providerOptions` rather than first-class — acceptable, and documented in §7.

> If you'd rather not take the dependency, the alternative is a hand-written `LLMProvider` interface with one adapter per SDK. Same architecture below still applies — only §7's implementation changes. The AI SDK is strongly recommended; it's the right amount of abstraction for exactly this problem.

---

## 3. Why tool-calling, not context-stuffing

| Approach | How | Verdict |
|---|---|---|
| **Context-stuff** | Dump full `FlyingRow[]` into the prompt each turn | Rejected — wastes tokens, scales badly, defeats caching |
| **Tool-calling** | Expose existing `load*()` functions as tools; model fetches what it needs | **Chosen** — `finance.ts` is already the tool boundary; chat and table render from the same source so they can't disagree |

---

## 4. Architecture

```
finance/flying/page.tsx
   ├─ <FlyingTable/>        (existing — view state: country, sort, asc, under5h, cap, red)
   ├─ <FlyingChat/>   ◀── NEW chat panel
   └─ <AiSettings/>   ◀── NEW provider/model/key config (in finance settings)

   POST /api/finance-chat   { messages }     (memberId from session, never body)
        │  1. resolve memberId from session
        │  2. load user AI config: provider + model + DECRYPTED key   (server only)
        │  3. build provider via AI SDK from (provider, model, key)
        │  4. streamText() with tools:
        │       ├─ data tools → run loadFlyingOpportunities()/getFinancePrefs() server-side
        │       └─ ui tools   → NO execute; streamed to client as commands
        │  5. stream text + tool calls back (AI SDK data stream)
        ▼
   <FlyingChat/> applies ui-tool commands to a shared table-view store
```

### Drive-UI mechanism (unchanged by multi-provider)

[FlyingTable.tsx](apps/web/src/components/FlyingTable.tsx) holds view state locally (`country`, `sort`, `asc`, `under5h`) plus two **persisted** prefs (`cap`, `red`) saved via [actions.ts](apps/web/src/app/(dash)/finance/actions.ts) (`setTravelCapacity`, `setTravelTimeReduction`, `resetTravelCapacityAuto`).

We lift the view state into a small shared store (Zustand/context) read by both `<FlyingTable/>` and `<FlyingChat/>`. Then:
- **View tools** (filter/sort) → not run server-side; streamed to client, applied to the store, instant & reversible.
- **Pref tools** (capacity / time-reduction) → client calls the **existing** server actions + `router.refresh()`. No new write path.

Security boundary stays clean: the bot can only persist through the same two actions the user can already trigger by hand.

---

## 5. Security model for stored AI keys (do-not-leak design)

The existing Torn-key pattern is the baseline and is good: AES-256-GCM ([crypto.ts](packages/shared/src/crypto.ts)), master key in env via `KEY_ENCRYPTION_KEY` (**never** in the DB, never `NEXT_PUBLIC_`), decryption server-only and per-request (never cached), no logging of plaintext or ciphertext, access control at the app layer with RLS enabled as a backstop, DB reached through a service-role pool ([db.ts](apps/web/src/lib/db.ts)).

LLM keys are a **higher-value target** (billable money, usable from anywhere, the plaintext egresses to a third party). So we keep everything above **and add** the controls below.

### 5.1 Threat model → mitigation

| Threat | Mitigation |
|---|---|
| **DB dump leaks ciphertext** | Already covered: AES-256-GCM, master key not in DB. Ciphertext alone is useless. |
| **DB dump *and* env master key both leak** (single point of failure — one key decrypts everyone's) | **Accepted residual risk** — env-only deploy (Vercel + Render), no KMS. Reduce *likelihood* instead: treat `KEY_ENCRYPTION_KEY` as a platform secret (Vercel "Sensitive" env var — write-once, not readable back in the dashboard; Render secret env var/secret file), restrict who can view project env, and ensure a single leaked credential can't expose both `DATABASE_URL` and `KEY_ENCRYPTION_KEY` (different access scopes / don't paste both into the same place). Compensate for the missing KMS audit log with strict log scrubbing (below) and a rotation plan (§5.5). |
| **Row transplant** (attacker swaps user A's ciphertext into user B's row, or replays an old row) | **Bind ciphertext to the owner with AAD.** Pass `member_id` (and a `purpose` tag) as AES-GCM Additional Authenticated Data. Decryption then fails if the row is moved or repurposed. Cheap, high value — see 5.3. |
| **Key sent to an attacker endpoint** (the `openai_compatible` `base_url` is attacker-controlled, or config is tampered) | **base_url allowlist + SSRF guard**: `https://` only; reject private/loopback/link-local IPs and the cloud metadata host (`169.254.169.254`); resolve-and-check before use. Consider making `openai_compatible` opt-in/off by default. See §6. |
| **Key echoed in logs / errors / telemetry** (AI SDK & provider SDKs put `Authorization` in error objects) | Sanitize before logging: never log request bodies of `/api/finance-chat`; scrub `authorization`/`x-api-key`/`api_key` from any error before it reaches console/Sentry; disable AI SDK telemetry (`experimental_telemetry` off). |
| **Key leaks to the client** | Never return the key from any action; never include it in the chat data-stream or any RSC payload. UI only ever sees a masked hint (`sk-…1234`). |
| **IDOR / cross-member read** | `memberId` from session **only**, never from the request body or a query param. No endpoint accepts a member id. RLS stays on as defense-in-depth. |
| **App server compromise** | Unavoidable that plaintext flows through the server (it makes the calls). Limit the damage: decrypt per-request, never cache plaintext, never write it to disk, keep its in-memory lifetime minimal. KMS decrypt-audit-logs make abuse detectable. |
| **We can't revoke the user's key for them** | Make self-service revoke/delete one click, and tell the user to also rotate at the provider. Encourage a **spend cap** on their provider key (see §10) so a leak is bounded. |

### 5.2 Storage table (migration `00XX_ai_config.sql`)
```sql
create table user_ai_config (
  member_id      bigint primary key references members(id),
  provider       text not null,         -- 'anthropic' | 'openai' | 'google' | 'openai_compatible'
  model          text not null,         -- e.g. 'claude-opus-4-8'
  encrypted_key  bytea not null,        -- iv||tag||ciphertext, AAD-bound to member_id (see 5.3)
  base_url       text,                  -- only for openai_compatible; allowlist-checked
  key_hint       text not null,         -- last 4 chars only, for the UI ('…1234')
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- RLS enabled, no client policies (mirror 0009_rls_finance.sql). Service-role reads only.
```
`bytea` (not `text`) matches the existing `api_keys.encrypted_key` and `encryptKey()` output. A dedicated table (vs. `purpose='llm'` on `api_keys`) is cleaner because it carries provider/model/base_url alongside the key.

### 5.3 Add AAD to the crypto helper
Today `encryptKey(plaintext, key)` uses no AAD. Extend it (backward-compatible — AAD defaults to empty) so AI keys can be bound to their owner:
```ts
export function encryptKey(plaintext, key, aad?: Buffer) {
  const cipher = createCipheriv(ALGO, key, iv);
  if (aad) cipher.setAAD(aad);
  // ...unchanged
}
export function decryptKey(blob, key, aad?: Buffer) {
  // ...setAuthTag, then:
  if (aad) decipher.setAAD(aad);
  // throws on mismatch — i.e. if the row was transplanted
}
```
For AI keys: `aad = Buffer.from(\`llm:${memberId}\`)`. Torn keys keep calling the no-AAD form, so nothing existing changes.

### 5.4 Handling rules (carry over + tighten)
- Plaintext exists only for the duration of one server request; decrypted in the route, never cached, never logged, never returned to the client.
- Save path mirrors `connectFinanceKey`: validate the key live (§10), `encryptKey(raw, encryptionKey(), aad)`, store ciphertext + `key_hint`, discard plaintext. Generic error messages only — never echo the key or a provider error that contains it.
- Settings UI shows only `key_hint` and "replace"/"remove"; it never reads the stored key back.
- No shared/fallback key. No config → chat panel shows "set up your AI"; nothing is called.
- **Optional "don't persist" mode:** for the security-conscious, offer a session-only key (held in an encrypted, httpOnly cookie or server session, never written to the DB). Worse UX, best at-rest posture — a toggle, not the default.

### 5.5 Deployment notes (Vercel + Render, env-only)
- **No new secret.** Reuse the existing 32-byte `KEY_ENCRYPTION_KEY` — `encryptionKey()` already validates it. AI keys add rows under the same master key; the AAD (§5.3) is what separates LLM keys from Torn keys, not a second master.
- **Set it as a sensitive/secret env var** on both platforms (Vercel: mark "Sensitive"; Render: secret env var or secret file), production-scoped, and never `NEXT_PUBLIC_`. Same for `DATABASE_URL`.
- **Serverless fits the model.** Vercel functions are stateless and short-lived, which matches per-request decrypt-and-discard — just never stash plaintext in a module-level variable that could survive warm invocations.
- **Function logs are the leak risk here.** Vercel/Render capture stdout/stderr; an unscrubbed provider error or a logged request body would land in their log retention. The log-scrubbing rule (§5.1) is the main compensating control for having no KMS audit trail — treat it as mandatory, not nice-to-have.
- **Rotation has a cost:** rotating `KEY_ENCRYPTION_KEY` means re-encrypting every row (Torn + LLM). Plan a one-off re-encrypt migration (decrypt with old, encrypt with new) before rotating; until then, rotate only on suspected compromise.

---

## 6. Provider / model registry

A typed, curated registry drives the settings dropdowns and validates `(provider, model)` server-side.

```ts
// packages/shared/src/ai-registry.ts
export const AI_PROVIDERS = {
  anthropic: {
    label: "Claude (Anthropic)",
    keyHint: "sk-ant-…",
    models: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"],
    // claude-fable-5 optional (most capable; pricier)
  },
  openai: {
    label: "ChatGPT (OpenAI)",
    keyHint: "sk-…",
    models: [/* confirm against OpenAI's current catalog at build time */],
  },
  google: {
    label: "Gemini (Google)",
    keyHint: "AIza…",
    models: [/* confirm against Google's current catalog */],
  },
  openai_compatible: {
    label: "Custom (OpenAI-compatible)",
    keyHint: "varies",
    models: [],            // user supplies model id + base_url
    requiresBaseUrl: true,
  },
} as const;
```

- **Claude model IDs are authoritative** (`claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5`; `claude-fable-5` for most-capable). For OpenAI/Google, populate the list from each provider's current catalog when implementing — don't ship stale IDs. The registry is the one place to update them.
- The route rejects any `(provider, model)` not in the registry (except `openai_compatible`, which accepts a free-form model + `base_url`).
- **`openai_compatible` is the one risky entry** (the key gets sent to a user-supplied URL). Validate `base_url` on save *and* before each call: `https://` only, reject loopback/private/link-local IPs and the metadata host `169.254.169.254` (resolve the hostname and re-check, to defeat DNS rebinding). Consider shipping it disabled by default / behind an explicit "advanced" toggle. See §5.1.
- Recommended default offered in the UI: **Claude `claude-opus-4-8`** — best reasoning on the "why / is it worth it" questions that are the point of this feature.

---

## 7. The chat route — `POST /api/finance-chat`

**Request:** `{ messages }`. `memberId` from session only (prevents cross-member data access).

**Server flow:**
1. Resolve `memberId`; load `user_ai_config`; if none → stream a "configure your AI" message.
2. `decryptKey(encrypted_key)`; build the AI SDK model:
   ```ts
   const model =
     provider === "anthropic" ? anthropic(modelId, { apiKey })
   : provider === "openai"    ? openai(modelId, { apiKey })
   : provider === "google"    ? google(modelId, { apiKey })
   : openai(modelId, { apiKey, baseURL });   // openai_compatible
   ```
3. `streamText({ model, system, messages, tools, maxSteps })` and return its data-stream response. `<FlyingChat/>` consumes it with the AI SDK React hook.

**Provider-specific knobs (best-effort, via `providerOptions`):**
- **Anthropic** — enable prompt caching on the system+tools prefix and adaptive thinking. Cache hit-rate matters most here since the system prompt is large and frozen.
- **OpenAI / Google** — automatic/implicit caching; reasoning models expose their own effort/thinking params. Set sensible per-provider defaults; don't assume Anthropic features exist elsewhere.
- These live behind the registry so the route stays clean.

**Streaming/limits:** always stream; cap output (~8000 tokens). Handle auth failures (bad/expired user key) and rate limits with a friendly chat message naming the provider, so the user knows it's *their* key/quota, not the app.

---

## 8. Tools (provider-neutral, defined once)

Defined with the AI SDK `tool()` helper + Zod. Data tools have `execute` (server-side); UI/pref tools omit `execute` so the call surfaces to the client.

### Data tools (server-executed)
**`get_flying_opportunities`** — wraps `loadFlyingOpportunities(memberId)`.
```jsonc
input:  { country?, sortBy?: "profitPerHour|tripProfit|roiPct|predictedOnArrival|pSuccess",
          minOdds?, maxRoundTripMin?, limit? = 8 }
output: { rows: FlyingRow[], capacity, capacityOverride, detectedCapacity,
          timeReduction, wallet, travelStatus }
```
Returns a trimmed, filtered, sorted slice so the model gets a small relevant payload. The model quotes `pSuccess`, `forecastConfidence`, `trend`, `tripProfit` **verbatim** — never recomputes.

**`get_finance_prefs`** — wraps `getFinancePrefs(memberId)` → `{ travelCapacity, travelTimeReduction }`.

### UI tools (client-applied)
**`set_table_filter`** — `{ country?, under5h?, minOdds? }`
**`set_table_sort`** — `{ sortBy: SortKey, ascending? }` (`SortKey` per [FlyingTable.tsx:9](apps/web/src/components/FlyingTable.tsx#L9))

### Pref tools (client → existing server actions, confirm first)
**`set_capacity`** — `{ value: number | "auto" }` → `setTravelCapacity` / `resetTravelCapacityAuto` + `router.refresh()`
**`set_time_reduction`** — `{ percent: number }` → `setTravelTimeReduction` + `router.refresh()`

Because the AI SDK keeps tool definitions provider-neutral, the same four tools work identically whether the user picked Claude, GPT, or Gemini.

---

## 9. System prompt & grounding (provider-independent)

Frozen, identical across providers (cache-friendly on Anthropic). Key clauses:

```
You are the Flying Co-Pilot for a Torn travel-trading dashboard.

GROUNDING (absolute):
- Never state a number you didn't get from a tool result. No estimates, no
  remembered prices, no made-up odds.
- Arrival odds/confidence come from get_flying_opportunities (pSuccess,
  forecastConfidence). Quote them; never invent a probability.
- forecastConfidence < 0.3 = model still warming up. Say the prediction is
  low-confidence and why (few samples, or irregular-restock item).

REASONING:
- "Best run" = risk-adjusted: weigh profitPerHour against pSuccess. A 52% ROI
  at 38% odds is often worse than 31% ROI at 81%. Show the tradeoff.
- Account for capacity, wallet (cashLimited/cashShort), longHaul energy/nerve.
- Flag museumValue, variableQuality, irregularRestock when they change the call.

DRIVING THE UI:
- Use set_table_filter / set_table_sort freely.
- set_capacity / set_time_reduction change SAVED settings — ASK before calling.

STYLE: lead with the recommendation, then the why. Concise.
```

---

## 10. Settings UI — `<AiSettings/>`

In the finance settings area:
- **Provider** dropdown (from registry) → **Model** dropdown (filtered by provider) → **API key** input (+ optional Base URL for custom).
- **Validate on save:** server makes one cheap test call (tiny `generateText`, minimal tokens) with the chosen provider/model/key. On success, store; on failure, surface the provider's error ("OpenAI rejected this key").
- Shows masked key + "replace" / "remove" (one-click revoke; reminds the user to also rotate at the provider, since we can't revoke it for them — §5.1).
- Per-provider help line linking to where each key is created, **and a nudge to set a spend cap / use a project-scoped key** on the provider side, so a leak is bounded.

---

## 11. Hallucination & safety guardrails

1. **Numbers only from tools** — structural: the model has no live data except tool results, regardless of provider.
2. **Uncertainty is first-class** — must surface `forecastConfidence < 0.3` as low-confidence. Highest-value behavior.
3. **Read-only by construction** — no tool buys/sells/travels; only writes are the two existing pref actions, gated behind confirmation.
4. **Per-user isolation** — `memberId` from session only; data tools bound to that member's `personalTornClient`.
5. **Key security** — full model in §5: AES-256-GCM + AAD-bound-to-owner, master key as a platform secret env var (not the DB, not the client bundle), decrypted only in-request and never cached, `base_url` SSRF-guarded, logs/telemetry scrubbed of `authorization`/`x-api-key` (the main compensating control with no KMS audit trail), masked in UI, one-click revoke.
6. **Provider errors are the user's** — bad key / quota / rate-limit messages name the provider so the user fixes *their* account, not ours (and never echo a provider error string that might contain the key).

---

## 12. Implementation plan

**Phase 0 — Config & storage (new, do first)**
1. `user_ai_config` table + migration; `ai-registry.ts`.
2. `<AiSettings/>` UI + save/validate server action (reusing `encryptKey`/`decryptKey`).

**Phase 1 — Read-only advisor**
3. Add `ai` + `@ai-sdk/anthropic` `@ai-sdk/openai` `@ai-sdk/google`.
4. `/api/finance-chat`: session → config → decrypt → AI SDK `streamText` with `get_flying_opportunities` + `get_finance_prefs`.
5. `<FlyingChat/>` panel (AI SDK React hook) + system prompt + suggested prompts.
*Delivers the core value: "best run", "is it worth flying to X", "why low-confidence" — on whatever provider the user configured.*

**Phase 2 — Drive the table**
6. Lift `FlyingTable` view state into a shared store.
7. `set_table_filter` / `set_table_sort` UI tools + action chips.

**Phase 3 — Tune prefs (gated)**
8. `set_capacity` / `set_time_reduction` → existing actions, confirm-before-write.

---

## 13. Open questions / risks

- **Provider feature parity** — prompt caching and extended thinking are Anthropic-shaped; OpenAI/Gemini differ. The AI SDK smooths most of it, but per-provider defaults need a light tuning pass. Don't rely on a feature existing across all three.
- **Model registry staleness** — OpenAI/Google model IDs change; keep them in `ai-registry.ts` and confirm against each provider's catalog at implementation time. Claude IDs are authoritative as listed.
- **Shared-store refactor** (Phase 2) touches `FlyingTable` — low risk, but bot-driven and manual controls must coexist.
- **Cost is the user's** — no app-side LLM spend, but means UX must clearly attribute key/quota errors to the user's provider account.
- **`KEY_ENCRYPTION_KEY` dependency** — already required for Torn keys; LLM keys add no new app secret, just more rows under the same key (per-owner AAD separates them). Env-only on Vercel/Render means no KMS audit trail, so log scrubbing is the load-bearing control; rotating the key requires a re-encrypt migration across both purposes (§5.5).
- **Validation cost** — the save-time test call costs the user a few tokens on their own key; keep it minimal.
