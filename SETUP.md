# GOLD environment pre-flight

This is the final narrow checklist before entering values in Vercel. It reflects what the
current code reads today; it does not configure Vercel, Stripe, Supabase, Twilio, Resend, or any
other external service.

Official references checked on 2026-09-10:

- Vercel Sensitive Environment Variables: https://vercel.com/docs/environment-variables/sensitive-environment-variables
- Stripe API keys: https://docs.stripe.com/keys
- Stripe webhooks: https://docs.stripe.com/webhooks
- Stripe Connect OAuth: https://docs.stripe.com/connect/oauth-standard-accounts
- Supabase JWT signing keys: https://supabase.com/docs/guides/auth/signing-keys
- Supabase API keys: https://supabase.com/docs/guides/getting-started/api-keys

## Status vocabulary

| Status | Meaning |
|---|---|
| READY TO CONFIGURE | Safe to enter once you have the value. |
| READY TO CONFIGURE - TEST/NON-PRODUCTION ONLY | Safe for Preview/testing; do not reuse for Production. |
| TEMPORARY LEGACY REQUIREMENT | Current code needs it for implemented flows, but it is not the desired final architecture. |
| DO NOT CONFIGURE YET | Hold until the architecture/security decision is consciously made. |
| NOT REQUIRED | Do not create the variable for this environment. |
| TENANT CONFIG - NOT VERCEL | Belongs in GOLD database/provider binding, not in Vercel env. |
| SYSTEM PROVIDED | The runtime provides it; do not enter by hand. |

Vercel Sensitive mode is available only for Preview and Production. For Development secrets, use:

```text
Secret: YES
Vercel Sensitive: N/A - Vercel Sensitive mode is unavailable for Development
Browser-visible: NO
```

## Vercel identity

Local `.vercel/project.json` metadata provides IDs and project names only.

| Field | Value |
|---|---|
| VERCEL TEAM/ACCOUNT DISPLAY NAME | UNKNOWN - VERIFY IN VERCEL DASHBOARD |
| VERCEL TEAM/ACCOUNT SLUG | UNKNOWN - VERIFY IN VERCEL DASHBOARD |
| VERCEL TEAM/ACCOUNT ID | `team_GGtHTC8yCv61JBJYLpB0rvDa` |
| WEB PROJECT NAME | `web` |
| WEB PROJECT ID | `prj_uvkm1pVH4Qyj7VMSarie031xmqah` |
| WEB ROOT DIRECTORY | `apps/web` |
| API PROJECT NAME | `api` |
| API PROJECT ID | `prj_s2yKtr1x3ndXyX2VaVYGGZmo20p4` |
| API ROOT DIRECTORY | `apps/api` |
| GITHUB REPOSITORY | `https://github.com/domgoodfellow/gold-platform.git` |

`next-fund-web/web` is a scope/project notation from the earlier naming, not a verified project
name in local metadata. Locally, the linked Vercel project names are only `web` and `api`.

## Deleted-env-file claim

Verified with `git status`, `git diff`, `git ls-files`, and path-specific `git log`:

| File | Current answer |
|---|---|
| `apps/web/.env.preview.example` | Not tracked in current HEAD; no current deletion; no path history found. |
| `apps/web/.env.production.example` | Not tracked in current HEAD; no current deletion; no path history found. |
| `apps/api/.env.preview.example` | Not tracked in current HEAD; no current deletion; no path history found. |
| `apps/api/.env.production.example` | Not tracked in current HEAD; no current deletion; no path history found. |

So do not describe those four files as repository files removed in this pass. The tracked
contracts are `apps/web/.env.example` and `apps/api/.env.example`.

There is also an ignored local typo file, `apps/web/.env..example`; do not use it.

## SUPABASE_JWT_SECRET pre-flight

Current consumers:

| Runtime feature | Exact code path |
|---|---|
| Stripe payment webhook | `apps/api/app/core/config.py::load_settings` reads `SUPABASE_JWT_SECRET`; `apps/api/api/stripe_webhook.py::handler.do_POST` calls `load_settings`; `apps/api/app/core/db.py::record_provider_payment` calls `machine_token` for role `payment_webhook`; SQL grant: `record_provider_payment(...)` to `payment_webhook`. |
| Automation runner | `apps/api/app/core/config.py::load_runner_settings` reads `SUPABASE_JWT_SECRET`; `apps/api/api/automation_tick.py::handler._tick` calls `load_runner_settings`; `apps/api/app/core/runner.py::_post` calls `machine_token` for role `automation_runner`; runtime calls `run_due_automations`, `queued_messages`, `record_message_delivery`, `places_to_watch`, and `record_external_readings`. |
| Voice webhook/callback handling | `apps/api/app/core/config.py::load_voice_settings` reads `SUPABASE_JWT_SECRET`; `apps/api/api/voice_inbound.py`, `voice_outbound.py`, `voice_status.py`, and `voice_recording.py` call `load_voice_settings`; `apps/api/app/core/db.py::record_call_event` calls `machine_token` for role `voice_webhook`; SQL grant: `record_call_event(...)` to `voice_webhook`. |

