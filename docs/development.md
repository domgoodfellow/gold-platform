# GildOps Development

## Purpose

This document defines the **canonical local-development workflow for GildOps**.

It answers:

- What must be installed?
- How is the monorepo structured for local work?
- How do the web app, Python API and Supabase stack run locally?
- Which environment files are used?
- How is demo data prepared?
- Which commands are safe for local development?
- How should schema/type changes be handled?
- What should never be done from a development workstation?

Deployment belongs in `docs/deployment.md`.

Testing strategy belongs in `docs/testing.md`.

Production operations belong in `docs/operations.md`.

Environment-variable names and classifications are defined in:

```text
apps/web/.env.example
apps/api/.env.example
```

Do not copy an exhaustive variable inventory into this document.

---

## Local architecture

The main local runtimes are:

```text
Next.js web
apps/web
http://localhost:3000

Python API development router
apps/api/dev.py
http://127.0.0.1:8787 by default

Supabase local stack
Postgres / Auth / Storage / Studio / API
started by Supabase CLI through Docker
```

The API development server dispatches the same Python handlers configured by `apps/api/vercel.json`.

It does not maintain a separate local route list.

---

## Required tools

Use repository-declared versions where available.

Current baseline:

```text
Node.js 22
pnpm 11.x
Python 3.12
Docker
Git
```

The repository declares its pnpm package manager in root `package.json`.

The Supabase CLI is installed through the repository dependency and should normally be invoked through:

```bash
pnpm exec supabase
```

rather than depending on an unrelated global CLI version.

---

## Clone and install

From the repository root:

```bash
pnpm install
```

For Python development/test dependencies:

```bash
python -m pip install -r apps/api/requirements-dev.txt
```

`requirements-dev.txt` includes the production requirements plus pytest.

Do not manually install untracked packages and then rely on them.

If the runtime requires a new dependency, declare it in the correct package/requirements file.

---

## Environment files

### Web

Copy:

```text
apps/web/.env.example
```

to:

```text
apps/web/.env.local
```

Use local/test values only.

---

### API

Copy:

```text
apps/api/.env.example
```

to:

```text
apps/api/.env
```

`apps/api/dev.py` reads this file.

Do not use `apps/api/.env.local` as the GildOps API environment file.

Vercel CLI may create files with its own local state; those are not the application environment contract.

---

## Local secret policy

Local development should use:

- local Supabase values;
- provider sandbox/test credentials;
- locally generated development-only secrets;
- optional provider configuration only for the feature being exercised.

Do not place Production credentials in local environment files.

Do not commit real credentials.

Do not put server secrets in `NEXT_PUBLIC_*`.

---

## Start Supabase

From the repository root:

```bash
pnpm db:start
```

This starts the Supabase local stack through Docker.

Useful local services include:

```text
API/Auth
Postgres
Studio
Storage
local email inbox
```

The exact ports are defined in `supabase/config.toml`.

Current common local endpoints include:

```text
Supabase API   http://127.0.0.1:54321
Postgres       localhost:54322
Studio         http://127.0.0.1:54323
Local mail     http://127.0.0.1:54324
```

Treat the config file as authority if these values change.

---

## Restart vs reset

These are different operations.

### Restart Supabase services

Use after changing `supabase/config.toml`:

```bash
pnpm exec supabase stop
pnpm db:start
```

A service restart causes the local Supabase runtime to re-read its configuration.

---

### Reset local database

Use after schema/seed work:

```bash
pnpm db:reset
```

This:

- destroys local database state;
- reapplies migrations;
- runs the configured seed.

It does **not** replace the need to restart Supabase after changing runtime configuration.

Never run a destructive reset command against Production.

---

## Generate database types

After schema changes:

```bash
pnpm db:types
```

This writes:

```text
apps/web/lib/db/database.types.ts
```

Generated database types are checked-in artifacts.

Do not hand-edit them.

The normal sequence is:

```text
write migration
↓
reset/apply local database
↓
regenerate types
↓
run tests/typecheck
```

---

## Run the web app

From the root:

```bash
pnpm --filter @gold/web dev
```

Default development URL:

```text
http://localhost:3000
```

The web app requires the variables in `apps/web/.env.local` relevant to the feature being used.

The basic local Supabase pair is:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Use the values returned by the local Supabase stack.

