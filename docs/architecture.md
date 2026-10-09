# GildOps Architecture

## Purpose

This document defines the **current target architecture and dependency boundaries** for GildOps.

It answers:

- What are the major runtime and repository parts?
- Which layer owns which responsibility?
- How do tenant, platform, public and provider flows cross those layers?
- Which dependencies are allowed?
- Where is the source of truth for a concept?
- How should new capability fit into the existing system?

This is a current-state architectural contract.

Historical reasoning belongs in `docs/decisions/`.

Implementation status belongs in `docs/roadmap.md`.

---

## Architectural principles

### 1. One platform, not one codebase per customer

Customer variation should be expressed through:

- organization configuration;
- entitlements;
- roles/capabilities;
- work types and vocabulary;
- provider/connection configuration;
- authored content;
- automation;
- data.

A customer-specific fork is a last resort.

---

### 2. One canonical owner per business fact

Domains own authoritative state.

Workspaces and pages compose that state.

A page appearing in a workspace does not move domain ownership into the UI.

---

### 3. Tenant, person and platform scopes are explicit

The system has three different human scopes:

```text
Person
Organization
Platform Administration
```

Do not infer one from another.

Do not use organization membership as Platform authority.

Do not treat the GildOps organization as a special unscoped tenant.

---

### 4. Database enforcement carries critical invariants

Authorization, tenant isolation and race-sensitive integrity must not depend on the browser doing the right thing.

Critical constraints belong as close to persistence as practical through:

- RLS;
- grants;
- database constraints;
- narrow database functions/RPCs;
- transactions;
- domain validation where appropriate.

The application should provide good errors and workflows around those rules, not replace them with weaker copies.

---

### 5. Domain code speaks business language

Domain modules should know:

- GildOps business concepts;
- business invariants;
- canonical operations.

They should not know provider-specific SDK vocabulary when a capability adapter can isolate it.

---

### 6. Provider dependencies sit behind capability boundaries

A domain should depend on:

```text
send message
place call
charge payment
resolve route
send tenant email
run model
```

not:

```text
Twilio
Stripe
OSRM
Resend
OpenAI
```

Provider names belong in:

- adapters;
- registries;
- Platform provider control;
- provider-specific operational tooling.

---

### 7. Configuration is not operation

Configuration surfaces control how an operating capability behaves.

They do not become a second copy of the operating workspace.

---

### 8. Shared engines remain shared

Scheduling, identity, reporting aggregates, events, search, metering, provider infrastructure and authorization may be used by many workspaces without becoming workspaces themselves.

---

### 9. Compatibility is not architecture

Redirects and legacy technical names may remain to protect links, data and integrations.

They do not define the target information architecture or naming model.

---

## Repository topology

The repository is a pnpm monorepo.

Canonical top-level responsibilities are:

```text
apps/
  web/
  api/

packages/
  config/
  schemas/
  types/
  ui/

supabase/
  migrations/
  snippets/
  ...

infrastructure/

docs/

scripts/
```

---

### `apps/web`

`apps/web` is the primary product application.

It contains:

- Next.js routes;
- authenticated organization shell;
- Platform Administration surfaces;
- public/customer-facing web surfaces;
- server-side route/application composition;
- domain modules;
- provider capability adapters used by the web runtime;
- product features and components.

The web application must not become one giant client application merely because some controls are interactive.

Server/client boundaries should follow the interaction requirement.

---

### `apps/api`

`apps/api` is the Python service boundary for work that is better represented as explicit API/provider/machine execution.

Current categories include:

- provider webhooks/callbacks;
- voice and messaging ingress/status;
- payment provider callbacks;
- platform billing callbacks;
- integration/OAuth operations;
- provider operations;
- scheduled automation execution;
- AI/model endpoints;
- narrow externally invoked domain operations.

`apps/api` is **not** a second independent business domain model.

Where both runtimes implement behavior around the same concept, they must share the same domain semantics and persistence invariants rather than inventing separate rules.

---

### `packages/ui`

`packages/ui` owns source-controlled generic UI primitives.

Examples include:

- Button;
- Input;
- Dialog;
- Sheet;
- Sidebar;
- Tabs;
- Table;
- Card;
- Empty state primitives;
- Breadcrumb;
- Dropdown;
- Drawer;
- form primitives.

