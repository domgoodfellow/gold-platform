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

| Logical route | Entrypoint | Trust and purpose |
|---|---|---|
| `POST /webhooks/stripe` | `api/stripe_webhook.py` | Stripe signature over the raw body. Records a customer's settlement through the narrow payment machine role. |
| `POST /webhooks/stripe-platform-billing` | `api/stripe_platform_billing_webhook.py` | Stripe signature, on its own secret and role. Applies GOLD's own subscription events; never the tenant-payment path. |
| `GET, POST /tasks/automation-tick` | `api/automation_tick.py` | `Authorization: Bearer $CRON_SECRET` from the host's scheduler. Runs due automations and drains message and reading work. |
| `POST /ai/ask` | `api/ai_ask.py` | The signed-in person's bearer token through `app/auth`, then forwarded. The API holds no database role for this path. |
| `POST /crm/change-customer-stage` | `api/crm_change_customer_stage.py` | Bearer token, forwarded. A domain command under the caller's own rights. |
| `POST /voice/wrap-up-call` | `api/voice_wrap_up_call.py` | Bearer token, forwarded. A domain command under the caller's own rights. |
| `POST /routing/preview-inbound` | `api/routing_preview_inbound.py` | Bearer token, forwarded. Calls the exact resolver a live inbound call will use, never a second approximation. |
| `POST /routing/preview-outbound` | `api/routing_preview_outbound.py` | Bearer token, forwarded. Resolves the outbound caller identity a placed call would actually use. |
| `POST /integrations/operate` | `api/integration_operations.py` | Bearer token; the caller must be able to manage integrations for that business. OAuth handshake and disconnect. |
| `POST /providers/operate` | `api/provider_operations.py` | Bearer token; platform staff only, proved by RLS. Operates GOLD's own provider account. |
| `POST /organizations/domains` | `api/organization_domains.py` | Bearer token; the caller must hold `organization.manage` in that business, proved by RLS. Connects, rechecks or removes a custom domain at GildOps' hosting provider. |
| `POST /voice/inbound` | `api/voice_inbound.py` | Twilio signature. Declines the call; a number with no configured behaviour says nothing of its own. |
| `POST /voice/outbound` | `api/voice_outbound.py` | Twilio signature. Returns the conference instructions for the room the web app created. |
| `POST /voice/status` | `api/voice_status.py` | Twilio signature. Records a call's status through the Voice machine role. |
| `POST /voice/recording` | `api/voice_recording.py` | Twilio signature. Records recording metadata through the Voice machine role. |
| `POST /public_chat` | `api/public_chat.py` | Shared server-to-server key (`x-gold-public-chat-key`) from `apps/web` only; the same answer as "not configured" on any mismatch. Public-site assistant. |

16 deployable handlers, one file each. Vercel also serves every file under `api/` at its
physical `/api/<name>` path, so a rewrite is the documented route, not the only reachable one.
`tests/architecture/static/python-handler-inventory.test.ts` holds this table, `vercel.json`, the
files in `api/` and the handler tests to one another.

`vercel.json` owns the rewrites from those logical routes to the physical handlers. Local
development uses `python apps/api/dev.py` and defaults to port 8787.

Tests need `pip install -r apps/api/requirements-dev.txt` (production installs `requirements.txt`
alone). `pytest.ini` sets the import root, so a test imports `app` and `api` as the handlers do.

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
