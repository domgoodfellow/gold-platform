# GildOps Architecture

## Purpose

Customer delivery notifications reuse Communications messages, email details, conversations,
message events, tenant provider adapters and signed webhook ingress. CRM records an explicit
service notification intent in the same transaction as review release, disclosure publication or
an optionally notified review withdrawal. A narrowly scoped SQL queue interface creates only
fixed version-1 transactional templates and resolves recipient/sender from persisted policy;
it does not widen the authenticated operator compose-email interface.

The API customer-notification tick follows the existing scheduled-runtime convention. Private jobs
reference canonical messages; attempt rows store leases/outcomes, not duplicate bodies or provider
events. Claim uses SKIP LOCKED and five-minute fenced leases. Immediately before each provider send,
authorization rechecks consent, address, sender and current domain target. Transient errors use
bounded exponential retry with the same message/provider idempotency key, at most five claims and
within 23 hours of the first attempt. Operators may accelerate an eligible queued retry or retry
a safe failed attempt inside those bounds; accepted, suppressed and exhausted notices cannot retry.
Provider accounts resolve beneath the organization's selected identity, without platform invitation
credentials. The scheduled endpoint requires CRON_SECRET and the existing provider runtime settings.

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

`apps/api` is the API service boundary for work that is better represented as explicit API/provider/machine execution. Its domain commands remain Python. ADR-041 adds a Node function in the same deployment to execute imported open-source connector packages, using fixed loaders, signed internal requests and database-authorized single-use jobs. Connector packages never own tenant/domain authorization or persistence.

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

Global Home is a read-only composition in `apps/web/lib/application/home/`: contracts describe source-qualified canonical identities, readers project authorized domain metadata, and the loader resolves tenant membership, feature availability and capability gates before querying optional workspaces. Independent source failures preserve available projections without inventing zeroes. The organization shell hosts canonical setup/launch components in notifications; the Home client owns presentation and browser preferences. The shell command palette and Home dropdown share the loader's authorized action list; on-demand shell reads recheck the current organization actor. Shared event projections select bounded metadata only. No Home task store, calendar authority, reporting-dashboard model or mutation engine exists. Creation and resolution stay with domain commands and existing workspace drawers. Scheduling coverage uses the canonical evaluator against the bounded schedule preview and fetches only assigned Resource identities; complete exception queues remain in Dispatch.

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

Charts and workspace Dashboards are shared, not per workspace. `lib/chart-model.ts` is the pure chart data contract (shapes, valid presentations, scales, ticks) used by application code that prepares chart data and by `components/charts`, which only renders supplied, already-authorized values. `lib/dashboard-layout.ts` is the one ordering, sizing, validation and packing algorithm for personal Dashboard layouts, used by the browser editor (`components/dashboard`) and by `lib/domain/preferences/dashboard-layouts.ts`, which persists them. A workspace registers its widgets and their read requirements in its application layer (`lib/application/finance/dashboard-widgets.ts`); its chart data comes from its existing read model (`lib/application/finance/dashboard-charts.ts`), never a second aggregation.

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

Platform Administration owns `/platform/**` and a distinct composition of the shared shell. Its server guard resolves GildOps' configured operating organization through `lib/domain/platform/operating-organization.ts`, proves Membership using the billing-recovery guard and checks exact live platform capability. The URL supplies no organization authority. Old organization-scoped Platform URLs render the ordinary organization not-found surface; there are no redirect stubs. Platform pages do not enter the tenant workspace registry.

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

The information architecture is owned by `docs/product.md` → *Workspace navigation* (ADR-046); presentation by `docs/ui-system.md`. This section owns the modules. `lib/navigation.ts` registers destinations (`WORKSPACES`, `AREAS`, `CONFIG_TARGETS`, `WORKSPACE_CONFIGURE`). `projectShell` (`lib/shell.ts`) is the one projection of that registry, filtered by entitlement, permission and work shape; the sidebar, the phone menu and the page-location control read it; page headers never reproduce its destinations (ADR-048), and contextual Calendar links use its registered `calendar` entry; the organization header has none (ADR-050). `projectBusinessNavigation` (`lib/application/shell`) decorates that projection with business-profile labels and order and never restructures it; configuration cannot grant access. No feature or page keeps its own destination list. `resolveLocation` (`lib/route/page-location.ts`) is the one page-location resolver (ADR-047): explicit route patterns that reference these registries by key, plus only the location metadata they lack (record and sub-view labels, plain-text grouping levels). It separates whether a route exists, whether the viewer may open it, whether the sidebar shows it and where it sits in the hierarchy; it reads no domain data, and pages pass server-loaded record labels into it. During migration, `WorkspaceCrumbSlot` renders the resolver's answer itself on the routes `RESOLVED_LOCATION_ROUTES` names, using the shell's serialized gate from `LocationNavigation.access`, and `PageCrumbs` stands down there; every other route keeps its page-published trail. Organization Home, Library, domain collections and optional dashboards remain canonical destinations. Settings keeps its independent canonical navigation. The Account/session menu retains Settings, Help, Contact Support and Sign out; the switcher lists businesses only. GildOps' authorized sidebar offers entry to the separate Platform scope. Same-business navigation retains the telephone runtime; cross-scope entry opens a new tab during a call.

