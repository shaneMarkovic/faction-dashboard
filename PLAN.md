# Torn Faction Dashboard — Build Plan

> Real-time faction command center for Torn City.
> Stack: **Next.js full-stack** · members submit their own API keys · live updates pushed to the browser · Discord integration · Torn userscript for event-driven refresh.
> **Multi-faction by design:** one Discord server (guild) can host several factions — e.g. a main faction plus a noob-friendly/feeder one — and the same app instance serves all of them, each fully isolated.

API base: `https://api.torn.com/v2` · OpenAPI: `openapi.json` (v6.0.0, 46 faction endpoints).

---

## 1. Goals

- **Instant.** Anything that happens in Torn (a hit lands, a chain ticks, an OC fills, a war score changes) shows up in the app within ~1–2s — without every client hammering the Torn API.
- **One screen for ops.** Chain warmer, OC slot assignment, member readiness, armory/money — the things factions currently juggle in spreadsheets and Discord pins.
- **Push, not poll, on the client.** The browser never calls Torn directly. A backend collector owns all Torn traffic; clients subscribe to a realtime channel.
- **Discord native.** Critical events (chain about to drop, OC ready, war started, member needs revive) fire into Discord automatically.
- **Multi-faction per server.** A single Discord server / app deployment can run several factions side by side (main + feeder/noob faction, allied factions, etc.). Every faction is its own tenant: own key pool, own data, own channels, own role-gating — but shared infra and one place to switch between them.

---

## 2. Feature scope (v1)

All four modules ship in v1. Each maps to concrete endpoints.

### 2.1 OC 2.0 board — the spreadsheet-killer
Source: `GET /faction/crimes` (and `/faction/{crimeId}/crime`).
Each crime returns `slots[]`, each slot has `checkpoint_pass_rate` (CPR), `position`, assigned `user`, `status`, `ready_at`, `expired_at`.
- Grid of active OCs → which slots are filled/empty.
- **CPR-aware assignment helper**: for an empty slot, show each idle member's CPR for that slot to maximize success.
- "Ready to execute" badge (`ready_at` passed), "expiring soon" warning (`expired_at`).
- Idle finder: `FactionMember.is_in_oc == false` → who isn't in a crime.

### 2.2 Chain + war command center
- `GET /faction/chain` → `current`, `max`, `timeout` (sec until break), `cooldown`, `modifier`. Big visible **chain timer with a configurable "warmer needed" alarm**.
- `GET /faction/rankedwars` + `GET /faction/{rankedWarId}/rankedwarreport` → live score, lead, per-member contribution.
- `GET /faction/attacks` / `attacksfull` → who's hitting, respect, retals, assists → war leaderboard.
- `GET /faction/territory`, `/territorywars`, `/raids`, `/{...}report` → TT/raid ops.

### 2.3 Member status grid
Source: `GET /faction/members`.
Per member: `status` (Okay / Hospital / Traveling / Jail **with countdown**), `last_action`, `is_on_wall`, `is_revivable`, `has_early_discharge`, `revive_setting`, `position`, `days_in_faction`, `level`.
- Color-coded status board with live hospital/travel countdowns.
- **Inactivity report** from `last_action` → kick candidates.
- **Revive board** (`is_revivable` + `revive_setting`) for revive teams.

### 2.4 Armory & money
- `GET /faction/balance` → faction + per-member balances → dues/loan tracking.
- `GET /faction/news` → armory/announcement feed (who pulled what).
- `GET /faction/upgrades` → unlocked perks. `GET /faction/applications` → recruiting pipeline.

---

## 3. Architecture

