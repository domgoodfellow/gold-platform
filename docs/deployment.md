# GildOps Deployment

## Purpose

### Imported connector runtime configuration

The API deployment now installs the pnpm workspace package `@gold/integration-library` alongside Python requirements. The Vercel API project has Root Directory `apps/api`: upload the repository root (prefer a clean tracked release snapshot), not the API subdirectory; `api/library_runtime.mjs` is a Node function and Python functions exclude its node_modules. Run `pnpm --filter @gold/integration-library check` before deployment. Apply `20261022000069_open_source_integration_library.sql` after its existing predecessor migrations, then regenerate database types and deploy API and web.

The runtime requires `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_ANON_KEY`), `SUPABASE_JWT_SECRET`, `GILDOPS_LIBRARY_SECRET`, and `GILDOPS_LIBRARY_URL` pointing to the API project's HTTPS `/integrations/library-runtime`. Python and Node must share the signing secret. Set `CRON_SECRET` for scheduled resource synchronization. Existing integration commands also require `GOLD_OAUTH_STATE_SECRET` and `GOLD_OAUTH_REDIRECT_URI`; supported generic OAuth apps use `<CONNECTOR_KEY>_OAUTH_CLIENT_ID` and `<CONNECTOR_KEY>_OAUTH_CLIENT_SECRET`. Google/Microsoft retain their existing prefixes. The web requires server-only `GOLD_API_URL`.


#### Where to get the first connection credentials

In Vercel, open **Goodfellow Studio ? gold-api ? Settings ? Environment Variables**, choose **Production**, and keep these server-only. Redeploy after saving changes. Existing `SUPABASE_URL` and `SUPABASE_ANON_KEY` can remain in place.

| Variable | Where its value comes from |
| --- | --- |
| `SUPABASE_JWT_SECRET` | Linked Supabase project ? Project Settings ? JWT Keys ? existing legacy JWT secret. This backend currently signs narrowly scoped machine tokens with HS256. It is neither an API key nor a new random value. If the legacy secret has been revoked or cannot be retrieved, stop and migrate machine authentication; do not rotate project signing keys for this setup. |
| `GILDOPS_LIBRARY_SECRET` | Generate an independent 32-byte random secret; Python and Node use the same value in this API project. |
| `GOLD_OAUTH_STATE_SECRET` | Generate a separate 32-byte random secret for OAuth state. |
| `CRON_SECRET` | Generate a separate 32-byte random secret, preserving any existing value. |
| `GILDOPS_LIBRARY_URL` | `https://api-eta-three-81.vercel.app/integrations/library-runtime` |
| `GOLD_OAUTH_REDIRECT_URI` | `https://app.gildops.com/connect/oauth/callback` |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Google Cloud project ? Google Auth Platform ? Clients ? create **Web application**, with the exact redirect URI above. Configure consent and add your own account as a test user. Enable Calendar, Drive, Sheets, Gmail and People APIs. |
| `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET` | Microsoft Entra admin center ? App registrations ? register a web app with the same redirect URI. Use Application (client) ID and a client-secret **value**, not its secret ID. Enable delegated `User.Read`, `Calendars.Read`, `Files.ReadWrite`, `Mail.Read`, and offline access. |

In **gold-web**, set server-only `GOLD_API_URL` to `https://api-eta-three-81.vercel.app`. It does not receive the API signing secrets or vendor client secrets.

Google requests read-only Calendar, Drive, Sheets, Gmail and Contacts scopes. Microsoft Graph requires `Files.ReadWrite` even for reading Excel ranges; this deployment still rejects connector writes. Existing connections must reconnect to authorize the expanded read surface. Provider consent/verification requirements still apply to external users.

For the first API-key test, use Stripe Dashboard ? sandbox ? API keys ? create a restricted test key with **Customers: Read** (used by connection verification), plus read access for any Invoices, PaymentIntents, Payouts or Charges you plan to query. Enter the `rk_test_?` value in **GildOps ? App Library ? Stripe ? Verify and connect**. It belongs to the organization's Vault-backed connection, not `STRIPE_WEBHOOK_SECRET` or a web environment variable. No Activepieces account is needed.