Dashboard is the first eligible operating destination on each existing workspace landing route; workspace headings are identity only (ADR-049).

---

### Workspace registry

The workspace registry contains all canonical workspace identities.

Visibility is derived from real reachable operating pages plus the relevant entitlement/permission projection.

All nine workspaces have canonical Homes. Marketing, Support and tenant AI register matching Areas and authenticated pages at `/organizations/[organizationId]/marketing`, `/organizations/[organizationId]/support` and `/organizations/[organizationId]/ai`. Marketing and Support compose domain operating read models; tenant AI composes the agent-management read model. Support requires organization membership, service access and `support.read`. Its server actions delegate to transactional capability-checked database commands, while exact aggregate queries bound collection and board previews independently. Support keeps its private immutable Case evidence separate from the general tenant event feed, whose broader read and append permissions are unsuitable for internal notes. Record, detail and configuration routes keep their owning workspace's context. `workspaceNavigation` resolves the most specific canonical configuration resource or Area before checking eligibility; an authorized workspace root cannot authorize a restricted child. Hidden Areas preserve deep-link ownership without becoming rows, and unavailable registered Areas cannot fall back to an eligible ancestor. URL-derived context survives refresh, history and organization changes without mutable workspace selection. Settings takes precedence with its existing contextual navigation. Only navigation content changes; the Organization layout, telephone runtime, account controls and responsive sidebar state persist. Tenant AI is separate from Platform AI Runtime and the global Agent rail.

Do not create a separate “visible workspaces” hard-coded list.

---

### Areas/pages

CRM route ownership follows the approved `/crm` hierarchy in `docs/product.md`. Legacy `/sales`, `/customers` and `/opportunities` paths exist only as temporary compatibility redirects. Route composition delegates to canonical domain commands; a redirect does not own a second page.

---

### Workspace Home

A workspace Home is an optional operational dashboard destination.

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

Owned by Platform Administration: provisioning, entitlement enforcement, providers, infrastructure and platform economics. Selling is not platform-owned: every Organization sells through organization Finance, and GildOps sells its platform through its operating Organization's Finance (ADR-051). The existing platform-billing tables remain in this plane, protected, until a reviewed migration.

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


### Workspace configuration ownership and entry

`CONFIG_TARGETS` classifies operating editors and shared organization owners explicitly;
`WORKSPACE_CONFIGURE` references those same targets. `workspaceConfigureItems` excludes operating
editors, applies independent configuration capabilities and resolved entitlements/shape, and
allows shared-owner links without copying their editors. The workspace Home's `ConfigureMenu` and one
icon-bearing sidebar Configuration row (a direct link for one door, an expand/collapse group for
several) open the doors themselves. `{home}/configuration` is redirect-only: it sends old links to
the first door the member may open, or not-found, and is never drawn as a link.
Marketing and Automations have no registered execution/acquisition policies today; they register
no Configure doors, and their operating form and rule/template editors do not earn Configuration pages.
A configuration-only member's workspace row opens their first door directly, without an operating
Home or restricted destinations. `requireWorkspaceConfiguration` and `requireConfigurationTarget`
enforce membership, service access, capabilities and availability before page reads. The
persistent layout is never the sole page authorization boundary.

Every workspace with configuration routes exposes them as one expandable Configuration group in
the persistent workspace sidebar; configuration pages render no second navigation column. Sections
use canonical URLs or real page anchors, and the group containing the active route is open.
Existing domain operations and data owners
remain unchanged. Shared Branding, Domains and Public profile remain organization Settings;
Studio links to them. Business hours remain Scheduling-owned; currency remains General-owned.


### Configuration migration inventory

Classification precedes route migration. A legacy URL is compatibility only, never another editor.