```
┌──────────────┐     subscribe (WS)      ┌──────────────────────┐
│   Browser    │◄────────────────────────│  Realtime layer      │
│ Next.js SPA  │                         │  (Supabase Realtime  │
│ (Vercel)     │── REST (API routes) ───►│   or Ably)           │
└──────┬───────┘                         └──────────▲───────────┘
       │ auth, key submit, settings                 │ publish events
       ▼                                            │
┌──────────────────────────────────────────────────┴───────────┐
│  Next.js API routes (Vercel)                                  │
│   • /api/auth  • /api/keys  • /api/ingest (userscript hook)   │
│   • /api/discord/interactions  • read endpoints (cached)      │
└──────┬─────────────────────────────────────▲─────────────────┘
       │ enqueue refresh                      │ write + emit
       ▼                                      │
┌──────────────────┐   poll/refresh   ┌───────┴────────┐   webhook   ┌─────────┐
│  Collector       │─────────────────►│  Postgres      │             │ Discord │
│  (always-on      │   Torn API v2    │  (Supabase/Neon)│────────────►│  bot /  │
│   worker:        │◄─────────────────│  + encrypted    │   alerts    │ webhooks│
│   Railway/Fly)   │   key pool       │   keys          │             └─────────┘
└──────▲───────────┘                  └────────────────┘
       │ on-demand refresh trigger
       │ (member attacked → refresh chain NOW)
┌──────┴───────────┐
│ Torn Userscript  │  (Tampermonkey on torn.com)
│ detects events,  │
│ POSTs to /ingest │
└──────────────────┘
```

**Why a separate collector?** Vercel functions are short-lived and can't hold the long-running, sub-minute polling loop a live chain needs. The collector is one small always-on Node process that owns *all* Torn API traffic, writes snapshots to Postgres, and publishes realtime events. Everything else (UI, auth, webhooks) stays serverless on Vercel.

### 3.1 Tenancy model — Discord server ⊇ many factions

The unit of isolation is the **faction** (`faction_id`), not the Discord server. A Discord **guild** owns *one or more* factions:

```
discord_guild (1) ──< faction (N) ──< members / keys / chains / crimes / wars / ...
```

Why a faction is its own tenant — a hard API constraint, not a preference:

- Torn's private faction endpoints (`/faction/crimes`, `/faction/balance`, `/faction/members` revive settings, chain warmer detail, …) have **no `{id}` variant** — they *always* return the key-owner's faction. There is no way to read faction B's OC board with a faction A key.
- **⇒ each faction must supply its own key pool from its own members.** The collector keeps a separate pool keyed by `faction_id` and polls each faction independently. A "noob faction" with one officer key works the same as the main faction with ten.
- The few public `/faction/{id}/...` endpoints (basic, public chain, hof, ranked-war scores) can be read with *any* key, so cross-faction public lookups (e.g. scouting an opponent) are still possible — but the dashboards run on each faction's own keys.

What this means across the app:

- **Data:** every domain row already carries `faction_id` (§9). Add `discord_guilds` and link factions to a guild. Realtime channels are already faction-scoped (`faction:{id}:*`), so no two factions ever cross streams.
- **UI:** a faction switcher in the top bar. A user sees only the factions they belong to (or, for cross-faction officers, are granted). Default to the user's home faction.
- **Discord:** slash commands and alerts are routed per faction within the same guild (§8).
- **Cost:** still one collector, one DB, one web app. Tenancy is data-level, so adding a second faction is config + a key, not new infra.

---

## 4. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js (App Router) + React + TypeScript | Single codebase, SSR + client islands |
| UI | Tailwind + shadcn/ui + Recharts | Fast, clean dashboards |
| Hosting (web) | Vercel | Zero-config Next.js, free tier fine |
| DB + Auth | **Supabase** (Postgres + Auth + RLS) | One service covers DB, auth, *and* realtime |
| Realtime | **Supabase Realtime** (default) — Ably as alt | See §5 |
| Collector | Node + TypeScript worker on **Railway** or **Fly.io** | Always-on, cheap (~$0–5/mo) |
| Discord | discord.js bot + outbound webhooks | Slash commands + alert pushes |
| Userscript | Tampermonkey/Violentmonkey | Event-driven refresh from torn.com |

---

## 5. Realtime strategy — cheapest + best