Answers:

| Question | Answer |
|---|---|
| A. Does current GOLD Production require `SUPABASE_JWT_SECRET` to operate the implemented machine-role flows? | Yes, for the current implemented machine-role flows listed above. |
| B. Exactly which features become unavailable without it? | Stripe settlement recording, scheduled automation execution/message draining/external readings, and voice callback handling for inbound/outbound/status/recording. The API handlers return 404 when their required env group is incomplete. |
| C. Is the value the legacy JWT secret? | Yes. This is Supabase's legacy extractable JWT secret architecture, not the newer signing-keys architecture. |
| D. How privileged is this credential if compromised? | VERY HIGH. A holder can mint JWTs trusted by the Supabase project; that can impersonate roles/users depending on grants and can defeat the intended RLS boundary. |
| E. Is using it acceptable as a temporary current-state deployment decision? | Yes, only as `TEMPORARY LEGACY COMPATIBILITY REQUIREMENT`, stored as a sensitive server-side Production/Preview secret, while the migration is opened and tracked. |
| F. What future migration should be opened separately? | Migrate machine auth away from the legacy shared JWT secret to Supabase's current signing-key/API-key architecture, preferably asymmetric signing for machine tokens or another narrowly-scoped auth design, with tests for payment, automation, and voice machine roles. |

Classification:

```text
Secret: YES
Vercel Sensitive Production: YES
Vercel Sensitive Preview: YES if configured
Vercel Sensitive Development: N/A - Vercel Sensitive mode is unavailable for Development
Browser-visible: NO
Security impact: VERY HIGH
```

## Stripe setup

GOLD's current Stripe integration has three pieces:

| Piece | Vercel project | Variable | Mode |
|---|---|---|---|
| Create Connect OAuth URLs and Checkout Sessions | Web | `STRIPE_SECRET_KEY` | Preview uses Stripe test/sandbox key; Production uses live key. |
| Identify the Stripe Connect platform app | Web | `STRIPE_CONNECT_CLIENT_ID` | Preview uses test/sandbox client ID; Production uses live client ID. |
| Verify Stripe's callback before recording payment | API | `STRIPE_WEBHOOK_SECRET` | One `whsec_...` per endpoint/environment. |

How to make test keys:

1. In Stripe Dashboard, switch to test/sandbox mode.
2. Go to Developers > API keys.
3. Copy the secret key beginning `sk_test_...` for `STRIPE_SECRET_KEY` in Preview.
4. Go to Connect settings/OAuth settings and copy the test/sandbox `ca_...` client ID for
   `STRIPE_CONNECT_CLIENT_ID` in Preview.
5. Create a test webhook endpoint pointing at the Preview API URL:
   `https://<api-preview-host>/webhooks/stripe`.
6. Subscribe at least to `checkout.session.completed`, then reveal/copy its `whsec_...` value
   into `STRIPE_WEBHOOK_SECRET` for the API Preview environment.

For Production, repeat the same shape in live mode with `sk_live_...`, the live Connect client
ID, and a Production webhook endpoint at `https://<api-production-host>/webhooks/stripe`.

The app does not currently need a Stripe publishable key because Checkout Sessions are created
server-side in `apps/web/lib/adapters/payments/stripe.ts`.

Connect redirect URLs must match the callback route generated by the web host:

```text
https://<web-host>/organizations/<organizationId>/settings/payments/callback
```

For Preview, use a stable preview alias if possible; otherwise Stripe must allow the exact
preview host you are testing.

## Platform staff account

`/platform` is not enabled by an environment variable. It is enabled by a database row in
`public.platform_staff`.

Setup sequence:

1. Sign up normally with the email you want to use for GOLD internals.
2. Run `supabase/snippets/add-platform-staff.sql` against the target Supabase project, editing
   `v_email` and `v_name` first.
3. Reload; the next request checks the staff row live.
4. Visit `/platform` or choose Platform Administration in the context switcher.

The same identity may also be an ordinary member of one or more organizations. Staff authority
is checked live by `app.is_platform_staff()`; it does not replace the JWT role. Reload after
adding the row and use the context switcher—no second account, logout or re-login is required.
Support sessions are an audit record and do not widen access to tenant operational data.

## DO NOT CONFIGURE YET