`packages/ui` should remain product-agnostic.

A generic primitive does not decide GildOps information architecture.

---

### `packages/types`

Shared TypeScript types that genuinely cross package boundaries.

Do not move domain ownership into `packages/types` merely to make imports shorter.

---

### `packages/schemas`

Shared schemas/contracts for data that genuinely crosses package/runtime boundaries.

Schemas should describe contracts.

They should not become a second domain implementation.

---

### `packages/config`

Shared build/runtime configuration that belongs to the monorepo rather than one application.

---

### `supabase/migrations`

Forward database migrations are the executable database history.

Applied migrations are immutable historical evidence.

Never rewrite an applied migration to modernize:

- naming;
- comments;
- branding;
- structure.

Change the database through a new forward migration.

---

### `supabase/snippets`

Standalone diagnostics, maintenance queries and operational helpers belong outside the migration stream.

A script that should not run automatically during schema migration must not masquerade as a migration.

---

## Application layering

GildOps uses explicit responsibility layers.

The practical flow is:

```text
route
  ↓
application composition
  ↓
domain
  ↓
database / adapter
```

UI composition has its own parallel hierarchy:

```text
design tokens / primitive styling
        ↓
packages/ui primitives
        ↓
apps/web/components
        ↓
apps/web/features
        ↓
apps/web/app routes
```

Do not collapse these into one folder or one component layer.

---

### Route layer — `apps/web/app`

A route owns:

- URL boundary;
- route parameters;
- route-level authorization/context requirement;
- top-level data orchestration where appropriate;
- selecting the correct feature/screen composition;
- metadata/redirect/not-found semantics.

A route should not become the canonical home for business rules.

Prefer:

```text
page.tsx
  → require context
  → load application model
  → render feature/screen
```

over a route file that contains:

- provider calls;
- domain calculations;
- permission replicas;
- giant UI implementations;
- duplicated query logic.

---

### Application layer — `apps/web/lib/application`

The application layer composes domain operations/read models for a use case or screen.

It may:

- orchestrate several domain readers;
- build screen/read models;
- coordinate cross-domain use cases without stealing ownership;
- translate domain results into application-level presentation models.

It must not:

- become a second domain layer;
- move critical invariants out of the database/domain;
- directly encode vendor-specific behavior that belongs in adapters.

Application composition is especially appropriate when one screen legitimately consumes several canonical domains.

---

### Domain layer — `apps/web/lib/domain`

The domain layer owns business language and domain operations.

Examples include:

- customers;
- work items;
- scheduling;
- pricing;
- billing;
- communications;
- automations;
- catalogue;
- commercial usage;
- provider bindings;
- integrations;
- identity;
- public site;
- forms.

Domain code should:

- express canonical concepts;
- enforce/validate business rules not solely held by the database;
- call database operations through approved boundaries;
- remain understandable without reading UI implementation.

Domain code must not import vendor SDKs directly.

---

### Adapter layer — `apps/web/lib/adapters`

Adapters translate capability contracts into provider implementations.

A typical adapter shape is:

```text
capability contract
registry/resolver
provider implementation
```

Examples include:

- payment;
- telephony;
- messaging;
- email;
- routing;
- geocoding;
- source control;
- AI/drafting/answering;
- platform billing.

Domain code consumes the capability contract.

Provider selection belongs in registry/control-plane policy.

---

### Feature layer — `apps/web/features`

A feature owns product UI and interaction for a recognizable product/domain capability.

A feature may contain:

- task-specific components;
- forms;
- tables;
- drawers/sheets;
- client interaction state;
- feature-local composition.

A feature should not recreate:

- generic UI primitives;
- application shell;
- domain rules;
- global navigation;
- authorization policy.

Organize features by meaningful product/domain concepts, not by arbitrary visual fragments.

---

### Shared application UI — `apps/web/components`

Shared application components sit between generic `packages/ui` primitives and feature UI.

Current categories include:

- controls;
- display;
- feedback;
- headers;
- layout;
- navigation;
- panels;
- patterns;
- surfaces.

These components encode stable GildOps interaction/presentation grammar.