The dashboard is overwhelmingly **server → client** (data flows one way to viewers). That makes it cheap. Three viable options:

| Option | Free tier | Fit | Notes |
|---|---|---|---|
| **Supabase Realtime** ✅ | 200 concurrent, ~2M msg/mo | **Best** | Already using Supabase for DB+Auth. Broadcast channels or Postgres-change streams. Zero extra vendor. |
| **Ably** | 200 concurrent, 6M msg/mo | Great | Decoupled, higher throughput, presence built-in. Add if we outgrow Supabase or want vendor isolation. |
| Pusher | 100 concurrent, 200k msg/day | OK | Lower limits; fine for a small faction. |
| SSE (DIY) | free | Cheapest | One-way, but Vercel can't hold long-lived connections — would need the collector to serve SSE. More ops work. |

**Recommendation: Supabase Realtime.** A faction is ~100 members and rarely are all connected at once, so the free tier is comfortable. The collector publishes to channels via Supabase; clients subscribe with the Supabase JS client. If we ever need >200 concurrent or richer presence, **Ably is a drop-in swap** behind a thin `realtime.ts` adapter — so we abstract the publish/subscribe calls from day one to keep that swap cheap.

**Channels (topics):**
- `faction:{id}:chain` — chain ticks, warmer alarm
- `faction:{id}:oc` — slot fills, ready, expiring
- `faction:{id}:members` — status changes, hospital out, revive needed
- `faction:{id}:war` — score updates, war start/end
- `faction:{id}:armory` — news/armory feed, balance changes

---

## 6. Data ingestion — how it stays fresh & under rate limits

Torn limit: **~100 req/min per key**. Strategy combines three sources so we poll *little* but feel *instant*:

1. **Baseline polling (collector).** Adaptive cadence per data type:
   - Chain: every ~10s while chain active, slow to 60s when idle.
   - Members: every 60s.
   - OC: every 2–3 min (slots change slowly).
   - War: every 15–30s during an active war, off otherwise.
   - Armory/balance/news: every 2–5 min.

2. **Event-driven refresh (userscript → `/api/ingest`).** When a member acts on torn.com (lands an attack, joins/leaves an OC, pulls from armory), their browser POSTs a lightweight signal to us. The collector immediately refreshes *just that resource* (e.g. chain) and publishes — so the chain counter updates the instant a hit lands instead of waiting for the next poll. See §7.

3. **Key pool (per faction).** Members submit keys; faction-wide endpoints only need *one* key with faction access, but we keep a **pool of officer keys per faction and rotate** to spread load and add redundancy if one key is revoked. Because private endpoints have no `{id}` variant, a faction's pool **must** contain keys from its own members — faction A's keys can never serve faction B. The collector indexes pools by `faction_id` and rate-limits each pool against Torn's ~100 req/min *per key* independently. Personal endpoints (energy/cooldowns, later) use that member's own key.

Debounce: the collector coalesces multiple ingest signals for the same resource within a short window (e.g. 1s) into a single Torn call → many simultaneous hits during a chain = one refresh, not 50.

---

## 7. Torn userscript (event-driven refresh)

A Tampermonkey script the faction installs. Responsibilities:
- Runs on `*.torn.com/*`.
- Detects faction-relevant events from the page/DOM/XHR (attack result, OC join/leave/execute, armory action).
- POSTs a tiny signed payload to `POST /api/ingest`:
  ```json
  { "type": "attack", "factionId": 12345, "memberId": 678, "ts": 1718380000, "sig": "<hmac>" }
  ```
- The endpoint verifies the member (HMAC with a per-member ingest token issued at key submission — **never** the Torn key) and enqueues a targeted collector refresh.

Security: the userscript carries only an opaque per-member ingest token, not the Torn API key. Rate-limit the ingest endpoint per member.

> Note: scraping torn.com DOM is allowed-ish but fragile; treat the userscript as an *accelerator*, never the source of truth. Baseline polling is the fallback so the dashboard works even for members who don't install it.

