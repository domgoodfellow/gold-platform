# Environment setup

The authoritative environment-variable manifest for both deployables, built from what the code
actually reads (verified by grep across `apps/web` and `apps/api`, not from any prior template).
Read this beside the Vercel dashboard when configuring `next-fund-web/web` and
`next-fund-web/api` — the two Vercel projects this repository currently deploys as, referred to
below by their conventional names `gold-web` and `gold-api`.

Two things found during this audit are corrected elsewhere and just noted here:

- **`gold-web`/`gold-api` are names, not the Vercel project slugs.** The actual linked projects
  are `next-fund-web/web` and `next-fund-web/api` (team `next-fund-web`) — a name left over from
  before the rebrand to GOLD. Nothing is broken by this; it just means searching the Vercel
  dashboard for "gold" will not find them.
- **`apps/web/.env.preview.example`, `apps/web/.env.production.example`, and the two `apps/api`
  equivalents have been deleted.** They described variable names (`NEXT_PUBLIC_SUPABASE_
  PUBLISHABLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`) and a database-access design
  (`PAYMENT_WEBHOOK_DATABASE_URL`, `AUTOMATION_RUNNER_DATABASE_URL`) that no code in this
  repository reads — a stale, aspirational template that would have reproduced the exact
  "Missing environment variable" error this session started from, in production. There is now
  one tracked contract per app: `apps/web/.env.example`, `apps/api/.env.example`.


## 1. Architecture

```
                    ┌─────────────────────┐
   browser  ───────▶│   gold-web (Next)   │
                     │   apps/web          │
                     └──────────┬───────────┘
                                │ forwards the caller's own
                                │ access token — never a
                                │ service-role key (D14)
                                ▼
                     ┌──────────────────────┐        ┌────────────────────┐
                     │  Supabase project     │◀───────│  gold-api (Python)  │
                     │  (Postgres + RLS +    │        │  apps/api           │
                     │  Auth + Vault)        │        └─────────┬──────────┘
                     └──────────┬─────────────┘                  │
                                │                                  │ mints a 60s token per
                                │ organization_provider_bindings   │ scoped role (payment_
                                │ / _resources: identifiers only   │ webhook, automation_
                                │                                  │ runner, voice_webhook)
                                ▼                                  ▼
                     tenant-owned provider          Stripe / Twilio / Resend webhooks
                     resource IDs (Twilio               (GOLD's own bootstrap
                     subaccount SID, Stripe                  credentials)
                     acct_ id, phone number)
                                │
                                ▼
                     Supabase Vault (write-only:
                     a generated Twilio API-key
                     secret is the one row today;
                     never read back through the
                     database's own API)
```

The boundary that matters for this document: **`gold-web` and `gold-api`'s own Vercel
environment variables are GOLD's deployment bootstrap credentials only.** A tenant's own
provider resource (a Stripe `acct_` id, a Twilio subaccount SID, a chosen phone number) lives in
a database row (`payment_accounts`, `organization_provider_bindings`,
`organization_provider_resources`, `telephony_settings`), never in Vercel. The one case where a
tenant-scoped secret is generated at all (a Twilio API key minted when provisioning a
subaccount) is written to Supabase Vault and never read back through PostgREST — no environment
variable is involved on either side of that boundary.


## 2. Environment-variable manifest

Every variable in the tables below was confirmed by reading the file(s) that read it — see the
`Used by` column. Nothing is listed that the current code does not consume, and nothing the
current code consumes is missing.

### apps/web