Examples:

- `PageHeader`;
- `WorkspaceHeader`;
- `WorkspaceHome`;
- `CollectionHeader`;
- `AppPage`;
- `ViewNav`;
- page support rail;
- shared Section/Empty/Collection patterns.

Detailed UI rules belong in `docs/ui-system.md`.

---

## Runtime scopes

### Organization runtime

Canonical organization routes are under:

```text
/organizations/{organizationId}/...
```

The organization ID identifies the business context.

It does not replace server-side membership/authorization checks.

The organization shell composes:

- global workspace chrome;
- projected navigation;
- page content;
- workspace Agent rail;
- page-support rail;
- responsive navigation.

---

### Personal runtime

Person-owned settings live outside an organization's configuration ownership.

Canonical personal settings begin under:

```text
/settings/account
```

An optional organization return hint is navigation context only.

It confers no authority.

---

### Platform runtime

Platform Administration is addressed under GildOps' own organization context:

```text
/organizations/{gildOpsOrganizationId}/platform/...
```

The path expresses:

- current organization context = GildOps;
- current sub-scope = Platform Administration.

Authorization still depends on explicit platform authority.

Platform pages must not enter tenant workspace registries.

Legacy `/platform/**` compatibility routes may redirect, but they are not the canonical architecture.

---

### Public/customer runtime

Public/customer surfaces live outside the authenticated operator shell.

Examples include:

- marketing;
- forms;
- booking;
- public sites;
- proposal review;
- portal;
- embeds;
- auth flows.

These routes use narrow public/external access and must not inherit organization-operator navigation merely because they eventually read organization data.

---

## Navigation architecture

Navigation represents operator intent.

The canonical organization navigation model contains:

```text
Home
Library
Workspaces
```

Settings is reached from the account menu. Team, Connections and Agent are workspace-header utilities. Platform is a separate privileged context in the context switcher for authorized platform staff, with its own nested projection.

---

### Workspace registry

The workspace registry contains all canonical workspace identities.

Visibility is derived from real reachable operating pages plus the relevant entitlement/permission projection.

All nine workspaces have canonical Homes. Marketing, Support and tenant AI register matching Areas and authenticated pages at `/organizations/[organizationId]/marketing`, `/organizations/[organizationId]/support` and `/organizations/[organizationId]/ai`. Marketing and Support compose domain operating read models; tenant AI composes the agent-management read model. Support requires organization membership, service access and `support.read`. Its server actions delegate to transactional capability-checked database commands, while exact aggregate queries bound collection and board previews independently. Support keeps its private immutable Case evidence separate from the general tenant event feed, whose broader read and append permissions are unsuitable for internal notes. Tenant workspace projection remains flat; contextual Areas supply active-route aliases rather than child rows. Tenant AI is separate from Platform AI Runtime and the global Agent rail.

Do not create a separate “visible workspaces” hard-coded list.

---

### Areas/pages

A page can belong to a workspace without changing its route hierarchy to mirror the workspace hierarchy.

Example:

```text
/customers
```

may be CRM-owned without requiring:

```text
/crm/customers
```

Ownership and URL structure are related architectural choices, not the same axis.

---

### Workspace Home

A workspace parent destination is its Home.

Home summarizes that workspace and links into real child surfaces.

A workspace with no real Home/operating surface does not receive an empty navigation row.

---

### Page support modes

Activity, Insights and Configure are page/workspace support modes.

They are not automatically top-level navigation destinations.

Use them only when an honest source exists.

---

## Settings architecture

Settings is a chooser of five independent scopes:

```text
Organization
Account
Access
Connections
Plan & usage
```

No peer scope is duplicated inside another.

Organization configuration is a directory into focused configuration surfaces.

Access owns:

```text
Members
Invitations
Roles
```

Connections owns:

```text
connected apps
connector browsing
connection resources/imports
credentials/secrets
```

Plan & usage owns the organization's GildOps commercial relationship.

Account is person-owned and follows the Person across Organizations.

