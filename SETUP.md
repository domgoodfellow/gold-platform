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

## Human-auth pre-flight

`apps/api/app/auth/` is the API's one boundary for a human caller's Supabase access token
(`api/ai_ask.py`, `api/crm_change_customer_stage.py`, `api/voice_wrap_up_call.py`). It reads only
`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` and needs no separate variable and no shared secret.
Every request is authoritatively verified — by one of two mechanisms — before any of those
handlers calls a domain function, a model, or a provider. There is no unverified-token fallback.

Which mechanism runs is chosen by the caller's own token (its declared signing algorithm), not by
anything configured in this repository, so the same deployment handles both generations correctly
without needing to know which one issued a given token:

| Token's signing generation | What `app/auth` does | `SUPABASE_JWT_SECRET` needed? |
|---|---|---|
| Asymmetric signing key (`RS256`/`ES256`/`EdDSA` — current Supabase default for new projects) | Fetches the project's JWKS and verifies the signature, issuer, audience and expiry locally | NO |
| Legacy shared HS256 secret | Calls Supabase's own Auth server (`GET /auth/v1/user` with the bearer token and the publishable key) — a 200 is Supabase itself vouching for the token | NO — this path is never given that secret |

Both rows are a finished, authoritative verification, not "reduced assurance" for the legacy row —
the difference is a local check versus a networked one, not a weaker guarantee. The networked
check does add a latency/availability dependency on Supabase Auth: if it cannot be reached or
answers with a server error, `app/auth` refuses the request (503) rather than letting it through.

Confirm which state the target Supabase project is in under Dashboard > Authentication > Sign In
/ Providers > JWT Keys if you want to know which row applies today; this repository does not need
that answer to run securely on either one. `supabase/config.toml` does not set it either way, and
a locally-run `supabase start` currently issues legacy HS256 tokens by default — which is exactly
the case this pre-flight exists to make safe without asking you to migrate first.

## SUPABASE_JWT_SECRET pre-flight (machine roles only)

This section is unrelated to the human-auth path above — `SUPABASE_JWT_SECRET` is read only by
the machine-role writers below and never by `app/auth`.

Current consumers:

| Runtime feature | Exact code path |
|---|---|
| Stripe payment webhook | `apps/api/app/core/config.py::load_settings` reads `SUPABASE_JWT_SECRET`; `apps/api/api/stripe_webhook.py::handler.do_POST` calls `load_settings`; `apps/api/app/core/db.py::record_provider_payment` calls `machine_token` for role `payment_webhook`; SQL grant: `record_provider_payment(...)` to `payment_webhook`. |
| GOLD platform billing webhook | `apps/api/app/core/config.py::load_platform_billing_settings` reads `SUPABASE_JWT_SECRET`; `apps/api/api/stripe_platform_billing_webhook.py::handler.do_POST` calls `load_platform_billing_settings`; `apps/api/app/core/db.py::apply_platform_subscription_event`/`record_platform_billing_notice` call `machine_token` for role `platform_billing_webhook`; SQL grants: both functions to `platform_billing_webhook` only. **Not the row above** — a different Stripe destination (GOLD's own account, not the tenant-Connect one), a different signing secret (`STRIPE_PLATFORM_BILLING_WEBHOOK_SECRET`), a different Postgres role, holding no grant the payment webhook holds and vice versa. |
| Provider operations (staff acting on a GOLD provider account) | `apps/api/app/core/config.py::load_provider_operations_settings` reads `SUPABASE_JWT_SECRET`; `apps/api/api/provider_operations.py::handler.do_POST` proves the caller is platform staff, then `apps/api/app/core/db.py::read_provider_account_credential`/`record_provider_account_verification` call `machine_token` for role `provider_operator`; SQL grants: those two functions to `provider_operator` only. `apps/web` reaches it through `GOLD_API_URL` and the operator's own token. |
| Integration credentials (a business connecting its own Google or Microsoft account) | `apps/api/app/core/config.py::load_integration_settings` reads `SUPABASE_JWT_SECRET`; `apps/api/api/integration_operations.py::handler.do_POST` proves the caller may manage integrations for the business, then `apps/api/app/core/db.py::read_integration_credential` and its four siblings call `machine_token` for role `integration_operator`; SQL grants: those five functions to `integration_operator` only. Also needs `GOLD_OAUTH_STATE_SECRET`, `GOLD_OAUTH_REDIRECT_URI` (the web address `/connect/oauth/callback`, registered with each vendor) and, per vendor, `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET` or `MICROSOFT_OAUTH_CLIENT_ID`/`_SECRET`. `apps/web` reaches it through `GOLD_API_URL` and the caller's own token. |
| Automation runner | `apps/api/app/core/config.py::load_runner_settings` reads `SUPABASE_JWT_SECRET`; `apps/api/api/automation_tick.py::handler._tick` calls `load_runner_settings`; `apps/api/app/core/runner.py::_post` calls `machine_token` for role `automation_runner`; runtime calls `run_due_automations`, `queued_messages`, `record_message_delivery`, `places_to_watch`, and `record_external_readings`. |
| Voice webhook/callback handling | `apps/api/app/core/config.py::load_voice_settings` reads `SUPABASE_JWT_SECRET`; `apps/api/api/voice_inbound.py`, `voice_outbound.py`, `voice_status.py`, and `voice_recording.py` call `load_voice_settings`; `apps/api/app/core/db.py::record_call_event` calls `machine_token` for role `voice_webhook`; SQL grant: `record_call_event(...)` to `voice_webhook`. |

Answers:

| Question | Answer |
|---|---|
| A. Does current GOLD Production require `SUPABASE_JWT_SECRET` to operate the implemented machine-role flows? | Yes, for the current implemented machine-role flows listed above. |
| B. Exactly which features become unavailable without it? | Stripe settlement recording, GOLD platform-billing subscription reconciliation (customer.subscription.*/invoice.* processing), scheduled automation execution/message draining/external readings, and voice callback handling for inbound/outbound/status/recording. The API handlers return 404 when their required env group is incomplete. |
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

## GOLD platform billing setup (sandbox)

**Not the section above.** "Stripe setup" configures GOLD as a payments *facilitator* for
tenants (Stripe Connect — a customer pays a tenant through the tenant's own connected account,
D27). This section configures the opposite money direction: **an organization paying GOLD**, on
GOLD's own Stripe account, using Stripe Billing/Checkout/Customer Portal. It reuses the same
`STRIPE_SECRET_KEY` (both are GOLD's own account credential — Connect's calls carry a
`Stripe-Account` header, this plane's calls do not) but needs its **own** webhook destination and
its own signing secret, because a leaked platform-billing secret must never authenticate as the
tenant-payment webhook or the other way round.

Everything below is sandbox/test-mode only. Do not repeat any of it in live mode without
explicitly deciding GOLD's real commercial pricing first (this code deliberately invents no final
prices — see `apps/web/app/(platform)/platform/catalog/plans`).

### 1. Create a sandbox Product and a recurring Price

1. In the Stripe Dashboard, switch to **Test mode** (top-right toggle).
2. Open **Product catalog** (left navigation) → **Add product**.
3. Name it after a GOLD Plan you have already created at `/platform/catalog/plans` in this app
   (e.g. "Starter") — the name is cosmetic on Stripe's side; what actually links the two is the
   Price reference GOLD stores, not the Product name.
4. Under **Pricing**, choose **Recurring**, pick **Monthly** or **Yearly**, enter the amount and
   currency, and save. Stripe shows the created Price's id, `price_...` — you do not need to copy
   it by hand: the next step does that for you.
5. **Do this from inside GOLD's own admin, not by copying the id manually where avoidable.** Open
   `/platform/catalog/plans/<planKey>` → **Pricing** tab → **Provision in Stripe (sandbox)**
   next to the recorded price. This calls the Stripe API itself (idempotently, keyed to that
   Plan/price) and records the resulting Product/Price references in
   `platform_plan_provider_prices`. If you created the Product/Price by hand in the Dashboard
   first, provisioning here still creates its own Product/Price (Phase 4's chosen approach: GOLD
   provisions via the API, matching this admin action) — the Dashboard walkthrough above is for
   understanding what "Provision in Stripe" is doing under the hood, not a step you also have to
   copy an id back from.

### 2. Configure the Customer Portal

1. Go to **Settings → Billing → Customer portal** (still in Test mode).
2. Turn the portal **on** for test mode if it is not already.
3. Under **Functionality**, enable at least: update payment method, view invoice history, and
   cancel subscription. Plan-switching within the portal is optional for this slice — GOLD does
   not yet offer a self-service Plan picker (checkout subscribes to whichever Plan is already
   assigned to the organization).
4. Save.

### 3. Create the platform-billing webhook destination

**This must be a separate destination from the tenant-Connect one** ("Stripe setup" above), which
listens for `checkout.session.completed` scoped to **Connected accounts**. This one listens on
**your account**.

1. Open **Workbench → Webhooks** (or **Developers → Webhooks** in older Dashboard layouts) →
   **Add destination**.
2. Under **Events from**, choose **Your account** (not "Connected accounts" — that scope is the
   existing tenant-payment destination and must not be reused here).
3. Select events. Only these, matching exactly what
   `apps/api/app/integrations/stripe/platform_billing_webhook.py` reads (checked against current
   Stripe guidance at docs.stripe.com/billing/subscriptions/webhooks rather than assumed):
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`

   Do **not** also select `checkout.session.completed` here — this handler does not subscribe to
   it (subscription lifecycle is fully covered by the events above, resolved by Stripe's customer
   reference rather than a session id; see that file's module docstring for the reasoning).
4. Under **Destination type**, choose **Webhook endpoint** and enter:
   `https://<api-preview-or-production-host>/webhooks/stripe-platform-billing` (or whatever path
   `apps/api/api/stripe_platform_billing_webhook.py` is deployed at — Vercel's Python runtime
   routes a file under `api/` to a path matching its name, D24).