| Variable | Used by | Purpose | Classification |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/db/server.ts:18`, `lib/db/session.ts:23` | Supabase project URL for every request-scoped client | PUBLIC APPLICATION CONFIG |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `lib/db/server.ts:19`, `lib/db/session.ts:24` | Anon/RLS-constrained key for the same clients | PUBLIC APPLICATION CONFIG |
| `ASSISTANT_API_URL` | `lib/adapters/answering/registry.ts:10` | Base URL of `apps/api`, for the Ask feature | SERVER-SIDE NON-SECRET CONFIG |
| `ANTHROPIC_API_KEY` | `lib/adapters/drafting/registry.ts:10` | GOLD's key for AI-drafted business setup | PROVIDER CREDENTIAL |
| `GEOCODING_CONTACT` | `lib/adapters/geocoding/registry.ts:10` | Contact identity Nominatim's usage policy asks for | SERVER-SIDE NON-SECRET CONFIG |
| `STRIPE_SECRET_KEY` | `lib/adapters/payments/registry.ts:12` | GOLD's Stripe Connect platform secret | PROVIDER CREDENTIAL |
| `STRIPE_CONNECT_CLIENT_ID` | `lib/adapters/payments/registry.ts:13` | GOLD's Connect application id | PROVIDER RESOURCE IDENTIFIER |
| `TWILIO_ACCOUNT_SID` | `lib/adapters/telephony/registry.ts:38,61` | GOLD's master Twilio account | PROVIDER RESOURCE IDENTIFIER |
| `TWILIO_AUTH_TOKEN` | `lib/adapters/telephony/registry.ts:39,62` | GOLD's master account credential | PROVIDER CREDENTIAL |
| `TWILIO_API_KEY_SID` | `lib/adapters/telephony/registry.ts:40` | Signs browser voice tokens | PROVIDER RESOURCE IDENTIFIER |
| `TWILIO_API_KEY_SECRET` | `lib/adapters/telephony/registry.ts:41` | Secret half of the API key | PROVIDER CREDENTIAL |
| `TWILIO_TWIML_APP_SID` | `lib/adapters/telephony/registry.ts:42` | TwiML App the browser token is scoped to | PROVIDER RESOURCE IDENTIFIER |
| `TELEPHONY_CALLBACK_URL` | `lib/adapters/telephony/registry.ts:83` | Where Twilio reports call status | SERVER-SIDE NON-SECRET CONFIG |
| `NODE_ENV` | `app/organizations/[organizationId]/settings/payments/connect/route.ts:41` | Gates the `secure` cookie flag on the Connect state cookie | VERCEL/SYSTEM-PROVIDED VALUE (set by Next itself, never configured by hand) |

Classification key used throughout this document: **PUBLIC APPLICATION CONFIG**,
**SERVER-SIDE NON-SECRET CONFIG**, **SERVER-SIDE SECRET**, **PROVIDER RESOURCE IDENTIFIER**,
**PROVIDER CREDENTIAL**, **GENERATED INTERNAL SECRET**, **VERCEL/SYSTEM-PROVIDED VALUE**,
**TENANT-STORED CONFIG**, **TENANT-STORED SECRET** (the last two never appear as Vercel
variables at all — see §1).

**USED + DOCUMENTED**: every row above, now in `apps/web/.env.example`.
**DOCUMENTED + NO LONGER USED**: none — the file was rewritten from the code, not edited in
place, so nothing stale carried over.
**DUPLICATED BETWEEN WEB/API INTENTIONALLY**: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (see the
apps/api table — same GOLD account, two independent uses, so both projects need the same value).
**FUTURE — DO NOT ADD YET**: a per-tenant sending domain for email/SMS (`.env.example`'s own
comment names this as a real, different feature); any geographic-dispatch configuration beyond
`GEOCODING_CONTACT` (nothing in the current code reads more than that).

### apps/api

| Variable | Used by | Purpose | Classification |
|---|---|---|---|
| `SUPABASE_URL` | `app/core/config.py:30,87,99,140` | Same project as `apps/web`'s copy | PUBLIC APPLICATION CONFIG |
| `SUPABASE_ANON_KEY` | `app/core/config.py:31,88,100,141` | Same as above | PUBLIC APPLICATION CONFIG |
| `SUPABASE_JWT_SECRET` | `app/core/config.py:35,103,142` | Signs tokens for `payment_webhook`/`automation_runner`/`voice_webhook` | SERVER-SIDE SECRET |
| `STRIPE_WEBHOOK_SECRET` | `app/core/config.py:36` | Verifies Stripe's webhook signature | PROVIDER CREDENTIAL |
| `CRON_SECRET` | `app/core/config.py:104` | Authenticates Vercel's scheduled invocation | GENERATED INTERNAL SECRET |
| `RESEND_API_KEY` | `app/channels/registry.py:22` | GOLD's email-sending credential | PROVIDER CREDENTIAL |
| `MESSAGE_FROM_ADDRESS` | `app/channels/registry.py:23` | Sender address for the email channel | SERVER-SIDE NON-SECRET CONFIG |
| `TWILIO_ACCOUNT_SID` | `app/channels/registry.py:31` | Same GOLD account as apps/web, for SMS sending | PROVIDER RESOURCE IDENTIFIER |
| `TWILIO_AUTH_TOKEN` | `app/channels/registry.py:32`, `app/core/config.py:143` | SMS sending auth **and** inbound-webhook signature verification (two independent uses of one value) | PROVIDER CREDENTIAL |
| `MESSAGE_FROM_NUMBER` | `app/channels/registry.py:33` | Sender number for the SMS channel | PROVIDER RESOURCE IDENTIFIER |
| `ASSISTANT_BASE_URL` | `app/ai/registry.py:31` | Self-hosted/OpenAI-dialect model endpoint | SERVER-SIDE NON-SECRET CONFIG |
| `ASSISTANT_MODEL` | `app/ai/registry.py:32` | Exact model tag at that endpoint | SERVER-SIDE NON-SECRET CONFIG |
| `ASSISTANT_API_KEY` | `app/ai/registry.py:46` | Bearer key for a hosted dialect endpoint | PROVIDER CREDENTIAL (when populated) |
| `ANTHROPIC_API_KEY` | `app/ai/registry.py:50` | Default hosted answering provider | PROVIDER CREDENTIAL |
| `CONDITIONS_ENABLED` | `app/conditions/registry.py:22` | Explicit switch for the free weather integration | SERVER-SIDE NON-SECRET CONFIG |
| `PORT` | `dev.py:112` | Local dev server port only | LOCAL ONLY |

**USED + DOCUMENTED**: every row above.
**DUPLICATED BETWEEN WEB/API INTENTIONALLY**: `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`, as noted.
No unnecessary duplication was found in either direction — `RESEND_API_KEY`,
`MESSAGE_FROM_ADDRESS`, `MESSAGE_FROM_NUMBER`, `CRON_SECRET`, `SUPABASE_JWT_SECRET`,
`STRIPE_WEBHOOK_SECRET`, and the AI dialect trio exist only in `apps/api`; `ASSISTANT_API_URL`,
`ANTHROPIC_API_KEY` (a **different** key than apps/api's), `GEOCODING_CONTACT`, the Stripe pair,
and the full Twilio browser-calling set exist only in `apps/web`.


## 3. A found inconsistency: AI provider abstraction is asymmetric between the two runtimes

`apps/api`'s answering feature (`app/ai/registry.py`) is provider-neutral: it tries
`ASSISTANT_BASE_URL`/`ASSISTANT_MODEL` (any OpenAI-compatible endpoint — self-hosted Ollama/vLLM,
or a hosted provider speaking that dialect, including Gemini's own OpenAI-compatible endpoint)
before falling back to `ANTHROPIC_API_KEY`. `apps/web`'s drafting feature
(`lib/adapters/drafting/registry.ts` → `anthropic.ts`) has no such fallback — it is hardcoded to
Anthropic's own SDK, by the adapter file's own header comment ("one of two files in this
repository that knows this vendor exists").

**This is not a bug** — the drafting adapter follows the same registry/implementation split
every other adapter in this repository uses, it simply has exactly one implementation registered
instead of two. But it means a business that wants a self-hosted or non-Anthropic model for
*answering* can have one, while the same choice is unavailable for *drafting*.

**Decision: defer, don't migrate now.** Fixing this properly has two honest options —

1. Give `drafting` the same OpenAI-dialect fallback `answering` has, by writing a second
   `DraftingProvider` implementation that speaks the same structured-output shape through an
   OpenAI-compatible endpoint (drafting needs a JSON-schema response, `answering` does not, so
   this is new code, not a copy).
2. Move drafting into `apps/api` entirely, calling it the same way `apps/web`'s Ask feature
   calls `apps/api` today — architecturally cleaner, since D34's reasoning for keeping answering
   in `apps/api` (forwarding the caller's own token so every read stays inside their RLS) does
   not even apply to drafting (it runs pre-tenant, during onboarding, with no RLS-scoped reads at
   all) — but it is a bigger change: a new `apps/api` endpoint, moving the existing structured-
   output logic across languages, and a new call site in `apps/web`.

Either is a real, isolated piece of work with its own test coverage to write — not something to
fold into an environment-variable audit. Recorded here rather than silently fixed so it does not
get lost; flag it back to raise it as its own task.


## 4. WEB — Vercel Environment Variables (`next-fund-web/web`)

| Variable | Development | Preview | Production | Vercel Sensitive |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | local stack URL | Gold Platform project URL | Gold Platform project URL | NO |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | local stack anon key | Gold Platform anon key | Gold Platform anon key | NO |
| `ASSISTANT_API_URL` | `http://127.0.0.1:8787` | NOT SET (see §7) | `https://api-next-fund-web.vercel.app` | NO |
| `TELEPHONY_CALLBACK_URL` | `http://127.0.0.1:8787` | NOT SET | `https://api-next-fund-web.vercel.app` | NO |
| `ANTHROPIC_API_KEY` | dev key (own choice) | dev/test key | production key | YES |
| `GEOCODING_CONTACT` | ops email | ops email | ops email | NO |
| `STRIPE_SECRET_KEY` | Stripe Test | Stripe Test | Stripe Live | YES |
| `STRIPE_CONNECT_CLIENT_ID` | Test Connect app id | Test Connect app id | Live Connect app id | NO |
| `TWILIO_ACCOUNT_SID` | GOLD master SID | GOLD master SID | GOLD master SID | NO |
| `TWILIO_AUTH_TOKEN` | GOLD master token | NOT SET until Preview has its own Supabase project (§7) | GOLD master token | YES |
| `TWILIO_API_KEY_SID` | dev API key | NOT SET | production API key | NO |
| `TWILIO_API_KEY_SECRET` | dev API key secret | NOT SET | production API key secret | YES |
| `TWILIO_TWIML_APP_SID` | dev TwiML App | NOT SET | production TwiML App | NO |