---

## 8. Discord integration

Two directions:

**Outbound alerts (webhooks / bot DMs):**
- Chain about to drop (`timeout < threshold`) → ping `@warriors`.
- OC slot ready / crime ready to execute / crime expiring.
- War started / war score lead lost / war ending soon.
- Member needs revive (`is_revivable` + flagged).
- Configurable per-event channel + role mention in the dashboard settings — **scoped per faction** (`discord_config` is keyed by `faction_id`). The main faction can alert `#main-war` / `@warriors` while the feeder faction alerts `#noob-chain` / `@feeder` in the *same* guild.

**Inbound (slash commands via interactions endpoint — serverless on Vercel):**
- `/chain` — current chain status.
- `/oc` — open OC slots + best-fit members.
- `/war` — live war score.
- `/inactive [days]` — inactivity report.

**Disambiguating faction in a multi-faction guild.** Each command resolves its target faction in this order: (1) explicit `faction:` option on the command; (2) the channel's binding — officers can pin a channel to a faction (`/setup faction:<name>` writes a `channel_id → faction_id` map); (3) the caller's home faction. If a guild has multiple factions and none of these resolve, the command replies with a quick faction picker. Single-faction guilds skip all of this and just work.

Discord OAuth can also double as the dashboard login (map Discord user ↔ Torn member ↔ faction) so role-gating is unified. A member's faction is derived from their verified Torn membership; cross-faction officers can be granted access to more than one.

---

## 9. Data model (sketch)

```
discord_guilds  (guild_id, name, installed_by, created_at)
factions        (id, guild_id, name, tag, is_primary, settings_json, created_at)
                 -- guild_id groups the factions one Discord server runs (main, feeder, ...)
faction_links   (discord_user_id, member_id, faction_id, role, is_officer)
                 -- Discord user ↔ Torn member ↔ faction; a user may hold rows in >1 faction
channel_bindings(guild_id, channel_id, faction_id)
                 -- pins a Discord channel to a faction for slash-command resolution
members         (torn_id, faction_id, name, position, level, days_in_faction,
                 status_state, status_until, last_action_ts, is_on_wall,
                 is_revivable, is_in_oc, revive_setting, updated_at)
api_keys        (member_id, faction_id, encrypted_key, access_level, ingest_token_hash,
                 is_officer_key, revoked, created_at)
                 -- faction_id denormalized so the collector loads a faction's pool directly
chain_snapshots (faction_id, chain_id, current, max, timeout, modifier,
                 cooldown, captured_at)
oc_crimes       (id, faction_id, name, difficulty, status, ready_at, expired_at, ...)
oc_slots        (crime_id, position, user_id, cpr, status)
wars            (id, faction_id, opponent_id, score, lead, status, start, end)
attacks         (id, faction_id, attacker_id, defender_id, respect, ts, is_retal)
balances        (faction_id, member_id, money, points, updated_at)
news            (faction_id, type, text, ts)
discord_config  (faction_id, event_type, channel_id, role_mention)
audit/events    (faction_id, type, payload_json, ts)   -- drives realtime + history
```

Supabase **Row Level Security**: every domain table is gated by `faction_id`, and a user's accessible factions come from `faction_links` — so two factions sharing a guild can never read each other's rows. Officer-only tables (keys, settings, balances) are additionally gated by position/role *within* the faction.

---

## 10. Security & privacy (API keys)

- **Encrypt keys at rest** (AES-256-GCM; encryption key in env / a KMS, never in DB).
- Request the **minimum key access level** that covers faction + (later) personal selections; document which selections we read.
- Never expose keys to the client or in logs. Only the collector decrypts, in memory.
- Members can **revoke** their key from the dashboard; mark revoked, drop from pool.
- Userscript uses a separate **ingest token**, not the Torn key.
- Display a clear privacy note: what we read, how often, and that keys are encrypted + revocable.

---

## 11. API surface (Next.js routes)