Provider references: [Supabase signing keys](https://supabase.com/docs/guides/auth/signing-keys), [Google OAuth credentials](https://developers.google.com/workspace/guides/create-credentials), [Microsoft Excel range permissions](https://learn.microsoft.com/en-us/graph/api/range-get?view=graph-rest-1.0), [Stripe keys](https://docs.stripe.com/keys).

An App Library deployment without these inputs displays the installed catalogue with setup blockers. It must not claim operational connections or successful vendor verification. Do not create provider accounts or publish secrets in setup documentation. Custom authentication products remain blocked even when their packages are installed.

This document defines the **canonical deployment and release process for GildOps**.

It answers:

- What environments exist?
- What is deployed where?
- How do the web app, Python API and Supabase database move together?
- Where does environment configuration live?
- How are schema migrations applied?
- What must be verified before and after deployment?
- How are rollback and rollforward handled?
- Which deployment actions require explicit operator care?

Local setup belongs in `docs/development.md`.

Testing strategy belongs in `docs/testing.md`.

Runtime monitoring and incident response belong in `docs/operations.md`.

Security rules belong in `docs/security.md`.

---

## Deployment architecture

The deployed platform currently consists of three primary runtime layers:

```text
Vercel Web project
  apps/web
  Next.js

Vercel API project
  apps/api
  Python serverless handlers

Supabase project
  PostgreSQL
  Auth
  Storage
  Data API / RPC
```

The two Vercel projects deploy from the same repository.

They should be treated as one product release even though they are separate deployment targets.

The database is a separate stateful deployment concern and must be coordinated explicitly with application releases.

---

## Environment model

The canonical environment classes are:

```text
Local
Preview
Production
```

A dedicated staging environment may be added if operational need justifies it.

Do not use environment names interchangeably.

---

### Local

Purpose:

- development;
- schema work;
- deterministic test data;
- browser acceptance;
- integration tests.

Uses:

- local Supabase through Docker;
- local web dev server;
- local Python API router;
- sandbox/optional provider credentials.

Local is disposable.

---

### Preview

Purpose:

- review a proposed change before Production;
- validate deployed build/runtime behavior;
- exercise sandbox provider configuration where available.

Preview is not automatically data-isolated merely because Vercel produced a separate deployment.

A Preview environment is **fully isolated only when its stateful dependencies are isolated**.

If Preview points at the Production Supabase project, treat it as a Production-data-adjacent deployment:

- avoid destructive tests;
- avoid live provider credentials unless intentionally required;
- prefer sandbox or disabled providers;
- do not assume demo/reset operations are safe;
- do not expose preview URLs broadly.

The preferred mature architecture is a separate hosted Preview/Staging Supabase project.

---

### Production

Purpose:

> Serve real GildOps and customer traffic.

Production uses:

- Vercel Production deployment for web;
- Vercel Production deployment for API;
- live hosted Supabase project;
- live provider configuration intentionally enabled for Production.

Production changes require:

- verified code;
- compatible schema;
- correct environment configuration;
- post-deployment verification;
- recovery plan appropriate to risk.

---

## Vercel projects

The repository is deployed through two Vercel projects.

| Project | Repository root directory | Runtime |
| --- | --- | --- |
| `web` | `apps/web` | Next.js |
| `api` | `apps/api` | Python serverless functions |

The exact Vercel project/account IDs are deployment metadata and do not belong in this canonical document.

Do not make architecture depend on one current Vercel project ID.

---

## Web deployment

`apps/web` is deployed as the Next.js application.

Vercel detects/builds the Next.js project from the configured project root.

The production build contract is represented by:

```bash
pnpm --filter @gold/web build
```

A deployment must not depend on local uncommitted environment files.

All hosted configuration comes from environment settings or hosted provider configuration.

---

## API deployment

`apps/api` deploys Python serverless handlers.

Public/canonical route rewrites are defined in:

```text
apps/api/vercel.json
```

The local development router reads this same file.

Do not maintain separate production and local route registries.

Current API route classes include concerns such as:

- AI;
- automations;
- voice;
- messaging;
- CRM commands;
- integration operations;
- provider operations;
- organization domains;
- tenant email;
- payment/billing webhooks.

Routes may be unavailable when their required optional configuration is not present.

That is preferable to giving an unconfigured feature hidden broad credentials.

### Invoice document writer

`/invoice-documents` (`api/invoice_documents.mjs`, Node) is the only writer of an issued invoice's PDF and of a retained logo. The web app sends it the person's own token; it asks the database who they are and whether they may issue the business's invoices, then signs a 60-second `invoice_document_writer` token and draws, stores and records. It needs `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_ANON_KEY`) and the existing `SUPABASE_JWT_SECRET` in the API project only; without them it answers 503 and issuing is unaffected. The web project needs only `GOLD_API_URL`. Never give the web project the signing secret or a service-role key. `invoice_documents/document.generated.mjs` is bundled from the web app's composition; `pnpm --filter @gold/integration-library check` fails if it is stale.

Rollout, in this order:

1. If `20261102000001` and `20261102000002` are not yet applied (the 2G web release was never deployed), apply `20261102000001` to `20261102000004` together, deploy the API, then the web app, and skip to step 6.
2. Apply `20261102000003`. It is additive: the writer role, its functions, recorded retained logos and an organization-led path key. It also removes members' logo storage, so a 2G web instance's logo retention now fails quietly and its invoices show the business name. 2G instances keep creating PDFs through the member path until step 5.
3. Deploy the API. Check that `POST /invoice-documents` with no token answers 401 and with a sandbox member's token creates a PDF whose stored object's `owner_id` is `00000000-0000-4000-8000-0000000000c1`.
4. Deploy the web app, then retire every 2G web deployment that can still receive traffic: production, aliases and instant-rollback targets. Confirm that `pg_stat_user_functions.calls` for `record_invoice_document(uuid, text, text, bigint, text)` stops rising.
5. Apply `20261102000004`. It removes members' PDF storage and the member recording function.
6. Verify: no `insert` policy on `storage.objects` for `finance-documents` names `authenticated`; only `invoice_document_writer` may execute `record_invoice_document`, `record_retained_logo`, `invoice_document_source` and `invoice_logo_source`; a member upload into `finance-documents` is refused. List any document recorded before the writer existed for review: `select d.* from invoice_documents d join storage.objects o on o.bucket_id = 'finance-documents' and o.name = d.storage_path where o.owner_id is distinct from '00000000-0000-4000-8000-0000000000c1'`.

Invoice email (`20261102000005`) follows the writer rollout above and needs no new configuration. It uses the tenant-email runtime (`/communications/email/send`) and the business's own verified sender:

1. Apply `20261102000005`. It is additive: attachment bucket and checksum columns defaulting to today's behaviour, `invoice_emails`, `invoice_email_preview` and `queue_invoice_email`. Nothing can create an invoice email until the web release.
2. Deploy the API. Its sender reads each attachment's bucket and checksum, so it needs the new columns; deploy it only after step 1.
3. Deploy the web app.
4. Verify with a sandbox business whose sender is verified, sending to a tester-controlled mailbox only. Check that the message carries `invoice-<number>.pdf`, that `invoice_emails` names the business sender and the customer address, and that the inspector shows Accepted until a delivery event arrives.

Rollback: rolling back the web app removes Send invoice. Do not roll the API back past step 2 while invoice emails are queued: an older sender reads the PDF from the wrong bucket and records the send as failed, so nothing wrong is sent but those emails fail. Do not remove `20261102000005` once step 2 is live.

Rollback never restores member writes. Before step 5, a web or API rollback returns to the 2G behaviour, which is still vulnerable. After step 5, rolling back the web or API only stops PDF creation, which fails closed: invoices are still issued, and Create PDF can be used once the writer is back. Do not recreate the dropped policies or function. To stop the writer, revoke `execute` on its four functions from `invoice_document_writer`. Fix forward.

---

## Scheduled execution

The current serverless scheduler is Vercel Cron.

`apps/api/vercel.json` is the executable authority for all schedules and logical rewrites.
It schedules customer notifications every minute, integration synchronization every 15 minutes,
and automation ticks every 15 minutes. The notification rewrite reaches
`api/customer_notification_tick.py` by GET and requires `Authorization: Bearer <CRON_SECRET>`.
The physical handler path requires the same authorization. Missing runtime configuration or
secret returns 404, invalid authorization returns 401, and worker failure returns 503.
The handler claims at most five jobs; the Python function limit is 300 seconds.

Vercel Cron invokes production deployments, not previews, and does not follow redirects.
The minute schedule requires a plan supporting that interval; Hobby permits daily schedules only.
Confirm the selected team's actual plan and endpoint accessibility before activating a sandbox.
See [Vercel Cron](https://vercel.com/docs/cron-jobs) and
[usage limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

Scheduled work must remain:

- idempotent;
- bounded;
- safe to retry;
- protected by the intended scheduler authentication mechanism.

Do not turn a serverless function into an assumed long-lived daemon.

If future workloads require durable queues/workers, introduce them as an explicit architecture change.

### Customer notification sandbox and release gate

Batch F is inspection and acceptance preparation. Deployment, hosted migration, provider/DNS
changes, real test emails and scheduled activation each require explicit authorization for the
named environment and resources. Existing credentials and a Git push do not supply that approval.
Never select a different customer's project/account because the intended one is inaccessible.

Use a dedicated sandbox database containing only synthetic test data, a dedicated tenant and a
separately approved Resend account/domain and tester-controlled mailbox. Keep notification claim
and pre-send authorization disabled until that tenant is ready. A preview connected to a production
database is not isolation. Resend testing addresses can exercise provider events separately; they
cannot receive the mailbox code needed for the actual consent journey.

| Contract | Required location and verification |
| --- | --- |
| Database | Web `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; API `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` (legacy `SUPABASE_ANON_KEY` accepted). Confirm both target the selected sandbox. |
| Machine authentication | API `SUPABASE_JWT_SECRET`: existing accepted legacy HS256 signing secret, never a service-role key. Verify a narrow machine RPC; presence alone does not prove acceptance. No signing-key rotation for testing. |
| Scheduler | API `CRON_SECRET`, shared with existing cron handlers. Do not remove or rotate it to disable just notifications. |
| Tenant sender | Canonical active, sendable EmailIdentity backed by an active Resend domain resource, its Organization Provider Binding and correct Provider Account. Verify account lifecycle, credential and actual domain readiness separately from the identity's local readiness predicate. |
| Provider credential | Vault-backed credential on that Provider Account; resolved server-side. `RESEND_API_KEY` and platform invitation sender variables are not a notification fallback. |
| Callback | API `TENANT_EMAIL_WEBHOOK_SECRET` for the selected account's tenant-email destination; separate from invitation `RESEND_WEBHOOK_SECRET`. |
| Web-to-API | Web server-only `GOLD_API_URL` targets the intended API origin. The notification cron itself runs directly in the API project. |
| Portal destination | Verified/SSL-issued Portal domain or canonical managed hostname from `platform_settings`, resolved for the organization. Template links carry no bearer token. Existing Portal invitation/session remains necessary. |

Record variable names, environment and presence/validity only. Enter secrets through protected
deployment/provider systems; never paste them into reports, logs, commits or browser traces.

### Compatibility and approved rollout sequence

1. Pin the reviewed source commit and exact team, Web/API projects, database, Resend account/domain
   and allowed recipients. Confirm backup/recovery, plan support and explicit authorization. Disable
   notification cron in the selected project's Cron settings before any API release if it exists.
2. Compare hosted migration history with repository order. Apply reviewed predecessors first:
   `20261022000076_customer_service_disclosures.sql`,
   `20261022000077_customer_service_reviews.sql`, then
   `20261022000078_customer_delivery_notifications.sql`. Earlier email/Portal/provider migrations
   must already exist. Review the exact pending migration set; never broad-push unrelated migrations.
3. Before deploying the worker, use the notification-only hold described in `docs/operations.md`.
   Verify grants, RLS, signatures and generated types. Test the previous Web/API versions against
   the migrated database. Schema-first adds tables/functions and wraps the old compose-email claim;
   existing non-notification mail should continue, but compatibility is a required check.
4. Deploy API, then Web, with the hold retained. Verify exact deployment source hashes, configuration,
   logical and physical routes, authorization and the existing signed webhook. A production API
   deployment can register cron immediately; a skipped domain assignment is not a sending control.
5. Through canonical operator/Portal operations create one Customer, Engagement, approved Disclosure
   and Review. Configure the tenant sender. Authorize bounded worker activation only for this isolated
   environment, deliver the ordinary confirmation email, enter its code in the originating Portal
   session and explicitly select purposes. No SQL consent shortcut in provider acceptance.
6. Release exactly one notified review, record the stable identifiers, and observe provider acceptance
   separately from signed delivery and CRM status. Count the confirmation email separately from the
   review notice. A genuine scheduled invocation must be observed in scheduler/runtime logs; a manual
   GET proves routing only. Then exercise one bounded transient retry, duplicate callback, invalid
   signature and consent withdrawal with the approved recipient and traffic budget.
7. Observe queue/attempt/event diagnostics and other-tenant counts. Disable the sandbox worker after
   the test unless continued operation was explicitly authorized. Normal production activation is
   a separate decision requiring successful provider acceptance and resolution of review blockers.

An older application rollback preserves notification data but may stop exposing controls; it does
not cancel queued work. Hold the worker first. Use forward corrective migrations for database
recovery, preserve review/disclosure/consent/evidence rows, and never replay uncertain provider calls
with a new message ID or beyond the original idempotency window.

### Batch F inventory snapshot (2026-10-15)

Reviewed Batch E source: `bbf4f1c5585a8c9667187e3c847bdd06e868302a` (34 files), now committed.
The follow-up inspection used `b7bee2c7730b39d1a2268681747af1266f107610`; repository history and
hosted state have advanced beyond the original work-order baseline. Local links name
`goodfellow-studio/gold-web` and `gold-api`; they do not establish current ownership or sandbox
suitability. The connector denied scoped project access (403) and returned no accessible teams;
the explicitly scoped CLI fallback reported both project names unavailable. Do not relink or
substitute unrelated projects. Billing/team scope, deployed revisions, plan and hosted environment
values remain unverified. Reconcile access with the intended owner before any release.

Refreshed read-only Supabase inventory found active `Gold Platform` (`nuceqypuwrjavrwiloda`), latest
migration `20261022000082`, the Batch E claim RPC, zero email identities, zero Resend Provider
Accounts, zero notification intents and zero notification jobs. The notification machine role has
no table access or private `app` schema usage. This corrects the earlier pre-Batch-E inventory;
migration presence does not establish application deployment or provider readiness.
This is an existing hosted environment, not an approved sandbox. No dedicated hosted
sandbox, Resend domain/account or controlled recipient has been designated. Hosted configuration
and provider acceptance therefore remain blocked; no deployment/migration/provider change or
email was performed by Batch F. See `docs/operations.md` for code-review blockers and recovery.

---

## Supabase environments

Supabase provides the stateful application backend.

Each truly isolated hosted environment should use its own Supabase project.

The repository's schema source is:

```text
supabase/migrations/
```

The hosted database must match the applied migration history expected by the deployed application.

---

## Local vs hosted Supabase configuration

`supabase/config.toml` configures the local Supabase stack.

It does **not** automatically configure equivalent hosted settings.

Hosted settings that may require explicit dashboard/provider configuration include:

- authentication providers;
- redirect URLs;
- email/security options;
- signing/auth settings;
- external SMTP;
- provider secrets;
- other hosted-only controls.

A deployment that changes such configuration is incomplete until both:

```text
repository configuration
+
hosted environment configuration
```

match the intended behavior.

### Hosted Supabase Account-security requirements

The hosted Supabase project must be configured to match the Account security contract in `docs/security.md`.

For the current identity flows, verify in the hosted Auth configuration:

- minimum password length is 15;
- long passphrases remain accepted;
- secure password change / reauthentication enforcement is enabled where supported;
- current-password proof is required for signed-in password change;
- secure email change / double confirmation is enabled;
- password-changed and email-changed security notifications are enabled;
- leaked-password protection is enabled where the hosted plan supports it;
- the deployed `/auth/email-change` callback is in the Auth redirect allowlist.

The application also verifies the current password through an isolated public-key client so local stacks or Auth versions that do not expose the same hosted toggle cannot silently skip the proof.

The identity-verification email template used by the application lives at:

```text
supabase/templates/identity-verification.html
```

The template must include the Supabase verification token required by the fresh email-proof flow.

Editing `supabase/config.toml` configures the local stack only.

It does not change the hosted Supabase project's Auth settings.

Do not invent unsupported TOML keys to simulate a dashboard-only setting.

---

## Environment-variable contract

The canonical variable names and classifications are:

```text
apps/web/.env.example
apps/api/.env.example
```

Those files own:

- variable name;
- purpose;
- secret vs non-secret;
- browser visibility;
- local example where safe;
- optional/required feature relationship.

This document does not duplicate the full inventory.

---

## Vercel environment variables

Hosted variables are configured separately for:

```text
Preview
Production
```

in the correct Vercel project.

Do not upload local `.env` files as the deployment mechanism.

Do not assume the same value should be used across Preview and Production.

Common rules:

- sandbox/test provider credentials in Preview;
- live credentials only in Production;
- separate webhook signing secrets per endpoint/environment;
- server secrets marked sensitive where supported;
- browser-visible values limited to explicitly public variables;
- no Production secret committed to source.

---

## Web vs API configuration

The same provider may require variables in both projects for different responsibilities.

That does not mean the variables should automatically be merged.

Example:

```text
web
→ begins a user action / server action / token creation

api
→ receives provider callback / performs trusted provider operation
```

The separation may be intentional.

Configuration ownership follows the runtime that reads the value.

---

## Supabase keys

Use the least-privileged key appropriate to each runtime.

Ordinary user-facing access should continue under:

- publishable/public API key;
- authenticated user JWT;
- RLS.

Do not introduce a broad service-role key into ordinary web/application runtime as a shortcut.

---

### Legacy machine-auth dependency

The current API still contains a legacy machine-auth path that can depend on `SUPABASE_JWT_SECRET` for narrowly scoped machine roles.

This is a high-impact credential.

Treat it as a temporary compatibility dependency, not as the preferred general server credential model.

Do not substitute a broader Supabase secret/service key to “simplify” migration.

Migration away from the legacy mechanism requires a deliberate security architecture change and regression coverage for every affected machine role.

Current implementation status belongs in `docs/roadmap.md`.

---

## Provider configuration

Provider configuration must match the environment.

Examples include:

- Stripe;
- Twilio;
- Resend;
- AI/model providers;
- OAuth app registrations;
- domain/DNS providers;
- web delivery providers.

For each provider/environment, define:

```text
credential/account
callback URL
webhook/signature secret
sandbox/live mode
resource ownership
verification procedure
```

Do not copy a Production provider callback secret into Preview.

---

## OAuth redirect configuration

OAuth integrations require exact/approved redirect URLs.

When deploying a new environment or hostname:

1. determine the public callback URL;
2. register it with the provider;
3. configure the environment's client credentials;
4. verify state/return handling;
5. complete an end-to-end sandbox flow.

Preview hostnames that change for every commit may be unsuitable for provider registrations.

Use stable aliases where the provider requires fixed redirects.

---

## Webhook deployment

Every provider webhook deployment must verify:

- public endpoint URL;
- environment;
- subscribed event set;
- signing secret;
- account scope;
- handler route;
- retry/idempotency behavior.

Do not reuse one webhook signing secret across logically distinct money/security planes merely because the provider is the same.

Example:

```text
tenant payment webhook
≠
GildOps platform billing webhook
```

---

## Database deployment

Database changes are deliberate shared-state mutations.

Never deploy them implicitly as a side effect of ordinary application build.

---

### Inspect migration state

Useful commands:

```bash
pnpm db:migrations
```

against the intended linked project.

Before applying migrations, confirm the linked Supabase project.

---

### Dry run

Use:

```bash
pnpm db:push:dry
```

before applying remote migration changes when supported by the current CLI/workflow.

Review the proposed migration set.

---

### Apply

Use:

```bash
pnpm db:push
```

only when:

- target project is confirmed;
- migration was tested locally;
- application compatibility is understood;
- rollback/rollforward strategy is clear.

This command mutates the linked hosted database.

It is not part of the ordinary test gate.

When approval covers one migration and the ordinary dry run includes unrelated
pending files, do not push that full set. Prepare a temporary workspace containing
the current config and required templates, copies of migrations already recorded
on the target, and only the approved pending file. Preserve the repository's
unrelated migrations. Use an explicit `--project-ref`, run `db push --dry-run`
with `--skip-vault`, and apply only after it lists exactly the approved file with
no seeds or role changes. Retain prior function definitions outside Git when
replacing functions. Verify the target migration's statement count, actual
objects, grants and authenticated behavior afterwards; an isolated clean dry run
does not mean unrelated repository migrations have been applied.

---

### Recover a recorded migration whose schema is absent

Migration history alone does not prove that the schema was installed. If application queries fail on missing objects while `db:push:dry` reports no pending migrations, compare the existing migration SQL with the linked database's tables, columns, functions, constraints and policies.

For a confirmed falsely recorded migration:

1. Confirm the linked project and back up schema, data, roles and `supabase_migrations` history outside Git. Retain the backups securely; a successful export is not a restore test.
2. Verify that the migration's new objects are absent, its dependencies exist, and existing rows satisfy its new constraints. If changes are partially present, stop and inspect before replaying non-idempotent SQL.
3. Run the relevant local database integration tests.
4. Mark only the affected version pending with `pnpm exec supabase migration repair <version> --status reverted --linked`. This removes its history record; it does not undo schema changes.
5. Run `pnpm db:push:dry` and inspect the exact pending set. If an out-of-order version requires `--include-all`, repeat the dry run with that flag first. Stop if unrelated migrations are selected.
6. Apply only the reviewed set, then confirm the expected objects, execute the application read functions under caller authorization, check preserved records and repeat the dry run.

Keep the original migration file unchanged. Do not reset the hosted database, delete existing tables or create duplicate table migrations to repair a false history entry. This recovery is an explicit operational correction, not permission to rewrite valid applied history.

Supabase documents the history-only behavior of [`migration repair`](https://supabase.com/docs/reference/cli/supabase-migration-repair) and logical exports in [Database Backups](https://supabase.com/docs/guides/platform/backups).

---

## Schema/application compatibility

Database and application deployments are not atomic with each other.

Design migrations so old and new application versions can coexist during deployment whenever practical.

Prefer:

```text
expand
↓
deploy compatible readers/writers
↓
backfill/migrate
↓
switch behavior
↓
verify
↓
contract later
```

Avoid:

```text
drop/rename required column
↓
hope every serverless instance instantly updates
```

---

## Migration ordering

### Additive change

Typical order:

```text
1. deploy/apply additive migration
2. verify schema
3. deploy code that uses it
4. smoke/observe
```

The previous application should continue working against the expanded schema.

---

### Behavior/data transition

Typical order:

```text
1. expand schema
2. deploy dual-compatible code
3. backfill/migrate data
4. verify
5. switch reads/writes
6. remove old shape in a later release
```

---

### Destructive change

Do not combine a destructive schema contraction with the first application change that stops using it unless compatibility is provably safe.

Destructive changes require a specific migration/recovery plan.

---

## Database rollback

A source-code rollback does not roll back database state.

Never assume:

```text
Vercel rollback
=
database rollback
```

Applied migrations are forward history.

Prefer a corrective forward migration or compatible application rollback.

Before deploying a schema change, ensure a prior application version can still run if application rollback is part of the recovery plan.

---

## Generated types during release

Database type generation happens during development after schema change:

```bash
pnpm db:types
```

The generated file is committed with the code expecting that schema.

Do not generate types from Production as an ad hoc release step and then leave source unchanged.

---

## CI before deployment

Ordinary pull requests/pushes are verified through:

```text
fast CI
+
local real-Supabase CI
```

See `docs/testing.md`.

A deployment should not bypass the normal verification gate for convenience.

For high-risk releases, run additional:

- E2E;
- visual inspection;
- provider sandbox;
- migration rehearsal;
- security tests;

according to the change.

---

## Preview deployment verification

Before Production promotion, verify the relevant Preview behavior when Preview can safely exercise it.

Check:

- deployment built successfully;
- expected routes answer;
- environment config is present;
- auth redirect works;
- schema compatibility;
- browser workflow;
- provider sandbox flow where relevant;
- console/runtime errors;
- responsive UI where relevant.

Do not use Preview to perform destructive Production-data experiments when its backend is not isolated.

---

## Production release process

For a normal release:

```text
1. merge verified code
2. confirm required database migration state
3. confirm Production environment/provider configuration
4. deploy/promote web and API coherently
5. verify deployment health
6. run Production smoke
7. verify changed critical journeys
8. observe logs/provider failures
9. declare release available
```

The exact sequencing of database vs application depends on migration compatibility.

---

## Deployment vs release

A **deployment** moves code/configuration.

A **release** makes behavior available to intended users.

They may happen at the same time today, but they are different concepts.

If feature flags or entitlement activation are used, code may be deployed before a capability is released.

Do not describe “deployed” as “available to every customer” unless that is actually true.

---

## Production smoke

Deployment smoke is non-destructive and runs against a real deployment.

Use:

```text
SMOKE_BASE_URL
SMOKE_EMAIL
SMOKE_PASSWORD
```

Then:

```bash
pnpm test:smoke
```

Current smoke verifies:

- login route answers;
- login UI renders;
- authentication succeeds;
- authenticated shell loads.

Smoke does not prove every provider/workspace.

---

## Post-deployment verification

For changed critical behavior, perform targeted verification beyond generic smoke.

Examples:

### Auth release

Verify:

- sign in;
- Account security route;
- changed proof/recovery flow.

### Database/RLS release

Verify:

- expected operation succeeds;
- known unauthorized operation still fails;
- key collection/detail reads work.

### Payment/billing release

Verify sandbox/test before Production where possible, then safely inspect real webhook/processing state.

### Communications release

Verify number/resource readiness and a controlled provider operation where safe.

### UI shell release

Verify desktop and phone navigation on deployed environment.

---

## Rollback

Rollback is appropriate when:

- application code is broken;
- the previous application version is database-compatible;
- reverting reduces impact faster than rollforward.

For Vercel application code, use the platform's deployment rollback/promotion mechanism.

Do not use Git history rewrite as a production rollback mechanism.

---

## Rollforward

Rollforward is often safer when:

- schema/data migration already occurred;
- provider state changed;
- prior version is no longer compatible;
- the fix is narrow and understood.

A corrective migration or patch may be the correct recovery.

---

## Configuration rollback

Environment/provider configuration changes need their own rollback plan.

Examples:

- restore previous API credential;
- restore callback URL;
- disable optional provider capability;
- revert runtime assignment;
- restore previous DNS record.

Record manual emergency changes and reconcile them back into documented/source-controlled configuration.

---

## Domain and hostname deployment

Public domain/hostname changes may involve:

- DNS;
- deployment provider domain registration;
- verification;
- certificate provisioning;
- GildOps hostname/domain records.

The Organization-facing domain remains a GildOps domain concept.

Provider-specific delivery is infrastructure.

Verify:

```text
DNS
↓
provider registration
↓
TLS
↓
hostname resolution
↓
correct Organization/site
```

Do not mark a domain ready merely because the database row exists.

---

## Release evidence

For a material Production deployment, capture enough evidence to answer:

```text
what was deployed?
which commit/release?
which migrations were applied?
which configuration changed?
what was verified?
what remained unverified?
was any manual intervention required?
```

This does not require a giant release document.

The changelog records user/material changes.

Git/Vercel/Supabase/provider logs record detailed execution history.

---

## Deployment access

Production deployment/configuration access should be limited to people who require it.

Sensitive actions include:

- Vercel Production env changes;
- Supabase linked migration push;
- auth provider changes;
- Production provider credentials;
- live webhook configuration;
- DNS/domain changes;
- Platform billing configuration.

Use least privilege and provider audit trails where available.

---

## Deployment anti-patterns

Do not:

- treat Preview as isolated when it shares Production state;
- store Production secrets in local files;
- commit environment values;
- run `db:push` automatically in the ordinary test gate;
- deploy destructive migrations without compatibility analysis;
- assume app rollback reverses data migrations;
- use the Supabase service role as the default backend credential;
- configure provider callbacks without verifying environment/account scope;
- reuse webhook secrets across distinct security planes;
- deploy one runtime with an incompatible API/database contract and “fix the other later”;
- declare success because Vercel says the build completed;
- skip post-deployment smoke for meaningful Production changes.

---

## Deployment checklist

Before Production:

- [ ] CI green for required tiers
- [ ] migration tested locally
- [ ] database compatibility reviewed
- [ ] target Supabase project confirmed
- [ ] environment variables configured
- [ ] hosted Auth/provider settings configured
- [ ] provider sandbox verification completed where relevant
- [ ] web/API contract compatible
- [ ] rollback or rollforward path identified

After Production:

- [ ] web deployment healthy
- [ ] API deployment healthy
- [ ] schema/migration state correct
- [ ] smoke passes
- [ ] changed critical journey verified
- [ ] provider/webhook errors checked
- [ ] no unexpected authorization/data errors
- [ ] manual changes recorded

---

## Document boundaries

This document owns:

- hosted environment model;
- Vercel web/API deployment;
- hosted Supabase deployment;
- environment configuration policy;
- migration release sequencing;
- deployment verification;
- rollback/rollforward;
- Production release procedure.

It does not own:

- local workstation setup;
- test taxonomy;
- domain architecture;
- operational monitoring/incident response;
- actual secret values.

Those belong to the respective canonical documents.

## Inbound voice adapter configuration

Inbound execution requires the matching `TWILIO_ACCOUNT_SID`, existing `TWILIO_AUTH_TOKEN` and Supabase machine settings. The number must reach `/voice/inbound` and deliver root terminal events to `/voice/status`; without terminal carrier callbacks, call state/duration are not established. Browser receiving requires the existing browser-token/TwiML application configuration. The external voice adapter additionally needs `VOICE_AGENT_BASE_URL` (HTTPS), optional `VOICE_AGENT_STREAM_ORIGIN` (WSS), and `TELEPHONY_CALLBACK_URL` as the API origin for carrier transfer callbacks. Its credential is stored on the Platform provider account, never in business configuration. Configure runtime assignment, business deployment/budget and route explicitly. These migrations were applied locally; hosted migration/deployment, number callback changes and provider sandbox/live calls require separately scoped release authorization.