Development here means **Vercel's own "Development" environment** (what `vercel env pull`
fetches into `.env.local`), which is distinct from your actual local file — see §1's three-way
distinction, restated:

- **Local development file**: `apps/web/.env.local`, read by `next dev` on your machine directly.
  Never uploaded to Vercel.
- **Vercel "Development" environment**: values `vercel env pull` writes into `.env.local` for
  you — most teams never populate this and just use the local file above instead. Included in
  the table for completeness since the CLI offers it, not because this repository currently uses
  it.
- **Vercel "Preview"**: every non-production deployment (PRs, branches).
- **Vercel "Production"**: the deployment your production domain points at.


## 5. API — Vercel Environment Variables (`next-fund-web/api`)

| Variable | Development | Preview | Production | Vercel Sensitive |
|---|---|---|---|---|
| `SUPABASE_URL` | local stack URL | Gold Platform project URL | Gold Platform project URL | NO |
| `SUPABASE_ANON_KEY` | local stack anon key | Gold Platform anon key | Gold Platform anon key | NO |
| `SUPABASE_JWT_SECRET` | local stack JWT secret | Gold Platform legacy JWT secret | Gold Platform legacy JWT secret | YES |
| `STRIPE_WEBHOOK_SECRET` | `stripe listen` value | Preview endpoint's own secret | Production endpoint's own secret | YES |
| `CRON_SECRET` | NOT SET (no scheduler locally) | NOT SET (Vercel Cron targets Production only) | generate securely | YES |
| `RESEND_API_KEY` | dev/sandbox key | NOT SET (§7) | production key | YES |
| `MESSAGE_FROM_ADDRESS` | `dev@yourdomain` | NOT SET | `notifications@yourdomain` | NO |
| `TWILIO_ACCOUNT_SID` | GOLD master SID | GOLD master SID | GOLD master SID | NO |
| `TWILIO_AUTH_TOKEN` | GOLD master token | NOT SET (§7) | GOLD master token | YES |
| `MESSAGE_FROM_NUMBER` | dev number | NOT SET | production number | NO |
| `ASSISTANT_BASE_URL` | your own choice | NOT SET | your own choice, if used | NO |
| `ASSISTANT_MODEL` | paired with the above | NOT SET | paired with the above | NO |
| `ASSISTANT_API_KEY` | paired with the above, if hosted | NOT SET | paired with the above, if hosted | YES |
| `ANTHROPIC_API_KEY` | dev key | dev/test key | production key | YES |
| `CONDITIONS_ENABLED` | your own choice | your own choice | your own choice | NO |