5. Create the destination, then open it and **Reveal** the signing secret, `whsec_...`.

### 4. Where each value goes

| Value | Vercel project | Variable |
|---|---|---|
| GOLD's own Stripe secret key (same one "Stripe setup" already configured) | Web | `STRIPE_SECRET_KEY` — no new variable; this plane reuses it |
| The signing secret from step 3 | API | `STRIPE_PLATFORM_BILLING_WEBHOOK_SECRET` |

`STRIPE_PLATFORM_BILLING_WEBHOOK_SECRET` follows the exact same classification as
`STRIPE_WEBHOOK_SECRET` above (a per-endpoint `whsec_...`, Secret + Vercel Sensitive, one value
per environment) — see the Final Vercel table.

### 5. Run a complete sandbox subscription checkout

1. Sign in to this app as an organization's billing manager (a role holding `billing.manage` —
   the founding owner role has it by default) and make sure that organization's currency is set
   (Settings → General) and matches a price you provisioned in step 1.
2. Make sure platform staff has assigned that organization the Plan whose price you provisioned
   (`/platform/organizations/<organizationId>/commercial` → Plan tab, or
   `/platform/catalog/plans/<planKey>` → Organizations tab).
3. Go to `Settings → Plan & usage` for that organization → **Subscribe to \<Plan>**.
4. You land on Stripe-hosted Checkout. Use the test card below.
5. On success you return to `Settings → Plan & usage?checkout=success`. **The screen does not
   claim anything happened yet** — it reads GOLD's own database, which the webhook, not the
   redirect, updates. Within a few seconds `customer.subscription.created` should arrive and the
   page (on refresh) shows a status of `active` or `trialing`.

Test card for a successful payment: `4242 4242 4242 4242`, any future expiry, any 3-digit CVC,
any postal code.

### 6. Verify the organization became active