Supabase Auth owns authentication identity, email, credentials, provider identities and sessions.
`account_profiles` owns personal names, avatar, locale, timezone and optional personal contact/address
information. Contact/address fields are private to the account owner and never authorization inputs.
`memberships` owns organization participation, roles and an optional organization-specific name override.
Personal contact information is separate from organization, customer and billing addresses.
Phone numbers require explicit E.164 (`+` and 2-15 digits); no country inference or international
formatting parser is installed. Empty optional contact fields become null. Country codes use assigned
ISO 3166-1 alpha-2 identifiers. Addresses have length bounds without country-specific postal rules.

Legacy Settings routes may redirect to canonical owners.

Redirect compatibility must not be rendered as duplicate navigation.

### Organization setup and configuration ownership

Setup groups the canonical configuration targets into adaptive business, operations, people/resources,
customers/data, communications, finance, public presence, AI/automations, and review steps. Offered
destinations require their own configuration capability, resolved feature availability, and, for
scheduling configuration, schedulable work. URL step selection is navigation, not persisted completion.
Business identity uses the same Organization form and mutation as General; work, hours, pricing,
membership, roles, branding and connections remain with their existing domain owners.

`organizationResolvedFeatureStates` supplies entitlement, activation and feature readiness to Settings,
Setup and navigation. Readiness evaluates active available catalogue features, including Plan-only
assignments, rather than raw legacy switches. PostgreSQL launch blockers use `app.module_entitled`;
subscription access remains deployment-environment-aware through the existing service-access resolver.
The launch action rechecks both before transitioning to Live.

Sales discovery and accepted recommendations remain historical handoff evidence. Setup displays known
facts and unresolved questions and can prefill a first draft without treating discovery as saved
operational configuration. `/setup/proposal` is the domain-grouped document review surface. Structural
validation is shared by adapter, document edits and canonical application. Individual feature selections
activate only entitled, implemented catalogue features; historical grouped selections remain readable
and removable, without creating commercial terms or modifying Plan assignments.

Proposal application atomically claims a tenant-bound draft as `applying` before canonical writes.
The claimed shape is frozen. Application retains the existing partial-write semantics and records
success or failure; interrupted claims stay visible for inspection and are never automatically replayed.
Revise, discard and apply all bind the proposal identifier to the requested organization.

The Settings landing uses exact tenant-scoped counts and authorized directory destinations for status
and search. It loads no provider credentials. Connections expose neutral verification failures to UI
consumers; provider accounts, bindings and platform AI credentials retain their separate authorities.

Legacy organizations still retain the catalogue's existing distinction between kernel runtime
mappings and explicit Plan/module entitlement. Kernel surfaces are not commercially gated by a
missing Plan assignment; a catalogue row without a legacy module mapping is not proof that the
underlying primitive is unavailable. Full kernel-feature activation/runtime parity remains a
commercial-model limitation, rather than grounds for inventing Plan grants during setup.

---

## Data and persistence architecture

### PostgreSQL/Supabase

PostgreSQL is the authoritative persistence and policy engine for tenant business state.

Supabase provides:

- PostgreSQL;
- Auth;
- PostgREST/RPC access;
- storage/related platform capabilities where used.

Critical tenant and permission boundaries must remain enforceable without trusting browser code.

Detailed data conventions belong in `docs/data.md`.

---

### Row Level Security

Tenant-readable/writable tables use RLS according to their access model.

RLS answers data access.

Application permission checks may improve UX and fail earlier, but they do not replace RLS/server enforcement.

---

### Narrow privileged functions

Security-sensitive operations should prefer narrow, named doors over broad privileged database credentials.

Examples include:

- machine-role writes;
- controlled provider callbacks;
- public/external actions;
- narrowly scoped platform reads/writes.

A privileged runtime should receive only the grants needed for its operation.

Avoid general service-role access in product runtimes.

---

### Cross-tenant references

Tenant-owned references must preserve organization consistency.

Where two tenant-owned entities relate, the persistence model must prevent a row from relating one organization's record to another organization's record.

---

### Snapshots and effective dating

When historical meaning matters, preserve it through:

- snapshots;
- immutable rows;
- append-only adjustments;
- effective-dated rates/terms.

Do not use current configuration to reinterpret historical commitments.

---

## Identity and authorization architecture

Authentication answers:

> Who is the caller?

Membership answers:

> Which Organization relationships do they hold?