`PORT` is intentionally absent from this table — it is read only by `dev.py`, which is not
deployed (`.vercelignore` excludes it), so it has no place in any Vercel environment.


## 6. Provider value acquisition checklist

| Value | Where to get it |
|---|---|
| Supabase URL / anon key / JWT secret | Supabase Dashboard > Project Settings > API |
| Stripe secret key / Connect client id | Stripe Dashboard > Developers > API keys / Connect > Settings |
| Stripe webhook signing secret | Stripe Dashboard > Developers > Webhooks (per endpoint), or `stripe listen` locally |
| Twilio account SID / auth token | Twilio Console > Account |
| Twilio API key SID/secret, TwiML App SID | Twilio Console > Voice / Account > API keys |
| Resend API key | Resend Dashboard > API Keys |
| Anthropic API key | console.anthropic.com > API Keys |
| An OpenAI-compatible endpoint's key (OpenAI, Gemini, a self-hosted server) | The chosen provider's own console, or none for local Ollama/vLLM |
| Google OAuth client id/secret | Google Cloud Console > APIs & Services > Credentials (§8 walks through this) |
| `CRON_SECRET` | Generated, not retrieved — see §9 |

Values you do **not** need to retrieve because they are generated, computed, or system-provided:
`NODE_ENV` (Next sets it), `CRON_SECRET` (you generate it), `ASSISTANT_API_URL`/
`TELEPHONY_CALLBACK_URL` (read off the target deployment's own Vercel URL), any tenant-scoped
provider identifier (never touches Vercel at all — see §1).


## 7. Preview deployments and the shared-Supabase-project caution

**Current state**: this session pointed both Preview and Production, for both Vercel projects,
at the same hosted Supabase project ("Gold Platform"). Nothing in the code *requires* one
project per environment — RLS is the boundary regardless of which project a deployment reads —
but sharing one project between Preview and Production has one real consequence worth acting on:

**A Preview deployment that also has send-capable credentials (Twilio, Resend) can act on real
customer data.** Vercel Cron only triggers against Production, so the automation tick will not
fire from Preview on its own — but a person testing a Preview deployment by hand (hitting the
Ask feature, placing a test call, triggering an automation manually) would be doing so against
the same rows a real business's real customers are in. The tables above therefore leave
`TWILIO_AUTH_TOKEN`, `RESEND_API_KEY`, and the values paired with them **NOT SET in Preview** —
Preview keeps the ability to sign in and browse real data (useful for verifying a UI change
against realistic data) but cannot dial or email anyone while pointed at the production
database. Two ways to lift that restriction if Preview needs to exercise those features:

- Give Preview its own Supabase project (a real staging project, `db:reset` and demo-seeded
  independently) — the option that actually eliminates the risk rather than accepting it, and
  what "BENEFIT from a separate staging project" in the earlier prompt was asking about. This is
  the recommended direction once Preview needs to exercise send-capable features at all.
  Supabase's own branching feature (per-branch ephemeral database copies) is the natural fit if
  adopted later; nothing here requires it today.
- Or accept the risk deliberately for a specific test and set the credentials temporarily,
  removing them afterward.

**Google OAuth does not need a stable Preview hostname.** Google's own OAuth client only ever
talks to Supabase's fixed callback URL (`https://<project-ref>.supabase.co/auth/v1/callback`),
never to a GOLD URL directly — the ephemeral Vercel Preview URL only has to be in *Supabase's*
redirect allow-list, which supports wildcards (e.g. `https://*-next-fund-web.vercel.app/auth/
callback`). So Preview sign-in with Google works today with no additional infrastructure; see
the checklist in §8.

**Twilio callbacks and Stripe webhooks are the opposite** — a TwiML App's Voice URL and a Stripe
webhook endpoint are each one fixed URL, no wildcard support. `apps/api`'s Preview alias is
stable *per git branch* (`api-git-<branch>-next-fund-web.vercel.app`) but changes if the branch
is renamed or the PR closes, and Preview telephony/webhooks are left unconfigured above regardless
per the caution two paragraphs up. If Preview ever needs live Twilio/Stripe callback testing, a
stable hostname (`api-preview.yourdomain.com`, aliased to whichever deployment is "current
preview") is the right fix — a DNS/Vercel-domain change, not an environment-variable one, so it
is not implemented here.


## 8. Google Sign-In

**Implemented this session** — the smallest addition that matched the codebase's existing
conventions exactly, on top of the existing Supabase Auth / email-password system (no second
auth system introduced):

- `lib/domain/identity/credentials.ts`: `signInWithGoogle()`, alongside the existing
  `signInWithPassword`/`registerWithPassword`.
- `app/(auth)/oauth-actions.ts`: `signInWithGoogleAction()`, a server action shared by both
  screens (Supabase treats Google sign-in as create-or-log-in, so one action covers both).
- `app/auth/callback/route.ts`: new route handler, same relative-redirect technique as the
  existing `app/auth/recover/route.ts`, added to `proxy.ts`'s `PUBLIC_PATHS`.
- A "Continue with Google" button on both `login/page.tsx` and `sign-up/page.tsx`.
- `supabase/config.toml`: a new `[auth.external.google]` block, disabled until credentials exist,
  mirroring the existing (also-disabled) `[auth.external.apple]` template.

**No browser Supabase client was added.** This codebase has none today — every existing auth
flow is a server action — so `signInWithGoogle` runs server-side and returns the URL to redirect
to (`skipBrowserRedirect: true`) rather than introducing a new client-construction pattern for
one feature.

**Nothing above touches Vercel.** Google's client id and secret live only in Supabase's own
provider configuration:

```
Google OAuth Client ID       Secret: NO   Sensitive: NO   Stored in: Supabase Auth Provider Configuration
Google OAuth Client Secret   Secret: YES  Sensitive: YES  Stored in: Supabase Auth Provider Configuration
                                                            NOT stored in: Vercel (neither project)
```

### Setup order

1. **Google Cloud Console** (console.cloud.google.com > APIs & Services > Credentials):
   - Create an OAuth 2.0 Client ID, type "Web application".
   - Authorized JavaScript origins: `<GOLD_WEB_PRODUCTION_URL>` (add `<GOLD_WEB_PREVIEW_URL>` too
     if you want a fixed preview origin registered; not required for the flow to work, since
     Google never redirects the browser back to it directly).
   - Authorized redirect URIs: **exactly one entry**, `https://<SUPABASE_PROJECT_REF>.supabase.co
     /auth/v1/callback`. This is Supabase's fixed callback, the same for every GOLD environment
     that uses this Supabase project — it does not change per Vercel deployment.
   - Copy the generated Client ID and Client Secret.

2. **Supabase Dashboard** (hosted project — Authentication > Providers > Google):
   - Enable the provider, paste the Client ID and Client Secret from step 1.
   - Authentication > URL Configuration > Site URL: `<GOLD_WEB_PRODUCTION_URL>`.
   - Authentication > URL Configuration > Redirect URLs: add
     `<GOLD_WEB_PRODUCTION_URL>/auth/callback` and, for Preview,
     `https://*-next-fund-web.vercel.app/auth/callback` (adjust the wildcard to match your actual
     Vercel alias pattern — confirm it with `vercel alias ls` before relying on it).

3. **Local development**:
   - Create `supabase/.env` (already covered by the root `.gitignore`'s `.env*` pattern — do not
     add a separate ignore rule) containing:
     ```
     SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=<same client id, or a second local-only OAuth client>
     SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET=<its secret>
     ```
   - In `supabase/config.toml`, flip `[auth.external.google]`'s `enabled` to `true`.
   - `npx supabase stop`, then `npx supabase start` — a `config.toml` change needs a restart, not
     `db:reset` (this repository's own rule, see the root `CLAUDE.md`).
   - Add `http://127.0.0.1:54321/auth/v1/callback` as a second Authorized redirect URI on the
     Google OAuth client from step 1 (or create a second client for local use only).

4. **Vercel**: nothing to do for either project — confirmed by design in the section above.

### Callback/redirect matrix

| System | Development | Preview | Production |
|---|---|---|---|
| Supabase app redirect (`/auth/callback`) | `http://127.0.0.1:3000/auth/callback` | `<preview-url>/auth/callback`, allow-listed by wildcard | `<GOLD_WEB_PRODUCTION_URL>/auth/callback` |
| Google OAuth callback (fixed, at Supabase) | `http://127.0.0.1:54321/auth/v1/callback` | same as Production | `https://<SUPABASE_PROJECT_REF>.supabase.co/auth/v1/callback` |
| Stripe webhook | `stripe listen` forwarding to `http://127.0.0.1:8787/webhooks/stripe` | NOT SET (§7) | `https://api-next-fund-web.vercel.app/webhooks/stripe` |
| Twilio voice callback | `http://127.0.0.1:8787/voice/...` | NOT SET (§7) | `https://api-next-fund-web.vercel.app/voice/...` |
| GOLD Web → API (`ASSISTANT_API_URL`/`TELEPHONY_CALLBACK_URL`) | `http://127.0.0.1:8787` | NOT SET (§7) | `https://api-next-fund-web.vercel.app` |

### Google API integrations — separate concern, future

"Sign in with Google" asks for identity only (`email`, `profile` — Supabase's default scopes).
Broader access (Drive, Calendar, Gmail, Sheets) is a **different** feature — a tenant
integration, not a login mechanism — and is not requested by anything built this session.
Classified **FUTURE**: if GOLD later wants a business to connect its own Google Workspace data,
that almost certainly belongs in the same provider-binding architecture Twilio/Stripe already
use, not bundled into login scopes.


## 9. Missing / not-yet-configured features

| Feature | Classification |
|---|---|
| Supabase URL + anon key (both projects, both environments) | Already done this session |
| Google Sign-In code path | Already done this session (needs the external checklist in §8 to actually authenticate anyone) |
| `SUPABASE_JWT_SECRET` (both environments) | REQUIRED NOW — the Stripe webhook and automation tick both 404 without it |
| `STRIPE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_CONNECT_CLIENT_ID` | RECOMMENDED NOW if payments are wanted before the next milestone; otherwise OPTIONAL |
| `CRON_SECRET` (Production) | RECOMMENDED NOW — automations silently never fire without it |
| Twilio (both apps) | OPTIONAL NOW — calling/SMS is a complete absence per D31 |
| Resend | OPTIONAL NOW, same reasoning |
| `ANTHROPIC_API_KEY` / AI dialect trio | OPTIONAL NOW |
| A separate Preview Supabase project | RECOMMENDED once Preview needs to exercise send-capable features (§7) |
| A stable `api-preview` hostname | FUTURE — only matters once Preview needs live Twilio/Stripe callback testing (§7) |
| Drafting's provider-neutral fallback / AI runtime consolidation | FUTURE — its own task (§3) |
| Broader Google API integrations (Drive/Calendar/Gmail) | FUTURE — not requested, not built |


## 10. Copy/paste blocks

Known non-secret values are filled in; unknowns are explicit placeholders, never invented data.
`NOT SET` rows are omitted entirely, as instructed — see the tables in §4/§5 for which is which.

```dotenv
# =============================================================================
# WEB — DEVELOPMENT (your local apps/web/.env.local, or Vercel's Development env)
# =============================================================================

# Vercel Sensitive: NO
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321

# Vercel Sensitive: NO
NEXT_PUBLIC_SUPABASE_ANON_KEY=<GET_FROM_pnpm_db:start>

# Vercel Sensitive: NO
ASSISTANT_API_URL=http://127.0.0.1:8787

# Vercel Sensitive: NO
TELEPHONY_CALLBACK_URL=http://127.0.0.1:8787

# Vercel Sensitive: YES
ANTHROPIC_API_KEY=<GET_FROM_ANTHROPIC_CONSOLE>

# Vercel Sensitive: NO
GEOCODING_CONTACT=<YOUR_DEV_CONTACT_EMAIL>

# Vercel Sensitive: YES
STRIPE_SECRET_KEY=<GET_FROM_STRIPE_TEST_MODE>

# Vercel Sensitive: NO
STRIPE_CONNECT_CLIENT_ID=<GET_FROM_STRIPE_CONNECT_TEST>

# Vercel Sensitive: NO
TWILIO_ACCOUNT_SID=<GET_FROM_TWILIO_CONSOLE>

# Vercel Sensitive: YES
TWILIO_AUTH_TOKEN=<GET_FROM_TWILIO_CONSOLE>

# Vercel Sensitive: NO
TWILIO_API_KEY_SID=<GET_FROM_TWILIO_CONSOLE>

# Vercel Sensitive: YES
TWILIO_API_KEY_SECRET=<GET_FROM_TWILIO_CONSOLE>

# Vercel Sensitive: NO
TWILIO_TWIML_APP_SID=<GET_FROM_TWILIO_CONSOLE>


# =============================================================================
# WEB — PREVIEW (Vercel: next-fund-web/web, Preview)
# =============================================================================

# Vercel Sensitive: NO
NEXT_PUBLIC_SUPABASE_URL=https://nuceqypuwrjavrwiloda.supabase.co

# Vercel Sensitive: NO
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ALREADY_SET_THIS_SESSION>

# Vercel Sensitive: YES
ANTHROPIC_API_KEY=<GET_FROM_ANTHROPIC_CONSOLE_DEV_KEY>

# Vercel Sensitive: NO
GEOCODING_CONTACT=<YOUR_OPS_EMAIL>

# Vercel Sensitive: YES
STRIPE_SECRET_KEY=<GET_FROM_STRIPE_TEST_MODE>

# Vercel Sensitive: NO
STRIPE_CONNECT_CLIENT_ID=<GET_FROM_STRIPE_CONNECT_TEST>

# ASSISTANT_API_URL, TELEPHONY_CALLBACK_URL, all Twilio, all Resend: NOT SET — see §7.


# =============================================================================
# WEB — PRODUCTION (Vercel: next-fund-web/web, Production)
# =============================================================================

# Vercel Sensitive: NO
NEXT_PUBLIC_SUPABASE_URL=https://nuceqypuwrjavrwiloda.supabase.co

# Vercel Sensitive: NO
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ALREADY_SET_THIS_SESSION>

# Vercel Sensitive: NO
ASSISTANT_API_URL=https://api-next-fund-web.vercel.app

# Vercel Sensitive: NO
TELEPHONY_CALLBACK_URL=https://api-next-fund-web.vercel.app

# Vercel Sensitive: YES
ANTHROPIC_API_KEY=<GET_FROM_ANTHROPIC_CONSOLE_PRODUCTION_KEY>

# Vercel Sensitive: NO
GEOCODING_CONTACT=<YOUR_OPS_EMAIL>

# Vercel Sensitive: YES
STRIPE_SECRET_KEY=<GET_FROM_STRIPE_LIVE_MODE>

# Vercel Sensitive: NO
STRIPE_CONNECT_CLIENT_ID=<GET_FROM_STRIPE_CONNECT_LIVE>

# Vercel Sensitive: NO
TWILIO_ACCOUNT_SID=<GET_FROM_TWILIO_CONSOLE>

# Vercel Sensitive: YES
TWILIO_AUTH_TOKEN=<GET_FROM_TWILIO_CONSOLE>

# Vercel Sensitive: NO
TWILIO_API_KEY_SID=<GET_FROM_TWILIO_CONSOLE>

# Vercel Sensitive: YES
TWILIO_API_KEY_SECRET=<GET_FROM_TWILIO_CONSOLE>

# Vercel Sensitive: NO
TWILIO_TWIML_APP_SID=<GET_FROM_TWILIO_CONSOLE>


# =============================================================================
# API — DEVELOPMENT (your local apps/api/.env, or Vercel's Development env)
# =============================================================================

# Vercel Sensitive: NO
SUPABASE_URL=http://127.0.0.1:54321

# Vercel Sensitive: NO
SUPABASE_ANON_KEY=<GET_FROM_pnpm_db:start>

# Vercel Sensitive: YES
SUPABASE_JWT_SECRET=<GET_FROM_pnpm_db:start>

# Vercel Sensitive: YES
STRIPE_WEBHOOK_SECRET=<GET_FROM_stripe_listen>

# Vercel Sensitive: YES
RESEND_API_KEY=<GET_FROM_RESEND_DEV_KEY>

# Vercel Sensitive: NO
MESSAGE_FROM_ADDRESS=<YOUR_DEV_SENDER_ADDRESS>

# Vercel Sensitive: NO
TWILIO_ACCOUNT_SID=<GET_FROM_TWILIO_CONSOLE>

# Vercel Sensitive: YES
TWILIO_AUTH_TOKEN=<GET_FROM_TWILIO_CONSOLE>

# Vercel Sensitive: NO
MESSAGE_FROM_NUMBER=<GET_FROM_TWILIO_CONSOLE>

# Vercel Sensitive: YES
ANTHROPIC_API_KEY=<GET_FROM_ANTHROPIC_CONSOLE>

# CRON_SECRET: NOT SET locally — no scheduler runs against your machine.
# ASSISTANT_BASE_URL / ASSISTANT_MODEL / ASSISTANT_API_KEY: NOT SET unless you run a local model.
# CONDITIONS_ENABLED: your own choice, e.g. true


# =============================================================================
# API — PREVIEW (Vercel: next-fund-web/api, Preview)
# =============================================================================

# Vercel Sensitive: NO
SUPABASE_URL=https://nuceqypuwrjavrwiloda.supabase.co

# Vercel Sensitive: NO
SUPABASE_ANON_KEY=<ALREADY_SET_THIS_SESSION>

# STRIPE_WEBHOOK_SECRET, CRON_SECRET, RESEND_API_KEY, MESSAGE_FROM_ADDRESS, TWILIO_*,
# SUPABASE_JWT_SECRET, ANTHROPIC_API_KEY: NOT SET — see §7. A Preview deployment can read and
# render real data through the two variables above; it cannot send, call, or run automations.


# =============================================================================
# API — PRODUCTION (Vercel: next-fund-web/api, Production)
# =============================================================================

# Vercel Sensitive: NO
SUPABASE_URL=https://nuceqypuwrjavrwiloda.supabase.co

# Vercel Sensitive: NO
SUPABASE_ANON_KEY=<ALREADY_SET_THIS_SESSION>

# Vercel Sensitive: YES
SUPABASE_JWT_SECRET=<GET_FROM_SUPABASE_DASHBOARD_JWT_SETTINGS>

# Vercel Sensitive: YES
STRIPE_WEBHOOK_SECRET=<GET_FROM_STRIPE_DASHBOARD_PRODUCTION_ENDPOINT>

# Vercel Sensitive: YES
CRON_SECRET=<GENERATE_RANDOM_SECRET>

# Vercel Sensitive: YES
RESEND_API_KEY=<GET_FROM_RESEND_PRODUCTION_KEY>

# Vercel Sensitive: NO
MESSAGE_FROM_ADDRESS=<YOUR_PRODUCTION_SENDER_ADDRESS>

# Vercel Sensitive: NO
TWILIO_ACCOUNT_SID=<GET_FROM_TWILIO_CONSOLE>

# Vercel Sensitive: YES
TWILIO_AUTH_TOKEN=<GET_FROM_TWILIO_CONSOLE>

# Vercel Sensitive: NO
MESSAGE_FROM_NUMBER=<GET_FROM_TWILIO_CONSOLE>

# Vercel Sensitive: YES
ANTHROPIC_API_KEY=<GET_FROM_ANTHROPIC_CONSOLE_PRODUCTION_KEY>

# ASSISTANT_BASE_URL / ASSISTANT_MODEL / ASSISTANT_API_KEY: NOT SET unless choosing a
# self-hosted/alternate model for production answering.
```


## 11. VALUES DOMINIC NEEDS TO GO GET

1. **Supabase legacy JWT secret** — Supabase Dashboard > Project Settings > API > JWT Settings
   (reveal). App: api. Environment: Preview + Production (same project, same value). Secret: YES.
   Vercel Sensitive: YES. Cannot share with anything else. Stored in: `next-fund-web/api`.
2. **Stripe test secret key** — Stripe Dashboard, Test mode. App: web. Environments: Development,
   Preview. Format `sk_test_...`. Secret: YES. Sensitive: YES. Stored in: `next-fund-web/web`.
3. **Stripe live secret key** — Stripe Dashboard, Live mode. App: web. Environment: Production
   only. Format `sk_live_...`. Secret: YES. Sensitive: YES. Stored in: `next-fund-web/web`.
4. **Stripe Connect client id(s)** — Stripe Dashboard > Connect. App: web. One per mode if Stripe
   gives you separate Test/Live Connect apps. Secret: NO. Sensitive: NO. Stored in:
   `next-fund-web/web`.
5. **Stripe webhook signing secret(s)** — Stripe Dashboard > Webhooks, one per endpoint you
   create (Preview and Production are different endpoints). App: api. Format `whsec_...`.
   Secret: YES. Sensitive: YES. Stored in: `next-fund-web/api`.
6. **Twilio GOLD parent credentials** — Twilio Console > Account. Account SID (Secret: NO,
   Sensitive: NO) and Auth Token (Secret: YES, Sensitive: YES). Needed in **both** apps, same
   value. Stored in: `next-fund-web/web` and `next-fund-web/api`.
7. **Twilio API key + TwiML App** — Twilio Console > Voice / Account. App: web only (browser
   calling). SID values Secret: NO; the API key secret is Secret: YES/Sensitive: YES. Stored in:
   `next-fund-web/web`.
8. **Resend API key** — Resend Dashboard. App: api only. Secret: YES. Sensitive: YES. Stored in:
   `next-fund-web/api`.
9. **Google OAuth Client ID + Secret** — Google Cloud Console (see §8). Secret: NO / YES
   respectively. Stored in: **Supabase Auth Provider Configuration — not Vercel, either
   project.**
10. **A chosen hosted-AI provider key**, if you want anything other than Anthropic answering
    questions — the provider's own console (OpenAI, Google AI Studio for Gemini, or none for a
    self-hosted Ollama/vLLM endpoint you already control). App: api, paired with
    `ASSISTANT_BASE_URL`/`ASSISTANT_MODEL`. Secret: YES when a hosted key is used. Stored in:
    `next-fund-web/api`.
11. **Two Anthropic API keys** (they can be the same key, but the code treats them as
    independent): one for `apps/web` drafting, one for `apps/api` answering's default. Secret:
    YES both. Stored in `next-fund-web/web` and `next-fund-web/api` respectively.


## 12. VALUES GOLD GENERATES INTERNALLY

1. **`CRON_SECRET`** — recommended generation: 32+ random bytes, base64 or hex (e.g.
   `openssl rand -hex 32`). Vercel project: `next-fund-web/api`. Environment: Production only
   under current Vercel Cron behavior (§4/§5). Vercel Sensitive: YES. Rotation: safe to rotate
   any time — update this value and Vercel's own Cron configuration reads it fresh on the next
   invocation; nothing else references it.

No other internally-generated secret exists in the current code. `SUPABASE_JWT_SECRET` is
Supabase-issued (retrieved, not generated by GOLD); the Twilio API-key secret minted during
subaccount provisioning is generated by Twilio and written straight to Supabase Vault by
`store_provider_secret` — it never passes through an environment variable at all.


## 13. Final Vercel configuration summary

```
PROJECT              | VARIABLE                      | ENVIRONMENT           | VALUE SOURCE                                  | SENSITIVE
next-fund-web/web    | NEXT_PUBLIC_SUPABASE_URL      | Preview + Production  | Gold Platform project URL                     | NO
next-fund-web/web    | NEXT_PUBLIC_SUPABASE_ANON_KEY | Preview + Production  | Gold Platform anon key                        | NO
next-fund-web/web    | ASSISTANT_API_URL             | Production            | next-fund-web/api's stable production URL     | NO
next-fund-web/web    | TELEPHONY_CALLBACK_URL        | Production            | next-fund-web/api's stable production URL     | NO
next-fund-web/web    | ANTHROPIC_API_KEY             | Preview + Production  | Anthropic console (two separate keys)         | YES
next-fund-web/web    | GEOCODING_CONTACT             | All                   | chosen operations email                       | NO
next-fund-web/web    | STRIPE_SECRET_KEY             | Preview               | Stripe Test secret key                        | YES
next-fund-web/web    | STRIPE_SECRET_KEY             | Production            | Stripe Live secret key                        | YES
next-fund-web/web    | STRIPE_CONNECT_CLIENT_ID      | Preview + Production  | Stripe Connect (per mode)                     | NO
next-fund-web/web    | TWILIO_ACCOUNT_SID            | Production            | Twilio Console                                | NO
next-fund-web/web    | TWILIO_AUTH_TOKEN             | Production            | Twilio Console                                | YES
next-fund-web/web    | TWILIO_API_KEY_SID            | Production            | Twilio Console                                | NO
next-fund-web/web    | TWILIO_API_KEY_SECRET         | Production            | Twilio Console                                | YES
next-fund-web/web    | TWILIO_TWIML_APP_SID          | Production            | Twilio Console                                | NO
next-fund-web/api    | SUPABASE_URL                  | Preview + Production  | Gold Platform project URL                     | NO
next-fund-web/api    | SUPABASE_ANON_KEY             | Preview + Production  | Gold Platform anon key                        | NO
next-fund-web/api    | SUPABASE_JWT_SECRET           | Production            | Supabase Dashboard > API > JWT Settings       | YES
next-fund-web/api    | STRIPE_WEBHOOK_SECRET         | Production            | Stripe Dashboard, production endpoint         | YES
next-fund-web/api    | CRON_SECRET                   | Production            | generate securely                             | YES
next-fund-web/api    | RESEND_API_KEY                | Production            | Resend Dashboard                              | YES
next-fund-web/api    | MESSAGE_FROM_ADDRESS          | Production            | chosen sender address                         | NO
next-fund-web/api    | TWILIO_ACCOUNT_SID            | Production            | Twilio Console (same value as web)            | NO
next-fund-web/api    | TWILIO_AUTH_TOKEN             | Production            | Twilio Console (same value as web)            | YES
next-fund-web/api    | MESSAGE_FROM_NUMBER           | Production            | Twilio Console                                | NO
next-fund-web/api    | ANTHROPIC_API_KEY             | Preview + Production  | Anthropic console                             | YES
```

No tenant-specific credential appears above, by design (§1) — everything here is a GOLD
deployment bootstrap value.


## Where to start

**Visit the Supabase Dashboard first** — Project Settings > API > JWT Settings, for the "Gold
Platform" project. Reveal the legacy JWT secret and set it as `SUPABASE_JWT_SECRET` on
`next-fund-web/api`'s Production (and, once it exists, its own Preview project). Nothing else in
§11 blocks anything already working; this one blocks the Stripe webhook and the automation tick
entirely, and it is the value most likely to already exist and just need copying rather than
being created from scratch.