| Route | Purpose |
|---|---|
| `POST /api/auth/*` | Discord/Supabase auth |
| `POST /api/keys` | Submit/rotate/revoke Torn key (validates via `GET /key/info`) |
| `GET  /api/faction/overview` | Cached aggregate for first paint |
| `GET  /api/oc` `GET /api/chain` `GET /api/members` `GET /api/war` `GET /api/armory` | Cached reads from Postgres (not Torn) |
| `POST /api/ingest` | Userscript event hook (HMAC-verified) |
| `POST /api/discord/interactions` | Slash command handler |
| `POST /api/settings` | Alarm thresholds, Discord channel mapping (officer-only) |

All read routes take a **`factionId`** (query param or derived from the active faction in session); the server checks it against the caller's `faction_links` before returning anything. Clients **read from Postgres via these routes** (fast, cached) and **subscribe to the matching `faction:{id}:*` realtime channel** for updates — they never touch Torn directly.

---

## 12. Deployment & cost

| Piece | Where | Cost |
|---|---|---|
| Next.js web | Vercel | Free (Hobby) → $20 Pro if needed |
| Postgres + Auth + Realtime | Supabase | Free tier covers a faction |
| Collector worker | Railway / Fly.io | $0–5/mo |
| Discord bot | same worker or separate Fly app | $0 |

Realistic monthly: **$0–10** — and largely flat as factions are added to a guild, since tenancy is data-level (one collector, one DB, one web app). Extra cost is only more Torn calls (each faction polled with its own keys, comfortably within per-key limits) and marginally more realtime traffic.

---

## 13. Roadmap (phased)

**Phase 0 — Foundations (week 1)**
- Next.js + Supabase + auth (Discord OAuth).
- Key submission flow + `key/info` validation + encryption.
- DB schema + RLS — **multi-tenant from day one** (`discord_guilds`, `factions.guild_id`, `faction_links`, faction-scoped pools).
- Faction switcher + active-faction context plumbed through reads/realtime.
- `realtime.ts` adapter (Supabase impl, Ably-swappable).

**Phase 1 — Collector + Members + Chain (week 2)**
- Always-on collector with adaptive polling + key pool.
- Member status grid (live) + chain timer with warmer alarm.
- First realtime channels wired end-to-end.

**Phase 2 — OC 2.0 board (week 3)**
- Crimes/slots ingest, CPR assignment helper, ready/expiring alerts, idle finder.

**Phase 3 — War center + Armory/Money (week 4)**
- Ranked war board + attack leaderboard.
- Balance/news/armory feed.

**Phase 4 — Discord + Userscript (week 5)**
- Outbound alerts + slash commands.
- Userscript event ingestion + debounce/coalescing.

**Phase 5 — Polish**
- Inactivity report, revive board, settings UI, history/charts, mobile layout.

---

## 14. Open questions / risks

- **Key access level**: confirm exactly which v2 selections each module needs and the minimum access level to request (audit against `openapi.json` per endpoint).
- **Userscript fragility**: torn.com DOM changes can break event detection — keep polling as the safety net.
- **Sub-minute polling cost**: ensure adaptive cadence + coalescing keeps us well under 100 req/min even with one officer key during a chain — *per faction*, since each faction's pool is rate-limited independently.
- **Multi-faction (decided):** one Discord guild hosts many factions, each a `faction_id` tenant with its own key pool, data, channels, and RLS (§3.1). Forced by Torn's API — private endpoints have no `{id}` variant, so a faction can only be read with its own members' keys. Open sub-questions: (a) UX when a user belongs to several factions (switcher default + per-channel binding — see §8); (b) onboarding flow to register a second faction under an existing guild; (c) whether a feeder faction with a *single* key needs a gentler polling cadence to stay safe.
- **Realtime scale**: if concurrent viewers exceed Supabase's free 200, flip the adapter to Ably.

---

*Next step: confirm §14 key-access details against the spec, then start Phase 0 — building multi-tenant (guild ⊇ factions) from the first migration.*
