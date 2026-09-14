# GOLD API

The Python deployable handles provider callbacks, scheduled work and the authenticated AI loop.
It deploys as Vercel serverless functions; it is not a daemon and does not own a general-purpose
public REST API.

## Layout and routes

Physical Vercel entrypoints live in `apps/api/api/`. Application/runtime code lives under
`apps/api/app/`. `app/auth/` is the one authentication boundary: it parses and verifies the
caller's Supabase access token and hands handlers an immutable `CallerContext`, rather than each
handler re-checking `Authorization: Bearer ...` for itself. It answers *is this token valid* and
*who is it*, never *what may this person do* — that stays with RLS, `app/domains/**`, and the
platform-staff checks (docs/constraints.md, "The AI axis" and "Tenancy and access").

| Logical route | Entrypoint | Purpose / trust path |
|---|---|---|
| `POST /webhooks/stripe` | `api/stripe_webhook.py` | Verify Stripe signature and record settlement through the narrow payment machine role. |
| `POST /tasks/automation-tick` | `api/automation_tick.py` | Verify `CRON_SECRET`, run due automations and drain configured message/reading work. |
| `POST /ai/ask` | `api/ai_ask.py` | Verify the signed-in person's token through `app/auth`, then forward it; the API holds no database role for this path. |
| `POST /voice/inbound` | `api/voice_inbound.py` | Verify/configure inbound carrier callback and record through the Voice machine path. |
| `POST /voice/outbound` | `api/voice_outbound.py` | Produce outbound call instructions and record provider events. |
| `POST /voice/status` | `api/voice_status.py` | Receive call/conference status callbacks. |
| `POST /voice/recording` | `api/voice_recording.py` | Receive recording metadata callbacks. |

`vercel.json` owns the rewrites from those logical routes to the physical handlers. Local
development uses `python apps/api/dev.py` and defaults to port 8787.

These routes prove the payment, Automation, Ask and Voice foundations. They do not prove M9:
recording metadata exists, but transcription, call analysis, timeline attachment of that
analysis, reviewed domain actions, browser softphone and realtime voice-agent delegation remain.

## Environment contract

Copy `apps/api/.env.example` to `apps/api/.env` for local development. Configure the same
names in the API Vercel project for hosted environments; do not upload the file.

| Variable | Used by | Notes |
|---|---|---|
| `SUPABASE_URL` | all database-backed handlers; `app/auth` derives the JWKS discovery URL from it | Required with the current low-privilege API key. |
| `SUPABASE_PUBLISHABLE_KEY` | PostgREST calls | Target name, matching `apps/web`'s `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. User operations still carry the user's JWT; this is only the low-privilege `apikey` header. `SUPABASE_ANON_KEY` is read as a temporary fallback name — do not configure both to different values. |
| `SUPABASE_JWT_SECRET` | payment, automation and Voice machine roles ONLY | Temporary legacy, very high-risk server secret. Used exclusively by `app/core/db.py` and `app/core/runner.py` to mint short-lived machine tokens — never by `app/auth`, which authoritatively verifies a human token either locally against Supabase's JWKS (asymmetric-signing-key tokens) or by asking Supabase's own Auth server (legacy HS256 tokens), and needs no shared secret for either. Without it the machine-role handlers remain unconfigured. Never substitute a service-role or `sb_secret_` key. |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook | Endpoint- and environment-specific signing secret. |
| `CRON_SECRET` | automation tick | Random shared secret; Vercel Cron normally invokes Production. |
| `RESEND_API_KEY`, `MESSAGE_FROM_ADDRESS` | tenant-channel email | Separate operational concern from Web's platform invitation email configuration. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `MESSAGE_FROM_NUMBER` | messaging and Voice callbacks | Deployment/provider configuration; tenant resources increasingly live in provider bindings. |
| `ANTHROPIC_API_KEY` | hosted model fallback | Optional. |
| `ASSISTANT_BASE_URL`, `ASSISTANT_MODEL`, `ASSISTANT_API_KEY` | OpenAI-compatible model binding | Base URL and model are paired; key is optional for providers that do not need one. Local endpoints are useful in development but remain Platform Context configuration. |
| `CONDITIONS_ENABLED` | external condition/weather readings | Explicit boolean feature switch. |
| `PORT` | local dev server only | Do not configure on Vercel. |

The authoritative deployment-by-environment and secret-handling table is in the repository root
`SETUP.md`. In particular, `SUPABASE_JWT_SECRET` remains a current compatibility dependency,
not a recommended long-term authentication architecture.

## Provider boundaries

Runtime code calls capability adapters and narrow database functions. Product/domain code must
not depend on a supplier brand. Provider bindings describe an organization's configured
relationship; provider resources record concrete numbers, domains or accounts; normalized usage
and cost enter the shared ledger.

The long-term Intelligence runtime adds explicit model bindings, routing, fallback, budgets,
quotas, concurrency, health, audit and safety. External tenants may consume managed AI features,
but tenant-managed model endpoints, credentials and local-model selection are not supported by
the current control plane.
