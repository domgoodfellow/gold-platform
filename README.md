# GildOps

**GildOps is an operating platform for service businesses.**

It gives one organization a coherent system to manage customer relationships, communication, work, scheduling, finance, automation, AI and customer-facing experiences without turning each concern into a separate application or separate source of truth.

The core product principle is:

> **One business model, many operating surfaces.**

---

## Product structure

Canonical operator workspaces:

```text
CRM
Communications
Marketing
Support
Finance
AI
Automations
Field
Studio
```

Not every important surface is a workspace.

Shared organization surfaces include:

```text
Home
Library
Settings
Insights / reporting
```

Platform Administration is the separate GildOps SaaS control plane and is never a customer workspace.

See:

- [`docs/product.md`](docs/product.md)
- [`docs/domain-model.md`](docs/domain-model.md)

---

## Repository status

GildOps is an active platform under consolidation.

Substantial capability already exists across:

- multi-tenant identity and authorization;
- CRM/customer relationships;
- work, scheduling and resources;
- Communications across voice, messaging and email;
- tenant Finance;
- Platform commercial/catalogue foundations;
- provider infrastructure and Connections;
- Automations;
- AI runtime and usage;
- Studio websites/forms;
- booking, portal and proposal flows;
- usage and provider-cost accounting.

The current engineering priority is **coherence and operational completeness**, not maximizing route count.

See [`docs/roadmap.md`](docs/roadmap.md) for current sequencing.

---

## Architecture at a glance

GildOps is a pnpm monorepo with two deployed application runtimes and a Supabase backend.

```text
apps/
  web/        Next.js / React
  api/        Python serverless API

packages/
  config/
  schemas/
  types/
  ui/

supabase/
  migrations/
  snippets/

infrastructure/

docs/

scripts/
```

Primary runtime flow:

```text
Browser
↓
Next.js
↓
Application / Domain
↓
PostgreSQL / Provider Adapter
```

Provider ingress and machine operations also use:

```text
External Provider / Scheduler
↓
apps/api
↓
Verified narrow operation
↓
Canonical domain/database state
```

See [`docs/architecture.md`](docs/architecture.md).

---

## Technology

Current major technologies include:

### Web

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- shadcn/Radix-based primitives
- Vitest
- Playwright

### API

- Python 3.12
- Vercel Python serverless functions
- pytest
- httpx
- supported AI provider SDKs where typed protocol complexity justifies them

### Data / identity

- PostgreSQL
- Supabase
- Row Level Security
- Supabase Auth
- Supabase Storage

### Deployment

- Vercel
- Supabase hosted projects
- provider-specific external infrastructure

The exact dependency versions live in package and requirements files, not this README.

---

## Canonical documentation

The documentation system is deliberately small.

| Document | Owns |
| --- | --- |
| [`docs/product.md`](docs/product.md) | Product identity, outcomes, workspaces and product boundaries |
| [`docs/domain-model.md`](docs/domain-model.md) | Canonical business concepts, ownership and invariants |
| [`docs/architecture.md`](docs/architecture.md) | Runtime, repository and dependency architecture |
| [`docs/ui-system.md`](docs/ui-system.md) | System-wide UI grammar, navigation, archetypes, responsive behavior |
| [`docs/surfaces/`](docs/surfaces/) | Workspace and feature surface specifications |
| [`docs/security.md`](docs/security.md) | Identity, authorization, tenant isolation and trust boundaries |
| [`docs/data.md`](docs/data.md) | Persistence, schema conventions, history and migrations |
| [`docs/integrations.md`](docs/integrations.md) | Providers, Connectors, Connections, webhooks, imports and adapters |
| [`docs/public-web.md`](docs/public-web.md) | Public websites, domains, external sessions, SEO, attribution and legal publishing |
| [`docs/testing.md`](docs/testing.md) | Test taxonomy, tiers and verification |
| [`docs/development.md`](docs/development.md) | Local setup and development workflow |
| [`docs/deployment.md`](docs/deployment.md) | Hosted environments, releases, migrations and rollback |
| [`docs/operations.md`](docs/operations.md) | Runtime health, observability, incidents and reliability |
| [`docs/roadmap.md`](docs/roadmap.md) | Current sequencing and outcome gates |
| [`docs/decisions/README.md`](docs/decisions/README.md) | ADR format, lifecycle and decision index |
| [`CHANGELOG.md`](CHANGELOG.md) | Dated shipped changes |
| [`AGENTS.md`](AGENTS.md) | Repository operating instructions for coding agents (imported by [`CLAUDE.md`](CLAUDE.md)) |

The database itself remains executable authority for schema through forward migrations.

---

## Source-of-truth rule

Do not make several documents own the same fact.

Use:

```text
Product meaning
→ product.md

Domain meaning
→ domain-model.md

Technical boundary
→ architecture.md

Security rule
→ security.md

Persistence rule
→ data.md

UI rule
→ ui-system.md

Historical architectural rationale
→ decisions/

Implementation sequencing
→ roadmap.md

What shipped and when
→ CHANGELOG.md

Exact source history
→ Git
```

When two sources disagree, fix the ownership conflict rather than preserving both stories.

---

## Quick start

### Prerequisites

Install:

- Node.js 22
- pnpm
- Python 3.12
- Docker
- Git

Then from repository root:

```bash
pnpm install
python -m pip install -r apps/api/requirements-dev.txt
```

---

### Configure local environments

Copy:

```text
apps/web/.env.example
→ apps/web/.env.local

apps/api/.env.example
→ apps/api/.env
```