Authorization answers:

> What may they do in this scope?

Entitlement answers:

> What may this Organization use commercially?

These are separate.

The application must not derive authorization from:

- display name;
- route ownership alone;
- client state;
- hidden UI;
- return URL;
- GildOps organization membership.

Detailed rules belong in `docs/security.md`.

---

## Provider architecture

Provider integration has two different axes.

### Platform provider axis

GildOps controls:

- Provider;
- Provider Account;
- provider credentials;
- Provider Binding;
- Provider Resource;
- provider rates/costs;
- provider health.

This is control-plane infrastructure.

### Tenant connection axis

An Organization controls:

- Connector selection;
- Connection;
- OAuth/credential grant;
- selected external resources;
- imports/data mappings;
- connection lifecycle.

The two axes may interact but must not be conflated.

Example:

```text
GildOps Twilio parent/provider account
≠
Organization phone number identity

GildOps Resend/provider account
≠
Organization sending domain/email identity

GitHub Connector
≠
one Organization's GitHub Connection
```

Detailed rules belong in `docs/integrations.md`.

---

## Communications architecture

Communications is multi-channel at the domain level.

Voice, SMS/messaging and email may have channel-specific records where their data differs, while sharing higher-level communication concepts where those semantics genuinely align.

Do not create a fake generic abstraction that hides important channel differences.

Likewise, do not duplicate customer/conversation state per channel.

Provider callback execution updates canonical communication state through narrow trusted paths.

The browser telephone and dialer pop-out are owned by the persistent Organization layout. Pop-out mode portals the compact calling form and existing live-call controls into a same-origin browser window; it does not register another telephone or create another call lifecycle. Workspace navigation preserves that window. Closing it returns controls to GildOps without ending the call. The main browser tab must stay open to retain its telephone connection.

---

## Scheduling architecture

There is one scheduling/availability authority.

Consumers include:

- internal scheduling;
- public booking;
- resource assignment;
- dispatch/feasibility;
- automation.

No consumer creates a second availability algorithm.

Race-sensitive commitment is enforced transactionally/database-side rather than trusting an earlier “free” read.

---

## Finance architecture

Tenant Finance and GildOps platform economics are separate planes.

### Tenant Finance

```text
Customer
  ↓
Organization
```

Owned by the Finance product/domain.

### Platform commercial

```text
Organization
  ↓
GildOps
  ↓
Provider
```

Owned by Platform Administration.

Shared concepts such as money, meter or payment provider do not justify merging the ledgers.

---

## Usage and cost architecture

There is one tenant commercial Usage Event ledger.

A Usage Event records what an Organization consumed.

Provider fulfilment cost may decompose into multiple Provider Cost Components.

This permits:

```text
one customer-facing usage reading
        ↓
multiple provider-billed ingredients
```

without turning provider billing vocabulary into sellable product units.

Unknown rate/cost/FX data remains unknown.

It must not become zero simply to make arithmetic easier.

---

## AI architecture

AI has four distinct responsibilities:

1. **Conversation/interaction**
2. **Model/runtime resolution**
3. **Tool use**
4. **Proposed consequential actions**

These must not collapse into “the model can access the database.”

---

### Tenant agent management

The tenant AI workspace manages the existing `ai_assistants`, knowledge associations and `ai_assistant_deployments`. Draft saves use optimistic concurrency; publishing creates an immutable `ai_assistant_versions` snapshot. Deployments explicitly pin a version. Operator conversations and website threads retain their effective version attribution, without copying transcripts to a second store. Organization managers configure agents; tools still run under the asking actor's token and canonical domain authorization.

The global Agent rail remains the operator interaction surface. A configured Operator Copilot supplies its published instructions, allowed read tools and approval policy to the shared Python loop; organizations without a selection retain the built-in agent. Public website turns use that same loop with no private business tools. Only published same-organization website snapshots supply public knowledge. Communications owns website conversations, staff claims, replies and resolution; handoff stops automated replies.

SMS/email drafting and Support summaries launch the existing contextual rail and require human review in their owning workspaces. Their channel deployments, Voice and Customer Portal are configuration-only: they cannot be enabled as autonomous conversational runtimes. Voice configuration does not alter the existing Communications telephone lifecycle. MCP execution is unavailable. Preview tests use a published version with no business tools/actions or external sending, and record personal human-assessed evaluations.