---

## Run the Python API

From the repository root:

```bash
python apps/api/dev.py
```

Default URL:

```text
http://127.0.0.1:8787
```

The development router reads `apps/api/vercel.json` and dispatches the deployed handler modules.

This keeps local and deployed paths aligned.

An endpoint with missing optional provider configuration may return unavailable/not-configured behavior rather than preventing the entire API development server from starting.

---

## Prepare demo data

The repository provides a repeatable demo flow.

With Supabase already running:

```bash
pnpm demo
```

To reset the local database first and then build the demo:

```bash
pnpm demo:fresh
```

Use the demo for:

- browser acceptance;
- UI inspection;
- product exploration;
- local smoke;
- reproducing integrated workflows.

Demo assumptions are not product architecture.

Do not hard-code feature behavior around demo IDs or records.

---

## Typical local startup

A normal full-stack session is:

Terminal 1:

```bash
pnpm db:start
```

Terminal 2:

```bash
pnpm --filter @gold/web dev
```

Terminal 3, when API-backed features are needed:

```bash
python apps/api/dev.py
```

Prepare/reset demo state as needed:

```bash
pnpm demo:fresh
```

If `demo:fresh` resets the database while the app is open, refresh/re-authenticate as appropriate.

---

## Local API URLs

When web features call the Python API locally, configure the relevant API base URL in the web environment according to `apps/web/.env.example`.

The repository currently distinguishes application concerns such as:

```text
ASSISTANT_API_URL
GOLD_API_URL
TELEPHONY_CALLBACK_URL
```

Do not merge environment variables merely because they currently point to the same local API deployment.

Separate variables can represent separately configurable capability boundaries.

---

## Optional providers

Not every provider must be configured to run the platform locally.

Optional provider-dependent capability should fail honestly as:

```text
not configured
unavailable
needs setup
```

rather than making the entire application fail to start.

Examples of optional development integrations may include:

- Stripe;
- Twilio;
- Resend;
- AI providers;
- geocoding;
- map rendering;
- external Connections.

Configure only the feature being exercised.

---

## Local Stripe/webhook testing

For webhook development, run the relevant provider CLI or sandbox forwarder to the local API route.

Example shape:

```bash
stripe listen --forward-to http://127.0.0.1:8787/webhooks/stripe
```

Use the temporary webhook signing secret only in the local API environment.

Do not use a Production webhook secret locally.

---

## Local Supabase email

The local Supabase stack includes an email-testing inbox.

Auth emails are captured locally rather than sent to real recipients.

Use the configured local mail UI to test:

- password recovery;
- verification codes;
- invitations where Supabase owns delivery;
- identity email behavior.

Application-level provider email may use its own provider/sandbox path and is separate.

---

## Google/Auth provider development

Supabase Auth provider credentials belong in Supabase provider configuration, not in browser-visible web environment variables.

For local external OAuth providers, follow `supabase/config.toml` and local secret substitution.

For hosted environments, provider setup belongs in Supabase hosted configuration.

Do not copy provider client secrets into the Next.js application merely because login begins there.

---

## Database commands

Useful commands:

```bash
pnpm db:start
pnpm db:reset
pnpm db:types
pnpm db:migrations
pnpm db:query:local
```

Remote/shared commands exist but are not ordinary local-development commands.

Especially:

```bash
pnpm db:push
pnpm db:query:remote
pnpm snippet:*:remote
```

touch linked shared infrastructure.

Do not execute them casually.

Deployment/shared-database procedures belong in `docs/deployment.md`.

---

## Supabase linking

`supabase link` connects the local repository to a hosted project for commands that target the linked environment.

Do not link casually to Production and then run commands by habit.

Before any linked database mutation, verify which project is selected.

Use:

```bash
pnpm db:migrations
```

and provider/dashboard context to confirm target state where appropriate.

---

## Testing during development

Start with the narrowest useful command.

Examples:

```bash
pnpm test:unit
pnpm test:component
pnpm test:architecture
pnpm test:contract
```

When database behavior matters:

```bash
pnpm test:local
```

Before completing meaningful shared work:

```bash
pnpm check
```

For browser/visual verification, follow `docs/testing.md`.

---

## Browser acceptance prerequisites

Typical local Playwright acceptance flow:

```bash
pnpm db:start
pnpm demo:fresh
pnpm --filter @gold/web dev
```

Install Chromium if needed:

```bash
pnpm --filter @gold/web exec playwright install chromium
```

Then:

```bash
pnpm test:e2e
```

The Playwright config intentionally does not start another web server automatically.

This avoids creating a second local server that conflicts with a developer's existing dev process.

---

## Visual testing prerequisites

Use the same running app/demo setup.

Then:

```bash
pnpm test:visual
```

Visual regression is a focused reference suite.

Manual rendered inspection is still required for meaningful new UI work.

---

## Local smoke

With the demo running:

```bash
pnpm test:smoke
```

Against localhost, the smoke suite can use the demo owner.

Deployment smoke uses explicit credentials and belongs in `docs/deployment.md`.

---

## Editing migrations

New database change:

1. add a forward migration;
2. never edit already-applied migration history merely for cleanup;
3. reset local database;
4. regenerate types;
5. run targeted database tests;
6. run broader checks according to blast radius.

Migration files should contain the schema/policy change itself, not long architectural essays better suited to documentation.

Necessary comments should explain non-obvious local constraints.

---

## Updating environment contracts

When code begins reading a new environment variable:

1. add it to the relevant `.env.example`;
2. state:
   - purpose;
   - local expectation;
   - whether secret;
   - whether browser-visible;
   - whether optional/required;
3. update deployment documentation only if the environment/deployment process changes.

Do not create separate `.env.preview.example` and `.env.production.example` inventories that must be manually synchronized.

Hosted environments use the same variable names with environment-specific values.

---

## Package/workspace changes

The pnpm workspace is explicitly listed in:

```text
pnpm-workspace.yaml
```

`apps/api` is Python and is not a pnpm package.

When adding a TypeScript package:

- it must have a real consumer;
- add it explicitly to the workspace;
- preserve dependency direction from `docs/architecture.md`.

Do not create generic packages ahead of actual reuse.

---

## Debugging

Debug from the owning boundary.

Examples:

```text
page does not render
→ route / application / browser logs

RLS refuses operation
→ actor + membership + capability + policy/function

API route 404
→ handler config or optional settings missing

provider operation fails
→ adapter / credential / provider response / reconciliation

migration fails
→ forward migration order / existing data / constraint
```

Do not compensate for backend failure with frontend special cases.

---

## Generated and temporary files

Do not commit local runtime artifacts unless intentionally part of the repository contract.

Examples generally not committed:

- `.env.local`;
- `apps/api/.env`;
- Playwright traces/results;
- local Vercel state;
- Supabase runtime state;
- temporary exported data;
- local provider credentials.

Generated database types are an intentional exception because they are checked-in application contract artifacts.

---

## Git safety

Development commands that mutate shared infrastructure are not equivalent to local commands.

Before running a command that changes:

- hosted database;
- provider account;
- production credential;
- live domain;
- subscription/billing;

confirm:

```text
target environment
operation
rollback/recovery path
```

Routine coding work should remain local until an explicit deployment step.

---

## New developer path

A fresh contributor should be able to reach a running local product through:

```text
clone
↓
install pnpm packages
↓
install Python dev requirements
↓
copy web/API env examples
↓
start Supabase
↓
fill local Supabase values
↓
run demo seed
↓
start web
↓
start API when needed
↓
run checks
```

If this flow requires undocumented tribal knowledge, this document is incomplete.

---

## Development anti-patterns

Do not:

- use Production credentials locally;
- commit `.env` files;
- hand-edit generated database types;
- rewrite applied migrations;
- run `db:push` as part of ordinary tests;
- require every optional provider just to boot the app;
- maintain a separate local API route list from `apps/api/vercel.json`;
- add a workspace package with no consumer;
- use local demo behavior as the domain specification;
- fix a server/data problem by adding route-specific UI hacks;
- depend on globally installed tools when the repository already pins them.

---

## Document boundaries

This document owns:

- workstation prerequisites;
- dependency installation;
- local environment files;
- local Supabase;
- web/API startup;
- demo setup;
- common local commands;
- local database/type workflow;
- development safety rules.

It does not own:

- hosted environment values;
- production deployment;
- CI strategy;
- test taxonomy;
- runtime incident response;
- provider architecture.

Those belong to the respective canonical documents.