| Concern | Classification and canonical owner | Current route before consolidation | Destination |
| --- | --- | --- | --- |
| Calling, routing, outcomes | Communications configuration; existing identity/routing/outcome permissions | settings/calls | comms/configuration/calling |
| Number inventory and assignments | Communications configuration; operator record reads remain distinct from management | comms/numbers and number records | comms/configuration/numbers and number records |
| Messaging/visitor communication profile | Communications configuration | settings/communications | comms/configuration/messaging |
| Sending domains, sender addresses and default sender | Organization Settings (Email sending), shared with Communications; organization.manage | comms/configuration/email | settings/email |
| Which addresses receive into the Inbox | Communications configuration (Inbox email); organization.manage | settings/email | comms/configuration/email |
| Relationship/opportunity stages | CRM configuration; field.manage | settings/sales-stages, settings/opportunity-stages | sales/configuration/relationship-stages and opportunity-stages |
| Customer-specific fields | CRM configuration over the shared field engine | settings/custom-fields?entity=customer | sales/configuration/fields, retaining the single field engine |
| Work types/stages/checklists/fields | Work configuration; field.manage | work/configuration | retain owner and integrate section navigation |
| Business hours and scheduling buffer | Scheduling configuration; field.manage and work shape | schedule/configuration | retain owner and integrate Work section navigation |
| Queues and service levels | Support configuration; existing support.read and support.configure | support/queues, support/service-levels | support/configuration/queues and service-levels; operating queue triage stays support/queues |
| Prices and payment collection | Prices: Finance operating page (Catalog & Pricing); payment collection: Finance configuration; price.manage/organization.manage per control | settings/pricing | finance/catalog for prices; finance/configuration/pricing (Payments & currency) for payment collection |
| Trading currency | Shared organization configuration; organization.manage | General and duplicated Pricing editor | settings/general, with Finance linking to that owner |
| Agents/deployments/knowledge/tools | AI configuration; existing organization/manage/feature gates | ai/agents, ai/deployments, ai/knowledge, ai/tools | retain domain views and integrate configuration sections |
| Rule authoring, templates, activity | Automations operations | automations/rules, messages, activity | retain operating surfaces; no invented execution policy |
| Campaigns/acquisition | Marketing operations; no separate implemented policy editor | marketing | retain; shared form assets remain Studio-owned |
| Website/forms/templates editing | Studio operations | studio/website, studio/forms, studio/templates | retain operating surfaces |
| Branding/public profile/domains/publication boundary | Shared organization configuration | settings/branding, public-profile, domains | retain Settings owners; Studio links out |
| Profile/security/appearance | Personal configuration | settings/account and subroutes | retain user-owned routes |
| Providers/catalogue/runtime/commercial authority | Platform configuration | GildOps organization/platform | retain independent platform guards |


The migration inventory above is implemented through the existing registries. CRM stages and customer fields live under `sales/configuration`; legacy customer-field URLs redirect to CRM, while work-item field URLs redirect to the existing Work field tab. Other entity definitions retain the shared field engine and their existing entity-specific controls. The operating Relationship pipeline links to the Relationship stages editor rather than keeping an inline copy; CRM configuration is otherwise reached from CRM's own sidebar group and Home Configure menu. Finance owns price-book/payment configuration; General remains the sole currency editor. Work and Scheduling retain their existing route owners and share the Work configuration section projection.

Support configuration reads only `support_queues` and `support_service_levels` through existing RLS. It does not call `support_read` or fetch Cases/metrics. Its existing command contract still requires both `support.read` and `support.configure`; `ConfigTarget.requiresAll` records that prerequisite without changing database permissions. Operating queue triage stays at `/support/queues` and links to its canonical editor. AI keeps its agent/deployment/knowledge/tool routes and existing feature/management authority, with a shared configuration layout. Marketing and Automations expose no invented policy/configuration root; their currently implemented campaigns, rules, templates and activity remain operating surfaces. Studio's Configure control links to shared Branding/Public profile/Domains owners while website/forms/templates remain Studio operations.

`legacyConfigurationPath` resolves compatibility URLs through `CONFIG_TARGETS`. The request proxy returns HTTP redirects, preserving the request's query string and allowing browser fragment inheritance; fallback legacy pages redirect without reading protected data. Canonical pages independently call `requireConfigurationTarget`, `requireWorkspaceConfiguration`, or `requireOperatingArea` before reads. Layouts never grant page authority. Operator number-record access retains its existing independent gate and does not grant number management or call-history access.