- In this app: `Settings → Plan & usage` shows a `Billing` section with status `active` and a
  renewal date, or staff can check `/platform/billing` (lists every organization's status) or
  `/platform/organizations/<organizationId>/commercial`.
- In Stripe: **Customers** (test mode) shows the new Customer with an active Subscription.

### 7. Test a payment failure

1. In Stripe test mode, use a card that always fails, e.g. `4000 0000 0000 0002` (generic
   decline), for a *new* subscription attempt, or use the Dashboard's **Subscriptions** → open
   the test subscription → simulate a failed renewal invoice (Stripe test mode exposes a "advance
   test clock" / manual invoice action for this on subscription objects created with a test
   clock; consult Stripe's current Billing testing docs — docs.stripe.com/billing/testing — for
   the exact current control, since Dashboard test tooling changes independently of this codebase).
2. Confirm `invoice.payment_failed` arrives at the webhook (step 8 shows you how to check), and
   that the subsequent `customer.subscription.updated` moves `organization_platform_subscriptions
   .status` to `past_due` — visible at `/platform/billing`'s "Organizations requiring attention"
   list.
3. This app does **not** lock the organization out of its data on a single failed payment (Phase
   11's explicit rule) — `past_due`/`unpaid` are visible to staff for follow-up, not an
   automatic access cut. Building that policy is deliberately deferred; see the final report.

### 8. Test cancellation

1. From the Stripe test Customer's Subscription, **Cancel subscription** (immediately or at
   period end — try both once).
2. Canceling at period end: `customer.subscription.updated` arrives with
   `cancel_at_period_end: true`; GOLD's cache shows "canceling" until the period actually ends.
3. Immediate cancellation, or the scheduled cancellation taking effect: `customer.subscription.
   deleted` arrives, and GOLD deletes its `organization_platform_subscriptions` row for that
   organization/environment — the organization shows no subscription (a return to "not yet
   subscribed"), not a `canceled` status left lingering.

### 9. Inspect invoices

Stripe test mode → **Customers** → the test Customer → **Invoices** tab. GOLD does not currently
mirror invoice line items into its own database (Phase 12/Phase 20's "deferred" list) — Stripe's
own dashboard is authoritative for invoice detail in this slice.

### 10. Inspect webhook deliveries and retries

- Stripe test mode → **Workbench → Webhooks** → the platform-billing destination → its delivery
  log shows every attempt, response code, and retry.
- Inside GOLD: `/platform/billing` shows the most recent 20 events this deployment actually
  applied, read from `platform_billing_webhook_events` — useful for confirming GOLD *received and
  accepted* an event Stripe shows as delivered, without needing direct database access.

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
| API | `SUPABASE_URL` | Preview + Production | READY TO CONFIGURE | NO | NO | Supabase project URL | YES | Same project as Web unless staging is split. Also where `app/auth` derives the JWKS discovery URL for verifying human callers — no separate variable needed. |
| API | `SUPABASE_PUBLISHABLE_KEY` | Preview + Production | READY TO CONFIGURE | NO | NO | Supabase publishable key | YES | Current source name; `SUPABASE_ANON_KEY` remains a temporary fallback name only — do not configure both to different values. |
| API | `SUPABASE_JWT_SECRET` | Production | TEMPORARY LEGACY REQUIREMENT | YES | YES | Supabase Dashboard JWT settings | ONLY AFTER APPROVAL | Required ONLY by the payment/automation/voice machine-role flows (`app/core/db.py`, `app/core/runner.py`). Not read anywhere on the human-auth path (`app/auth`), which verifies people's tokens through the project's JWKS instead. |
| API | `SUPABASE_JWT_SECRET` | Preview | DO NOT CONFIGURE YET | YES | YES if configured | Supabase Dashboard JWT settings | NO | Do not give Preview machine write powers against shared production data casually. |
| API | `STRIPE_WEBHOOK_SECRET` | Preview | READY TO CONFIGURE - TEST/NON-PRODUCTION ONLY | YES | YES | Stripe test webhook endpoint, `whsec_...` | YES, after endpoint exists | Separate from API key; webhook still will not process until the `SUPABASE_JWT_SECRET` decision is made. |
| API | `STRIPE_WEBHOOK_SECRET` | Production | READY TO CONFIGURE | YES | YES | Stripe live webhook endpoint, `whsec_...` | YES, when going live | Separate endpoint/secret from Preview. |
| API | `STRIPE_PLATFORM_BILLING_WEBHOOK_SECRET` | Preview | READY TO CONFIGURE - TEST/NON-PRODUCTION ONLY | YES | YES | Stripe test webhook destination scoped to **Your account** (not Connected accounts), `whsec_...` | YES, after the destination exists | GOLD's own subscription billing — see "GOLD platform billing setup" above. Never the same value as `STRIPE_WEBHOOK_SECRET`; still gated behind the `SUPABASE_JWT_SECRET` decision, same as that row. |
| API | `STRIPE_PLATFORM_BILLING_WEBHOOK_SECRET` | Production | READY TO CONFIGURE | YES | YES | Stripe live webhook destination scoped to **Your account**, `whsec_...` | YES, when going live | Separate endpoint/secret from Preview, and from `STRIPE_WEBHOOK_SECRET`. |
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