Use local or sandbox values only.

Never commit credentials.

See [`docs/development.md`](docs/development.md).

---

### Start Supabase

```bash
pnpm db:start
```

For a fresh local database:

```bash
pnpm db:reset
```

---

### Prepare demo data

```bash
pnpm demo
```

Or reset and rebuild it:

```bash
pnpm demo:fresh
```

---

### Start the web app

```bash
pnpm --filter @gold/web dev
```

Default:

```text
http://localhost:3000
```

---

### Start the API when needed

```bash
python apps/api/dev.py
```

Default:

```text
http://127.0.0.1:8787
```

The local API router reads the same rewrite definitions used by the deployed API.

---

## Verification

The main repository check is:

```bash
pnpm check
```

Useful focused commands include:

```bash
pnpm check:fast

pnpm test:unit
pnpm test:component
pnpm test:architecture
pnpm test:architecture:db
pnpm test:db
pnpm test:contract
pnpm test:api
pnpm test:local
pnpm test:e2e
pnpm test:smoke
pnpm test:visual
pnpm test:provider
```

See [`docs/testing.md`](docs/testing.md) before interpreting what a passing tier actually proves.

---

## Database workflow

Schema changes use forward migrations under:

```text
supabase/migrations/
```

Applied migrations are immutable history.

Normal local sequence:

```text
create forward migration
↓
pnpm db:reset
↓
pnpm db:types
↓
targeted database tests
↓
broader verification
```

Do not hand-edit generated database types.

Do not use remote migration commands as part of ordinary local development.

See:

- [`docs/data.md`](docs/data.md)
- [`docs/deployment.md`](docs/deployment.md)

---

## Application layering

Web code follows this broad responsibility model:

```text
apps/web/app
  routes and top-level screen composition

apps/web/features
  product/domain interaction UI

apps/web/components
  shared GildOps UI contracts

apps/web/lib/application
  use-case / read-model composition

apps/web/lib/domain
  business rules and canonical operations

apps/web/lib/adapters
  provider implementations

packages/ui
  generic UI primitives
```

Business rules do not belong in React pages merely because a page is their first caller.

Provider SDKs do not belong in domain modules.

See [`docs/architecture.md`](docs/architecture.md).

---

## Tenant and Platform boundary

GildOps has three distinct human operating scopes:

```text
Person
Organization
Platform Administration
```

An Organization is the tenant boundary.

GildOps' own business operates as an ordinary Organization.

Platform Administration is separately authorized.

Membership in GildOps' own Organization does not automatically make someone platform staff.

See:

- [`docs/domain-model.md`](docs/domain-model.md)
- [`docs/security.md`](docs/security.md)

---

## Settings ownership

Settings begins with exactly five independent scopes:

```text
Organization
Account
Access
Connections
Plan & usage
```

Do not duplicate one scope inside another.

Examples:

```text
Members / Invitations / Roles
→ Access

Personal profile / Security & sign-in
→ Account

Connected external systems
→ Connections

GildOps subscription and usage
→ Plan & usage
```

See [`docs/product.md`](docs/product.md) and [`docs/ui-system.md`](docs/ui-system.md).

---

## Providers vs Connections

These are different systems.

```text
Provider infrastructure
→ operated by GildOps Platform Administration

Connector / Connection
→ an Organization connecting its own external system

File import
→ artifact intake, not a Connection
```

See [`docs/integrations.md`](docs/integrations.md).

---

## Finance boundary

There are two separate economic planes.

Tenant Finance:

```text
customer
↓
organization
```

Platform commercial:

```text
organization
↓
GildOps
↓
provider
```

Do not expose platform wholesale/provider economics through the tenant Finance workspace.

---

## AI and automation

AI does not own business truth.

AI may:

- read authorized context;
- reason;
- draft;
- use approved tools;
- propose actions.

Consequential writes still use ordinary domain authorization and business rules.

Automations owns durable orchestration.

AI may participate inside an Automation without becoming the owner of the workflow.

---

## Naming

The human-facing product name is:

```text
GildOps
```

The public domain is:

```text
gildops.com
```

The live repository still contains legacy technical identifiers such as:

```text
@gold/*
gold_*
Gold*
gold-platform
```

Do not perform broad search-and-replace branding migrations.

Technical naming changes require bounded migration.

Historical migrations and Git history are not rewritten for branding.

---

## Contributing / agent work

Before changing the repository:

1. inspect the current implementation;
2. identify the owning domain and document;
3. determine the smallest coherent slice;
4. implement through canonical layers;
5. verify the actual requirement;
6. report what was and was not verified.

Repository-specific agent instructions are in [`AGENTS.md`](AGENTS.md), which [`CLAUDE.md`](CLAUDE.md) imports.

Most importantly:

> **Do not create a branch, commit, push or pull request unless the user explicitly asked for repository mutation.**

An audit, plan, review or work order is read-only unless stated otherwise.

---

## Current roadmap

The current program sequence is:

```text
Documentation reset
↓
UI recovery
↓
Commercial / entitlement hardening
↓
Provider control plane + Communications front desk
↓
Operator-domain completion
↓
GildOps dogfood + provisioning hardening
↓
NextFund onboarding / migration rehearsal
↓
Broader rollout
```

NextFund is not assumed to already be a tenant.

See [`docs/roadmap.md`](docs/roadmap.md).

---

## License

No public license is declared by this README.

Treat the repository as private/proprietary unless the repository owner explicitly establishes another license.