Settings search combines offered Settings metadata with accessible `WORKSPACE_CONFIGURE` concerns, including targets omitted from the Settings directory, and deduplicates canonical paths. Stored Back to app paths must match current projected destinations and the most specific registered owner. Administration visibility uses only `loadPlatformContext`/`platformPermissions`; server Platform guards remain unchanged. Navigation receives a boolean activity-retention context from the organization telephone provider, never a device, credentials or tenant data. A link leaving the active call's organization or entering global personal Settings opens separately instead of replacing that layout.

Communications channel diagnostics are presentation over the existing `messagingSenders` calculation and sender/provider readiness owners. They add no sender, provider, entitlement, schema or publication authority. SMS catalog status remains unchanged; a planned feature is a blocker regardless of provider credentials or number state. Controlled local database/adapter tests establish command behavior, retries, event processing and tenant isolation. Live provider acceptance, actual delivery, incoming messages and threaded replies require separately configured sandbox providers and authorized recipients; absent those prerequisites they remain unverified.

### Consolidation verification and remaining acceptance

Local verification uses the repository fast suite, focused database and provider/API checks, and Playwright against an isolated production build with the existing local API and local Supabase database. No schema or permission migration is introduced.

- Resumed verification on 2026-10-13 passed the production build and TypeScript checks against checkpoint `3c21ffa` plus the subsequent UI standards and Work changes through `5554465`. Repository-wide lint passed with no errors and two existing unused-variable warnings in `field-service-acceptance.test.ts` and `travel-feasibility.test.ts`. The earlier focused diagnostic/navigation run passed 71 tests.
- The complete fast suite now passes all 2,625 checks: 1,699 Vitest tests across 151 files, 922 Python tests across 41 files, and four Node contracts. The five initial failures were stale static contracts: they now inspect the canonical App Library, and distinguish Appearance namespace filtering from Platform navigation. The three corrected contract files also passed a focused 58-test run. The new Work drawer component test is registered in `test-manifest.json`, so the classified fast command includes its configuration and permission checks.
- Controlled database verification passed 81 tests across messaging, sender eligibility, email send/channel/sending domains and Support. Mocked Python provider/API verification passed 118 tests across tenant email, SMS status, email provisioning and Resend contracts. These checks establish local behavior, not live provider delivery.
- The previous consolidation browser run passed all 28 Playwright checks against the production build and local API; this test-registration/documentation continuation makes no new rendered-interface claim. Browser checks cover authorized/restricted Platform entry, configuration-only entry and mutation, denied operating/direct routes, legacy query/fragment redirects, Settings return/search, personal Appearance, the operating Communications/routing workflow, and pop-out dialer draft persistence. Rendered workspace configuration screenshots were inspected at 1440, 768 and 390 pixels in light and dark modes, with reduced motion. AI Agent tools remain planned and their configuration entry is correctly denied; no catalogue state was changed for testing.
- A component check holds one mocked telephone SDK device and active call across ordinary same-organization navigation. Actual carrier call continuity remains unverified. Cross-organization and global personal Settings links preserve the current call tab; reload/browser termination continuation is not implemented.
- Live outbound SMS/email, provider acceptance/status callbacks, incoming messages and threaded replies remain pending authorized sandbox recipients and a configured sandbox provider environment. Configuration diagnostics and fixture records must never be described as successful delivery.

## Live inbound and receptionist execution

`app/domains/communications/routing.py` remains the only preview/runtime routing decision. `app/services/communications/inbound.py` composes machine-scoped snapshot reads with that resolver and the carrier adapter. `app/services/communications/voice_agent.py` composes spend admission, pinned credential lookup, external session creation, signed callbacks and canonical restricted transfer. Vendor HTTP/XML/HMAC live under `app/providers`. The external voice-agent project owns speech/agent execution; no agent internals or tenant database credentials cross this adapter. `/platform` owns its route tree and composes the shared shell independently of organization pages.

### CRM intake composition

`lib/domain/customers/classification.ts` owns the closed Contact classification vocabulary; existing Customer commands and IDs remain canonical. `lib/domain/integrations/{resources,mappings,import-runs}.ts` continues to own Library intake. CRM routes only link into that service. Provider refresh uses the existing Connections command and Library resource snapshot, never another OAuth or spreadsheet adapter. The existing mapping `sync_mode`, import run snapshots and external record links retain synchronization association and provenance. Every reviewed update returns through the same database apply command; missing source rows never invoke CRM deletion.

Contacts reads `listContactLastActivity` over the tenant-scoped `customer_activity` projection; CRM Dashboard reads `crm_relationship_overview` and `crm_recent_relationships`, security-invoker SQL reads over contacts, affiliations, events and tasks that store nothing new. Activity is read from canonical events rather than copied onto contacts. The existing timeline reader presents classification changes independently of relationship and opportunity stages.