| Project | Variable | Why |
|---|---|---|
| API | `SUPABASE_JWT_SECRET` | Do not enter casually. If you choose to enable current machine-role flows before migration, enter it only as `TEMPORARY LEGACY REQUIREMENT`. |
| API Preview | `TWILIO_AUTH_TOKEN`, `RESEND_API_KEY`, `MESSAGE_FROM_NUMBER`, `MESSAGE_FROM_ADDRESS` | Shared hosted Supabase means Preview could send against real data unless a separate staging project/provider setup exists. |
| Web Preview | `TWILIO_AUTH_TOKEN`, `TWILIO_API_KEY_SECRET`, `TWILIO_API_KEY_SID`, `TWILIO_TWIML_APP_SID`, `TELEPHONY_CALLBACK_URL` | Same shared-data caution, plus callbacks need stable Preview URLs. |
| Both | Tenant Stripe/Twilio/Resend credentials | TENANT CONFIG - NOT VERCEL. Store tenant provider IDs/resources through GOLD provider binding flows, not Vercel env. |

## Final Vercel table

| PROJECT | VARIABLE | ENVIRONMENT | STATUS | SECRET? | VERCEL SENSITIVE? | SOURCE | READY FOR ME TO ENTER NOW? | NOTES |
|---|---|---|---|---|---|---|---|---|
| Web | `NEXT_PUBLIC_SUPABASE_URL` | Preview + Production | READY TO CONFIGURE | NO | NO | Supabase project URL | YES | Browser-visible. |
| Web | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Preview + Production | READY TO CONFIGURE | NO | NO | Supabase publishable key | YES | Browser-visible and the tracked Web environment contract. The current database helpers retain an anon-key compatibility fallback; do not use that fallback for new configuration. |
| Web | `SITE_URL` | Preview + Production | READY TO CONFIGURE | NO | NO | Canonical GOLD web origin, for example `https://gold.example` | YES | Server-read public configuration; sitemap, canonical, and social metadata share it. |
| Web | `ASSISTANT_API_URL` | Production | READY TO CONFIGURE | NO | NO | API production URL | YES, once API URL is known | Server-side only. |
| Web | `ASSISTANT_API_URL` | Preview | DO NOT CONFIGURE YET | NO | NO | Stable API Preview URL | NO | Wait for stable Preview API target. |
| Web | `GEOCODING_CONTACT` | Preview + Production | READY TO CONFIGURE | NO | NO | Ops contact email | YES | Not a credential. |
| Web | `STRIPE_SECRET_KEY` | Preview | READY TO CONFIGURE - TEST/NON-PRODUCTION ONLY | YES | YES | Stripe test/sandbox API key, `sk_test_...` | YES | Server-side; no real charges. |
| Web | `STRIPE_SECRET_KEY` | Production | READY TO CONFIGURE | YES | YES | Stripe live API key, `sk_live_...` | YES, when going live | Keep separate from test key. |
| Web | `STRIPE_CONNECT_CLIENT_ID` | Preview | READY TO CONFIGURE - TEST/NON-PRODUCTION ONLY | NO | NO | Stripe Connect test/sandbox client ID, `ca_...` | YES | Pair with test secret key. |
| Web | `STRIPE_CONNECT_CLIENT_ID` | Production | READY TO CONFIGURE | NO | NO | Stripe Connect live client ID, `ca_...` | YES, when going live | Pair with live secret key. |
| Web | `ANTHROPIC_API_KEY` | Preview + Production | READY TO CONFIGURE | YES | YES | Anthropic Console | OPTIONAL | Enables setup drafting. |
| Web | `RESEND_API_KEY` | Preview + Production | READY TO CONFIGURE | YES | YES | Resend Dashboard | OPTIONAL | GOLD's own platform email (organization invitations) — a separate concern from the API project's `RESEND_API_KEY`, which is a tenant's own channel. Same account may issue both in practice. |
| Web | `PLATFORM_EMAIL_FROM_ADDRESS` | Preview + Production | READY TO CONFIGURE | NO | NO | Verified sender/domain | OPTIONAL | Pair with Web's `RESEND_API_KEY`. Unconfigured means invitations still work — the copyable link is always shown regardless. |
| Web | `TWILIO_ACCOUNT_SID` | Production | READY TO CONFIGURE | NO | NO | Twilio Console | OPTIONAL | Needed for telephony provisioning/browser calling. |
| Web | `TWILIO_AUTH_TOKEN` | Production | READY TO CONFIGURE | YES | YES | Twilio Console | OPTIONAL | Sensitive. |
| Web | `TWILIO_API_KEY_SID` | Production | READY TO CONFIGURE | NO | NO | Twilio Console | OPTIONAL | Browser Voice SDK. |
| Web | `TWILIO_API_KEY_SECRET` | Production | READY TO CONFIGURE | YES | YES | Twilio Console | OPTIONAL | Browser Voice SDK. |
| Web | `TWILIO_TWIML_APP_SID` | Production | READY TO CONFIGURE | NO | NO | Twilio Console | OPTIONAL | Browser Voice SDK. |
| Web | `TELEPHONY_CALLBACK_URL` | Production | READY TO CONFIGURE | NO | NO | API production URL | OPTIONAL | Needed for Twilio callbacks. |
| API | `SUPABASE_URL` | Preview + Production | READY TO CONFIGURE | NO | NO | Supabase project URL | YES | Same project as Web unless staging is split. |
| API | `SUPABASE_ANON_KEY` | Preview + Production | READY TO CONFIGURE | NO | NO | Supabase anon/public key | YES | Current source reads this exact name. |
| API | `SUPABASE_JWT_SECRET` | Production | TEMPORARY LEGACY REQUIREMENT | YES | YES | Supabase Dashboard JWT settings | ONLY AFTER APPROVAL | Required by current payment/automation/voice machine-role flows. |
| API | `SUPABASE_JWT_SECRET` | Preview | DO NOT CONFIGURE YET | YES | YES if configured | Supabase Dashboard JWT settings | NO | Do not give Preview machine write powers against shared production data casually. |
| API | `STRIPE_WEBHOOK_SECRET` | Preview | READY TO CONFIGURE - TEST/NON-PRODUCTION ONLY | YES | YES | Stripe test webhook endpoint, `whsec_...` | YES, after endpoint exists | Separate from API key; webhook still will not process until the `SUPABASE_JWT_SECRET` decision is made. |
| API | `STRIPE_WEBHOOK_SECRET` | Production | READY TO CONFIGURE | YES | YES | Stripe live webhook endpoint, `whsec_...` | YES, when going live | Separate endpoint/secret from Preview. |
| API | `CRON_SECRET` | Production | READY TO CONFIGURE | YES | YES | Generate 32+ random bytes | YES, when automations go live | Vercel Cron normally targets Production. |
| API | `CRON_SECRET` | Preview | NOT REQUIRED | YES | N/A | None | NO | No scheduled Preview cron by default. |
| API | `RESEND_API_KEY` | Production | READY TO CONFIGURE | YES | YES | Resend Dashboard | OPTIONAL | Email sending. |
| API | `MESSAGE_FROM_ADDRESS` | Production | READY TO CONFIGURE | NO | NO | Verified sender/domain | OPTIONAL | Pair with Resend. |
| API | `TWILIO_ACCOUNT_SID` | Production | READY TO CONFIGURE | NO | NO | Twilio Console | OPTIONAL | SMS/callback support. |
| API | `TWILIO_AUTH_TOKEN` | Production | READY TO CONFIGURE | YES | YES | Twilio Console | OPTIONAL | Also verifies voice callbacks. |
| API | `MESSAGE_FROM_NUMBER` | Production | READY TO CONFIGURE | NO | NO | Twilio phone number | OPTIONAL | SMS sender fallback. |
| API | `ANTHROPIC_API_KEY` | Preview + Production | READY TO CONFIGURE | YES | YES | Anthropic Console | OPTIONAL | Answering fallback. |
| API | `ASSISTANT_BASE_URL` | Preview + Production | READY TO CONFIGURE | NO | NO | Chosen OpenAI-compatible provider | OPTIONAL | Pair with `ASSISTANT_MODEL`. |
| API | `ASSISTANT_MODEL` | Preview + Production | READY TO CONFIGURE | NO | NO | Chosen OpenAI-compatible provider | OPTIONAL | Pair with `ASSISTANT_BASE_URL`. |
| API | `ASSISTANT_API_KEY` | Preview + Production | READY TO CONFIGURE | YES when populated | YES if populated | Chosen hosted provider | OPTIONAL | Not needed for local/self-hosted endpoints. |
| API | `CONDITIONS_ENABLED` | Preview + Production | READY TO CONFIGURE | NO | NO | Literal `false`/`true` | YES | Use `false` during infra setup. |
| Web/API | `NODE_ENV`, Vercel runtime vars | All | SYSTEM PROVIDED | NO | N/A | Vercel/Next runtime | NO | Do not create manually. |

SAFE FIRST CONFIGURATION STEP:

Create and enter the Stripe Preview web values only:

```text
Web Preview: STRIPE_SECRET_KEY=sk_test_...
Web Preview: STRIPE_CONNECT_CLIENT_ID=ca_...
```

This is the safest first step because it is test/non-production Stripe configuration and does
not require approving the high-privilege Supabase legacy JWT secret. Add the Preview webhook
secret only after you have a stable Preview API URL and have decided whether that Preview
deployment may hold the temporary legacy machine-auth secret.