---

### Model runtime

Platform Administration controls supported model/provider runtime assignment.

The product calls an AI capability.

Platform policy decides how that capability is fulfilled.

Metering, entitlement, provider cost and health remain observable.

---

### Tools

AI tools expose narrow domain capabilities.

Reads execute in the asking actor's authorized context where possible.

Writes use explicit approved operations.

Do not grant an agent an unrestricted database credential.

---

### Consequential actions

Where human approval is required:

```text
model proposes
↓
system records intended action
↓
authorized person approves
↓
canonical domain operation executes
↓
result is recorded
```

AI must not implement a shadow mutation path.

---

## Automation architecture

Automations owns durable orchestration.

The runtime processes:

```text
Trigger
↓
Conditions
↓
Actions
↓
Run history
```

Automation actions call canonical domain operations or provider capability contracts.

A rule does not duplicate the target domain's business rule.

The web operating read model in `lib/application/automations/dashboard.ts` composes canonical rule review, exact execution aggregates and bounded history previews. The rule-detail route hosts a constrained linear builder; its inspectors call the existing authoring mutations, which now support atomic condition/action configuration updates using the same validation as creation. The UI creates disabled rules without changing the enablement of existing rules or the execution authority. Execution and delivery inspectors remain independent because the current records do not provide per-action snapshots or an exact run-to-delivery identity. Inspection is read-only, and provider readiness is never inferred from the presence of a rule definition.

---

## Events and reporting architecture

Domain events provide durable evidence that important business changes occurred.

Events can feed:

- timelines;
- automation;
- reporting;
- AI context;
- audit.

Reporting aggregates read canonical domain facts/events.

A report must not become a second operational source of truth.

Insights is a consumer of reporting infrastructure, not its own copy of every calculation.

---

## Public publishing architecture

Studio-authored public content uses draft/revision/publish semantics where the experience requires reviewable publishing.

Public rendering reads published state.

Public routes do not share the authenticated operator shell.

Domains/hostnames and deployment providers are infrastructure supporting the published experience, not the content owner.

---

## Cross-runtime request patterns

### Authenticated read

```text
Browser
  ↓
Next.js route/server component
  ↓
require Person/Organization context
  ↓
application/domain reader
  ↓
Postgres under caller authorization
  ↓
screen model
  ↓
UI
```

---

### Authenticated mutation

```text
User action
  ↓
server action / handler
  ↓
validate actor + scope + input
  ↓
domain operation
  ↓
database policy/constraint
  ↓
event / returned state
  ↓
UI feedback
```

A UI disable/hide is convenience only.

---

### Provider ingress

```text
Provider callback/webhook
  ↓
apps/api endpoint
  ↓
verify provider authenticity
  ↓
narrow machine identity / operation
  ↓
canonical domain write
  ↓
idempotent/reconciled state
```

The provider payload does not choose tenant authority merely by supplying an organization ID.

---

### Public/customer action

```text
Public/external session
  ↓
narrow public route/handler
  ↓
derive authoritative target
  ↓
validate public policy
  ↓
narrow domain function
  ↓
tenant-scoped result
```

Public actors do not receive ordinary tenant membership.

---

### AI action

```text
Actor request
  ↓
AI capability
  ↓
authorized context/tool
  ↓
answer / proposed action
  ↓
approval if required
  ↓
canonical domain operation
```

---

## UI architecture

UI-specific details belong in `docs/ui-system.md`.

The architectural hierarchy is:

```text
packages/ui
  generic primitives

apps/web/components
  shared GildOps UI contracts

apps/web/features
  domain/product interaction

apps/web/app
  routed screen composition
```

Do not import a page-specific feature into `packages/ui`.

Do not recreate a generic primitive inside a feature because it is locally convenient.

Do not solve structural layout defects with arbitrary route-level offsets when a shared layout contract should own the geometry.

---

## Testing architecture

Detailed test tiers belong in `docs/testing.md`.

At architecture level:

- static architecture tests prove source/dependency contracts;
- unit/domain tests prove deterministic logic;
- database/integration tests prove schema, RLS, grants and real persistence behavior;
- component tests prove interaction/DOM behavior;
- browser/E2E tests prove real navigation and integrated journeys;
- visual verification proves rendered hierarchy, spacing and responsive composition;
- provider tests prove vendor contracts only when intentionally configured.

No one test type should claim proof that belongs to another.

---

## Naming and migration architecture

The human-facing brand is **GildOps**.

Current live technical identifiers may still use legacy GOLD naming, including:

- repository metadata;
- `@gold/*`;
- database identifiers;
- source symbols;
- historical migrations.

The target technical namespace is GildOps-oriented, but migrations must be bounded and atomic.

Rules:

1. Never rewrite applied migrations for branding.
2. Do not perform blind repository-wide replacement of load-bearing symbols.
3. Package namespace changes must update manifests, imports, CI and tooling together.
4. Historical records may retain the name accurate to their time.
5. New human-facing prose uses GildOps.

---

## Source-of-truth hierarchy

Different concerns have different authoritative sources.

| Concern | Canonical source |
| --- | --- |
| Product identity and ownership | `docs/product.md` |
| Domain concepts and semantics | `docs/domain-model.md` |
| System/layer boundaries | `docs/architecture.md` |
| Material decision history | `docs/decisions/` |
| Database schema | forward migrations + current database |
| Authorization/data policy | schema/RLS/grants + `docs/security.md` |
| UI grammar | `docs/ui-system.md` |
| Integration/provider conventions | `docs/integrations.md` |
| Public web / publishing / domains | `docs/public-web.md` |
| Test procedure | `docs/testing.md` |
| Local development | `docs/development.md` |
| Deployment | `docs/deployment.md` |
| Runtime operations | `docs/operations.md` |
| Work sequencing/status | `docs/roadmap.md` |
| Shipped change history | `CHANGELOG.md` |
| Agent working rules | `CLAUDE.md` |

A decision record explains why a rule exists.

It does not override the current canonical document after the architecture changes.

---

## Adding a capability

Before adding a new capability, answer these questions in order.

### 1. What existing domain owns it?

If the answer is clear, extend that domain.

Do not create a new domain because the UI needs a new page.

### 2. Is it operating work, configuration, shared infrastructure or platform control?

This decides where the user reaches it.

### 3. Is there a canonical record?

If yes, extend or relate to it.

Do not copy it for another workspace.

### 4. Does the organization need entitlement?

If commercial access matters, map it through the commercial model.

Do not substitute a Role permission.

### 5. Which actors may operate it?

Define capabilities and enforce them server/database-side.

### 6. Does it call an external provider?

Define/extend a capability adapter rather than importing the vendor into the domain.

### 7. What history must survive configuration changes?

Choose snapshot/effective-date/append-only semantics before shipping.

### 8. What UI archetype expresses the task?

Reuse the UI system.

Do not design a new page grammar by default.

### 9. How is it verified?

Choose the lowest test level that proves each rule, plus browser/visual evidence when the user-visible result matters.

---

## Architectural anti-patterns

Do not introduce:

- customer-specific application forks for ordinary product variation;
- a second tenant lookup path;
- a second pricing calculation;
- a second scheduling/availability engine;
- UI-only authorization;
- provider SDK imports in domain code;
- a second ledger for the same commercial fact;
- duplicate customer records by workspace;
- duplicate conversation records by Support/CRM;
- tenant Finance reading GildOps platform margin/cost state;
- Platform authority derived from GildOps membership;
- files represented as Connectors;
- provider accounts represented as tenant Connections;
- hard-coded catalogue lists in application UI when the catalogue is data;
- route-local copies of global navigation registries;
- “coming soon” navigation rows;
- current architecture encoded only in comments while documentation says something else;
- historical decision documents treated as current source of truth after supersession.

---

## Document boundaries

This document owns:

- repository/runtime structure;
- layer responsibilities;
- dependency direction;
- scope boundaries;
- major request/data flows;
- shared architecture rules.

It does not own:

- detailed domain definitions;
- detailed UI grammar;
- schema DDL;
- deployment steps;
- test commands;
- roadmap status;
- historical implementation narrative.
