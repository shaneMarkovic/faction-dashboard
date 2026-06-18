-- Flying Co-Pilot: per-user AI configuration (provider + model + the member's
-- own LLM API key). See docs/flying-copilot-design.md §5.
--
-- The key is AES-256-GCM encrypted with KEY_ENCRYPTION_KEY (the same master key
-- as api_keys), additionally AAD-bound to the owner ('llm:<member_id>') so a row
-- can't be transplanted to another member and still decrypt. key_hint stores
-- only the last few chars for the UI — never the key.
--
-- RLS enabled with NO policies: only the service-role connection (the web
-- server) can read it; Supabase's public REST API (anon key) cannot. Mirrors
-- the posture in 0009_rls_finance.sql.

create table user_ai_config (
  member_id     bigint primary key,
  provider      text not null
    check (provider in ('anthropic', 'openai', 'google', 'openai_compatible')),
  model         text not null,
  encrypted_key bytea not null,         -- iv || tag || ciphertext (AAD = 'llm:<member_id>')
  base_url      text,                   -- only for openai_compatible; https, allowlist-checked
  key_hint      text not null,          -- last 4 chars only, e.g. '1234'
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table user_ai_config enable row level security;
