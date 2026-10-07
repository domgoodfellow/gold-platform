# GildOps Deployment

## Purpose

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

---

## Scheduled execution

The current serverless scheduler is Vercel Cron.

`apps/api/vercel.json` currently schedules:

```text
/tasks/automation-tick
```

every 15 minutes.

Scheduled work must remain:

- idempotent;
- bounded;
- safe to retry;
- protected by the intended scheduler authentication mechanism.

Do not turn a serverless function into an assumed long-lived daemon.

If future workloads require durable queues/workers, introduce them as an explicit architecture change.

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
