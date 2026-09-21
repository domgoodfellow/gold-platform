# Constraints and decisions

What this platform is, where each piece goes, and the decisions already taken.

Read the first two sections to understand the shape. Read *Rules that protect data* before
touching schema or auth. Read a decision record before changing the thing it governs.

**How to read a rule here.** There are two kinds and they are deliberately separated, because
they are not equally serious. Break a rule in *Rules that protect data* and a customer sees
another customer's rows, or a record you cannot reconstruct is destroyed. Break a rule in *Rules
that keep the code sane* and you lose an afternoon. Both are worth following. Only one is worth
stopping a release for.

**Nothing here says "never build this."** Unbuilt work is either active in `roadmap.md` with
acceptance criteria or in *Decided, not yet built* below with the event that starts it. If you
find a refusal with neither a milestone nor a trigger, that is a defect — report it.

---

## The guiding principle

> **80% platform + 15% configuration + 5% custom development.**

When a business says *"we do things differently,"* the first question is never *what do we
rebuild?* It is:

> **Which entity, workflow, rule, module, or integration represents that difference?**

If the answer is configuration, configure it. If it is a reusable capability, it becomes a
module. Only genuinely unique behaviour becomes custom code.

Everything else in this document is that principle applied to a specific fork in the road.

---

## The architecture layers

Every part of this platform sits in exactly one of these. Naming the layer is the first step in
any design conversation, because the rules that apply are different in each.

| Layer | What it is | Who changes it | Where it lives |
|---|---|---|---|
| **1. Foundation** | Shared tenant entities and services every Product relies on | Us, in migrations and domain code | `lib/domain/`, `supabase/migrations/` |
| **2. Engines and runtimes** | Code that owns load-bearing calculations or execution | Us, with invariant tests | `lib/domain/`, API runtime and database functions |
| **3. Product catalogue** | Products, Modules and Features packaged into Plans and Add-ons | Platform staff; resolved for each Subscription | Catalogue, commercial and entitlement rows |
| **4. Organization configuration** | What a business says about itself and how entitled capabilities behave | An organization administrator | Tenant-owned rows and product settings |
| **5. Provider control plane** | Capability bindings, resources, health, usage and cost | Platform staff initially; tenant scope where explicitly supported | Provider bindings/resources, Vault and usage ledger |

**The kernel is:** organizations, memberships, users (via Supabase auth), roles, customers,
locations, assets, documents, resources, operating hours, events, custom fields, statuses.

**Configuration is:** terminology, statuses, transitions, fields, forms, roles and their
capabilities, prices, hours, currency, timezone, automations, message templates, reports,
dashboards. None of it is hardcoded. All of it is rows the tenant owns.

**A module is not a directory.** It is a coherent functional area inside a customer-facing
Product. Current module rows and `MODULES` are a flatter implementation of that target model.
An engine is not a Product: Scheduling owns time/resource commitment while Booking, Maintenance
and Dispatch are policies and interfaces over it. See D25 and `domain-model.md`.

---

## The engines

Each owns entities and rules. This is the honest state, not the plan.

| Engine | What it owns | State |
|---|---|---|
| **Scheduling** | The calendar, availability, resource assignment, operating hours, double-booking | Built |
| **Pricing** | Price book, quoted lines, invoices, payments, job economics | Built |
| **Automation** | Rules, conditions, actions, message templates, deliveries, counters, external readings | Built |

Work, Booking, Maintenance, Dispatch, Voice, Communications, CRM, Insights and Customer
Experience are important Products, Modules or capabilities, but that does not make them engines.
AI is a horizontal Intelligence runtime. A future geographic route/travel optimizer may earn a
separate engine only when it owns an independent optimization problem.

**The calendar is part of the scheduling engine, and scheduling is an engine.** There is no
`calendars` table because a calendar is work items organised by time and resource — that is a
statement about the *schema*, not a demotion of the capability. `freeWindows`, the exclusion
constraint, operating hours and `listSchedule` are the engine. If a document ever reads as
though scheduling is only a view, it is written wrong.

---

## Where things go

The target shape. What exists today is a subset, and the missing directories arrive with their
first real caller rather than as empty folders.

```text
apps/
  web/                    Next.js. Every surface a browser reaches
    app/                  routes, grouped by whose surface it is
    components/           domain-agnostic design-system vocabulary
    features/             product-capability presentation and interaction
    lib/domain/           the business rules. Nothing else decides anything
    lib/adapters/         vendors, behind capabilities
  api/                    Python. Webhooks, the clock, the AI loop
    api/                  Vercel HTTP entrypoints — one file, one route
    app/core/             configuration, database handles, tokens
    app/ai/               the loop, the tool registry, the provider registry
    app/channels/         sending a message, as a capability
    app/conditions/       what the world is doing at a place
    app/providers/     the infrastructure GOLD operates — the only place Python names a provider
    app/connectors/    a business's own outside apps, one OAuth contract
  desktop/                Electron shell — M10
packages/                 types, schemas, ui, config — each with a real consumer inside apps/web (D45); sdk still waits, see D13
supabase/                 migrations, policies, snippets
docs/
```

**On `domains/` under `apps/api`.** The source architecture puts CRM, scheduling, dispatch,
inventory and the rest as Python packages. This platform does not, and the reason is D2 rather
than taste: **the transactional domain is TypeScript**, and Python is the second runtime for
what TypeScript cannot do — webhook ingress with no human session, a clock, a model loop. A
`domains/` tree in Python would be a second implementation of rules that already exist in
`lib/domain/`, which is the thing this whole document exists to prevent. The layer is real; it
lives on the other side.

**On `packages/`.** `types`, `schemas`, `ui` and `config` are built (D45) — each arrived with a
real, immediate consumer inside `apps/web`, not ahead of one: `@gold/types`'s `ContextDescriptor`
is what the context switcher and the organization resolver hand around, `@gold/schemas` validates
the invitation and support-session forms, `@gold/ui` holds the shadcn primitives extracted from
`apps/web/components/ui/`, and `@gold/config` holds the shared `tsconfig` the other three extend.
`packages/sdk` is still not built — see D13 and the *Deferred* table for its trigger.

---

## Rules that protect data

Break one of these and a customer sees another customer's rows, money is misreported, or a record
you cannot reconstruct is destroyed. `Held by` is what fails when somebody breaks it. **An empty
cell is an intention, not a guarantee.**

### Tenancy

| Rule | What breaks without it | Held by |
|---|---|---|
| Every tenant-owned table carries `organization_id`, has RLS keyed to it, and leads every unique index and exclusion constraint with it | One tenant's unassigned 9am job blocks another's; two tenants can never share a customer email | `schema-conformance.test.ts`, from `pg_class`, `pg_index` and `pg_constraint`, for every table in `public` |
| A reference from one tenant-owned table to another is composite — `(organization_id, id)` | A row naming your customer and another tenant's location. Every policy passes; RLS never objects | Composite keys with `unique (organization_id, id)` on the target. **RLS does not catch this one** |
| Tenant resolution goes through one function | A forgotten `WHERE` is a cross-tenant leak | `app.current_tenant_ids()`, and `app.current_external_tenant()` for the outside axis |
| A query is never scoped by application filtering alone | The same leak, one refactor later | RLS is the boundary; the application filter is an optimisation |
| Tenants are never separated by provisioning — no bucket, schema or project per tenant | Operational work that grows with every customer and proves nothing RLS has not | One schema; files in shared buckets under a tenant-scoped prefix, with `documents` as the authority |

### Security

| Rule | What breaks without it | Held by |
|---|---|---|
| Hiding a control is not authorization | The operation runs anyway | Every sensitive write is checked server-side and by a policy |
| A middleware redirect is not the authorization boundary | Same | `proxy.ts` refreshes the session; each page calls `requireOrganization` |
| No service-role key reaches a client | Total bypass of every policy above | `apps/web` holds the anon key only |
| An LLM gets domain tools with validation and permissions, or nothing | A second, undocumented implementation of the business, with database access | Tools are `stable`, `security invoker` Postgres functions run under the asker's own token (D34) |
| A private file is never on a durable public URL | Contracts, recordings and transcripts reachable by guessing | Private buckets; short-lived signed URLs minted after the same permission check |
| A stored destination resolves against a closed set | An open redirector | Validated on read as well as on write |

### Data

| Rule | What breaks without it | Held by |
|---|---|---|
| Money is integer minor units; currency is per-tenant and never assumed | Rounding errors in invoices, and a platform-chosen currency | Integer columns; `organizations.currency` is nullable because signing up does not ask |
| Time is `timestamptz`; the tenant's IANA zone is stored separately and applied at render | A job at the wrong hour in another country | No free-text time windows anywhere |
| History is never rewritten. Terms are snapshotted at commitment; a correction is a new row | Last month's invoice reporting this month's catalogue | The snapshot rule, and the missing foreign keys CLAUDE.md lists |
| Consequential writes are attributable — who, what, when, to which entity | No way to answer what happened | `events`, written on every consequential path |
| A migration that may have been applied is never modified | Two databases with the same version and different schemas | Corrections are new migrations |

### Where logic lives

| Rule | What breaks without it | Held by |
|---|---|---|
| Business rules live in the domain layer — not a component, route handler, server action, or AI tool | The rule is enforced in one place and forgotten in the next | Callers call; they do not decide |
| A rule needed by a second caller is extracted first, then called twice | Two copies that drift | Never copy a rule |
| The database enforces invariants; it does not run business workflows | The process is invisible to everyone reading the application | Constraints and triggers guard; they do not decide |
| Nothing is hardcoded that a business might want different | The per-client fork this platform exists to refuse | Terminology, statuses, prices, hours, buffers, currency, the working week — all rows |
| No claim a business makes about itself is hardcoded | The platform speaking in a tenant's voice on their own public page | `public-profile.test.ts` reads the public routes' source |
| The database is the source of truth — not React state, not a calendar, not a processor | Two answers to the same question | A vendor is authoritative for its own events only; external calendars sync one way, outward |

---

## Rules that keep the code sane

Break one of these and you lose an afternoon, not a customer. They are worth following. They are
not worth blocking a release for, and they are **not** the reason anything is unbuilt.

- **Write it concrete first.** In the domain layer, for the business in front of you, named for
  what it does. Extracting a proven function later is an afternoon. A directory named for a
  category it might one day belong to gets defended for a year because it looks like architecture.
- **A rule gets extracted at its second caller.** Another route, action or tool in this repository
  is enough, and can arrive in week one.
- **An engine gets named when it owns rules that two different business shapes both need.** Not
  before, because a single source cannot tell you which parts of itself were general.
- **No column, table or enum value without something using it in the same change.** A caller is a
  screen, a route, a domain function, a demo you are about to show, or an operator who needs it on
  Monday. It is not "a second existing call site" — that is the bar for extracting a function.
- **A workspace package waits for its second consumer.** One consumer buys a build step and a
  `dist/` for no isolation. Each package in the target tree has a trigger in *Deferred*.
- **A vendor goes behind an adapter.** Domain code names capabilities — *place a call*, *charge a
  card* — never providers. A domain file importing a vendor SDK means the adapter is missing.
  *Vendor* here always means a third-party service, never the packaging sense of the word.
- **A document waits for the code it describes.** See D8.

**This section's failure mode, stated so it stays checkable.** It has removed features that
should have shipped — module enablement was cut by applying the engine bar to a question about
what a tenant switches on, which is not code at all. **Before applying any rule here, name the
layer it governs and check that it is the layer in front of you.** These rules refuse speculative
*code*. They have never had anything to say about what a tenant turns on, what a screen shows, or
what you need in order to sell.

---

## Decisions

Each records a fork in the road and what was chosen. Cite them from code, migrations and pull
requests so the reasoning travels with the change. The full argument and every amendment is in
git history and `CHANGELOG.md`; what is here is the position as it stands.

### D1 — `tire-app-template` is a reference, not the base

**Decision.** Prior repositories are harvested for reasoning, never forked or vendored. Read the
pattern, cite the source, write it fresh against this schema.
**Why.** They are single-tenant. Everything they were free to hardcode is exactly what this
platform is not.

### D2 — Python is the second runtime; TypeScript owns the transactional domain

**Decision.** `lib/domain/` in TypeScript owns essentially every business rule and every
transactional write. Python owns what has no human session — webhook ingress, the clock, the
model loop — plus, since D51, a narrow, named set of commands genuinely reachable from more than
one caller.
**Why.** One transactional domain, one place a rule can live. Two would be two implementations.
**Rejected, narrowed by D51.** A *wholesale* Python domain layer mirroring `lib/domain/` —
`domains/crm`, `domains/scheduling` and the rest, as a second home for rules that have exactly one
caller today — stays rejected for the reason above. D51 is not that: it is two commands, named,
each with its TypeScript equivalent retired rather than duplicated.

### D3 — Python lives in `apps/api/`, and the workspace glob is explicit

**Decision.** `pnpm-workspace.yaml` names its members one at a time rather than globbing `apps/*`,
so pnpm never tries to manage the Python deployable.
**Why.** `apps/` means "a deployable this repository ships", and one of them is not a node package.
**Cost.** A new workspace package must add itself to that file by name.

### D4 — Shared-schema multi-tenancy with RLS, deployment-neutral

**Decision.** One database, one schema, every tenant-owned row carrying `organization_id`,
isolated by row-level security. A Private deployment is the identical code with one row in
`organizations`; Enterprise is the same in the customer's cloud.
**Why.** Isolation that is testable in one database and identical across all three deployment
tiers. This is the decision every other one rests on.
**Rejected.** Schema per tenant, database per tenant, project per tenant — operational work
growing linearly with customers, proving nothing RLS has not already proved.

### D5 — Field service is vertical one; the dialer is vertical two

**Decision.** Build field service first. The dialer is second.
**Why.** Field service exercises the harder half of the kernel — scheduling, geography, work
items, resource assignment — which are the primitives that generalise to maintenance and dispatch.
The dialer needs the realtime voice plane to exist first, and building the most latency-sensitive
component before a kernel means debugging streaming audio and a greenfield domain at once.
**Note.** The dialer remains the highest-margin product, and it is cheaper to build second once
customers, timeline and audit exist for it to attach to.

### D6 — Statuses are data, not enums

**Decision.** `work_item_statuses` and `work_item_transitions` are per-tenant rows. The platform
ships no status vocabulary and translates no status name.
**Why.** A status list is the first thing every business disagrees about. An enum is a migration
per customer.

### D7 — Custom fields are typed core columns plus a `custom` JSONB column

**Decision.** Fields the platform reasons about are real columns. Everything a tenant adds lives in
one JSONB column, governed by a registry in `field_definitions`.
**Why.** Queryable where it matters, unbounded where it does not.

**Which kinds exist is a platform decision, and the refusals carry the reasoning.** Six:
`text`, `number`, `boolean`, `select`, `multi_select`, `date`. Each has a coercion branch in
`parseCustom`, a validation branch in `app.check_custom_fields`, and a control in
`CustomFieldInputs` — a kind with fewer than three is a promise the field editor makes and
nothing keeps. Four more that the source conversation lists are **refused rather than deferred**,
each for a reason that does not expire:

- **A reference — customer, user, asset, location.** A foreign key inside `custom` is a foreign
  key no constraint can see: it accepts another tenant's id, satisfies every policy, and
  produces a row that joins to nothing. That is the failure I18 already refuses a JSONB filter
  column over, arriving on the write side. Pointing at another record is a typed column with a
  composite key, which is a migration and should be.
- **A currency amount.** Money is integer minor units in a currency the business names, and
  `organizations.currency` is nullable because signing up does not ask. An amount inside a JSONB
  blob has no currency beside it, is unreachable by `priceWorkItem`, invisible to every
  aggregate, and summable by accident into a number that means nothing.
- **A file.** `documents` is the file axis and carries storage paths, RLS and an owning entity.
  A second one inside a JSONB object is a path with no policy over it.
- **A formula.** A stored calculation is what I4 exists to forbid, arriving as configuration.

**A choice stores its own text, never an index or a generated id.** An index makes every stored
row depend on the order of a list somebody will reorder; an id makes a customer's service level
an opaque uuid no report, export or human can read. The cost is that renaming a choice is not
an edit — it is a new choice, and the old value stays where it is, which is I8 in the small.

### D8 — The documentation budget

**Decision.** Eight governing Markdown files in `docs/` until there is a paying tenant:
`constraints.md`, `domain-model.md`, `market.md`, `public-web-architecture.md`,
`roadmap.md`, `ui-spec.md`, `vision.md` and `walkthrough.md`. The archival source
`starting_conversation.txt` is non-governing and excluded. A new governing document requires
deleting or absorbing an existing one, or naming a decision made wrong *twice* without it.
**Never write:** naming conventions, cleanup rules, refactoring rules, import boundaries,
documentation maps, maintenance indexes, correction notes.
**Why.** `saas-agent-platform` reached fifty-three files including `CLEANUP_RULES.md` and
`MAINTENANCE_INDEX.md`. Documents that police sprawl are a symptom of it.
**Known defect: this budget counts files and the failure it prevents is not measured in files.**
Eight files reached sixty-five thousand words with no tenants, which is the same failure in a
different unit. A document that outgrows what a person will re-read has already broken the budget.

### D9 — Status is not tracked in markdown

**Decision.** Milestone definitions in `roadmap.md`, task state on the issue board, shipped work in
`CHANGELOG.md`. No checkboxes in any document.
**Why.** Nothing in git forces a checkbox to stay accurate.

### D10 — Edge Functions are infrastructure adjacency, never the business backend

**Decision.** Supabase Edge Functions may do infrastructure work at the database's edge. They never
hold business rules.
**Why.** A third runtime holding rules is a third place to look for them.

### D11 — Weather is an integration and a trigger, not an engine

**Decision.** Weather is a condition adapter and an automation trigger. It owns no entities.
**Why.** What businesses actually need is *this reading crossed this threshold, so do that*, which
is the automation engine with one more input. An engine would own forecasts nobody reads.
**Consequence.** Units are compared, never converted — a rule in one unit ignores a reading in
another, for the same reason money is never converted.

### D12 — E-commerce operations is a target vertical

**Decision.** Admitted. This record previously refused it.
**Why the reversal.** `price_book_items` is already a per-tenant catalogue. `work_item_costs`
already records a material consumed against a job — a stock movement without a stock level.
`locations` is already a place stock could sit. Ordered → Picked → Packed → Shipped is
`work_item_statuses`, which already refuses to be hardcoded. It needs no new kernel primitive.
**What it costs, stated rather than hidden.** Inventory is a real engine — stock levels, reorder
points, suppliers, warehouses — and it is a scope decision, not a free one.

### D13 — pnpm workspaces, no build orchestrator

**Decision.** pnpm, pinned through `packageManager`. One `pnpm-workspace.yaml`, at the root. The
root `check` is `pnpm -r --stream check`; each package owns its own gate. No Turbo.
**Why.** A dependency graph with one node does not need a scheduler.
**Rejected.** npm, whose workspace support is weaker where D3 needs it. Turbo, until there is a
graph worth scheduling.
**Trigger to revisit.** `packages/types`, `packages/schemas`, `packages/ui` and `packages/config`
are real now (D45), each with a real consumer inside `apps/web` — the dependency graph genuinely
has more than one node today. `pnpm -r` still rebuilds every package on every run regardless of
what changed; the trigger for Turbo specifically is the day that rebuild cost is felt, not merely
the day a second package exists.
**Note.** This rule governs build tooling only. It defers no feature. Code in `apps/web/lib/` is
fully built and shipped; it is simply not separately published.

### D14 — Next.js App Router, `@supabase/ssr`, one caller-JWT client per request

**Decision.** Exactly one place constructs a client for a web request —
`apps/web/lib/db/server.ts` — using `createServerClient` with the anon key.
**Why.** Every query then runs as the caller, under their own policies. A service-role client
would bypass the boundary the whole platform rests on.

### D15 — Raw SQL migrations, and generated database types checked in

**Decision.** Supabase CLI migrations, hand-written SQL. `database.types.ts` is generated and
committed; a stale one fails the gate.
**Why.** The schema is the product's spine, and an ORM's migration DSL cannot express RLS,
exclusion constraints or column grants. The types are checked in so the gate can catch drift.

### D16 — vitest against a real local Postgres, and the gate is typecheck, lint, test, build

**Decision.** Tests run against a real local Postgres with real RLS, as genuinely signed-in users.
**Why.** A policy cannot be proven by a fake, and a service-role client bypasses the thing under
test. Mocked tenancy tests prove nothing.

### D17 — Tenant identity reaches Postgres as the caller's own JWT

**Decision.** Identity arrives as the caller's token. Nothing re-derives a tenant from a URL, a
header or a parameter.
**Why.** A value the caller supplies is a value the caller can change. One id handed to another
session must return nothing, and RLS is what guarantees that.

### D18 — Custom fields land with the registry that governs them, inside M1

**Decision.** The `custom` column and `field_definitions` ship together.
**Why.** A JSONB column with no registry is a bag anything can go in, and the first business to
use it sets the shape forever.

### D19 — We do not own a users table, and a person-Resource is not a User

**Decision.** Identity is Supabase `auth.users`. A `resource` representing a technician is a
schedulable thing, not an account. The two are joined, never merged.
**Why.** A van is a resource and has no login. An office manager has a login and is never
scheduled. Merging them makes both wrong.

### D20 — Surface ownership and public distribution

**Decision.** Six surfaces: GOLD's own site, the organization operator shell, public booking,
the customer portal, Platform Context and authentication. Each has explicit ownership. The site
axis now has stable tenant-owned sites/pages,
typed homepage revisions, review/publish, and one renderer at GOLD's root. Arbitrary hostname
routing, custom domains, media management and legal-page authoring are active M16 work; this
first renderer does not imply those distribution features exist.
**What is shared.** One row of canonical profile copy per tenant, rendered at the top of any public surface:
display name, tagline, intro, contact, address. The line is that **a business's own voice carries
anything it claims, and the platform speaks only where it describes application state.** A
business that has configured nothing renders its own name and stops.
**Why booking and the portal waited.** Booking answers *what can I book, when, for how much*,
which is three invariants — one availability calculation, one price calculation, and availability
being advisory and re-asserted before commitment. Built before them, it would have carried its own
notion of both. The portal is a second identity model rather than more screens: a customer is not
a member and must never become one.
**Correction on the record.** "Marketing" was one word for two surfaces. GOLD's own front door was
never blocked and has rendered since M1; only a tenant's site was. See *Deferred* for the trigger,
which `market.md` has already moved up.

### D21 — Partial adoption is a supported shape, not a fork

**Decision.** A tenant may enable one module, keep their own system of record for everything else,
and still be a full tenant — identical code, invariants, isolation and support.
**Why.** They are not asking for a cheaper platform; they are asking for less of it. Charge the
real price of what they enabled. The reflex this refuses is discounting them into a lesser class.

### D22 — The external actor is one authorization axis, decided once

**Decision.** An outsider is a row in `external_actors` binding one `auth.users` id — from
anonymous sign-in — to **exactly one** organization. The scope function is
`app.current_external_tenant()`, which returns at most one uuid and is deliberately not
`app.current_tenant_ids()`.
**Why.** A customer must never hold a membership; a membership would put them inside the tenant
function and hand them the business.
**Load-bearing.** The binding is immutable and holds no `customer_id` — an outsider who can write
one can write somebody else's. `external_actors_one_tenant_per_user` is on `user_id` alone, which
is the tenancy rule inverted on purpose: one actor may never span two tenants. Every write about
the business goes through `create_booking`, whose first act is the scope check. A public URL
carries a slug, never a tenant id.
**A second, narrower caller.** GOLD's own demo and contact forms (`submit_public_inquiry`, which replaced
`request_workflow_review` from `20260909000001_a_workflow_review_leaves_no_way_back_in.sql` in
`20260928000001_gold_public_intake_and_homepage_revision.sql`) uses anonymous sign-in for the same
reason booking does — I11 needs a real actor — but writes no `external_actors` binding at all,
because there is nothing this caller should ever read back. The target organization is GOLD's own,
which is not a slug a visitor supplies but D42's problem exactly: no migration can name an id that
exists in one deployment, so it lives in `platform_settings`, set by hand
(`supabase/snippets/workflow-review-target.sql`), never accepted as a parameter the function
would otherwise have to trust.

### D23 — The interface has a decided visual language

**Decision.** One layered design system: `packages/ui` owns generic shadcn primitives,
`apps/web/components` owns generic composed application controls, and `apps/web/features`
owns product-capability UI. Both organization and platform shells use the shared shadcn Sidebar
through `AppShell`, with separate navigation models; the phone bottom bar remains an intentional
organization-shell adaptation. Colour roles and tenant brand values flow through variables.
`docs/ui-spec.md` holds the surfaces and acceptance rules.
**No colour is keyed to what a status means.** The platform does not know what a tenant's status
means; two words in two languages are the same shape of row.
**Ownership.** `app/` owns routes and server composition; `features/` owns product-capability UI;
`components/` owns domain-agnostic UI; reusable client interaction moves to `hooks/` only after
the repeated behavior exists. Caller count is an extraction signal, not the primary boundary.
**Settings is one organization Area, not a second application shell.** A first-class product
workspace has one canonical owner and is not repeated as a Settings destination — see
`docs/ui-spec.md` §2's Configuration section table and `lib/navigation.ts`'s `AREAS`.

### D24 — Web and API both deploy to Vercel, and that forbids a daemon

**Decision.** Both deployables are serverless functions on Vercel. Scheduled work is a cron
entry hitting an endpoint. No long-running process, no `workers/` directory.
**Why.** A daemon needs a host, a supervisor and a deployment story none of the three deployment
tiers has.

### D25 — A module is what a tenant enables; an engine is what owns rules

**Decision.** Two words, pinned apart. A **module** is a row, a switch and a billing line. An
**engine** is code that owns entities and rules. They are not one-to-one.
**Why it matters.** Module enablement was once removed by applying the engine bar to it, and
module enablement is not code — it is a thing a tenant turns on. Four modules can sit over one
engine, and CRM is a module with no engine at all.
**Consequence.** `MODULES` may never list something that cannot be switched off; that is the
kernel misfiled. A module hides what it owns *everywhere*, not only its own area. A module that
is configured inside another's screen declares that dependency.

**Amended for the canonical catalogue's Activation axis.** This module is opt-in — a business
starts with the operational core and switches on everything else deliberately (D41's four-state
table). The canonical Feature layer above it answers a different question with the opposite
default: an *entitled* Feature is active unless the organization deliberately disables it
(opt-out), because GOLD has already decided what it provides and a tenant's only lever is turning
an entitled, ordinary capability off. The two are not in tension — a legacy module a business has
never switched on is simply never entitled at the Feature layer, so there is nothing to opt out
of. See `domain-model.md`'s Activation/Readiness rows and `organization_feature_activation_overrides`.

### D26 — `apps/api` arrives at M4, and webhook ingress is what brings it

**Decision.** The Python deployable exists because providers and scheduled work call in with no
browser session. Its Vercel handlers live in `apps/api/api/`: Stripe webhook, automation tick,
AI ask, and Voice inbound, outbound, status and recording callbacks. Runtime implementation
lives under `apps/api/app/`.
**Why not a route in `apps/web`.** A second thing called *api*, inside the app that is not the
API. There is no `api/` directory under `apps/web` and none may be added.
**The trust paths differ deliberately.** Machine callbacks and cron use narrow Postgres roles
with no general table grants. The AI endpoint holds **no role** and forwards the asking person's
own token because somebody is sitting there.

### D27 — A tenant connects their own processor; GOLD never holds their keys or their money

**Decision.** Each tenant connects their own payment account. Funds move between the tenant and
their customer. GOLD is never in the flow.
**Why.** Holding a tenant's money makes this a payment facilitator, which is a different company
with different regulators.

### D28 — Historical platform-staff role mechanism (superseded by D45)

**Historical decision.** GOLD staff originally arrived as the `platform_staff` Postgres role
because `custom_access_token_hook` rewrote the token's role claim for a listed user.
**D45 supersedes that mechanism.** Staff authority is now checked live while the caller remains
`authenticated`; the security intent below remains historical context, not current setup advice.
Identity still reaches Postgres as the caller's own JWT.
**Why.** Every other caller narrows by construction; staff need the opposite — read across every
tenant while being a member of none. A membership would put a GOLD user id inside a tenant's rows.
**Load-bearing.** The role reads and writes nothing, enforced twice: no write policy names it,
*and* it holds no write grant on any table. `platform_tenants` runs `security_invoker` or it
becomes the service-role client this decision refuses. `platform_staff` carries no
`organization_id` and never will — not being scoped to a tenant is the point.

### D29 — One creation path, two doors

**Decision.** A business comes into existence either because GOLD provisioned it or because
somebody who registered founded it. Two doors, one creation path, one event.
**Why the split.** Standing a business up and configuring it are two acts by two parties. Staff
may bring a tenant into existence and may never reach into one that exists, so configuration
happens afterwards, by somebody inside.
**Consequence.** Registration stays open, because an account is not a tenant: provisioning names
an owner who must already exist. The staff member does not become a member of what they
provision, and the tenant's rows carry no GOLD user id anywhere.

### D30 — Postgres is the seam between the two runtimes

**Decision.** The automation runtime is in Postgres; the clock is in Python. Neither calls the
other — the handoff is a row.
**Why.** A rule tripped by a stranger's booking runs where there is no tenant in session; one
tripped by the tick runs where there is no person at all. One runtime, one set of rules.
**Load-bearing.** Each rule runs in its own subtransaction, so a rule a business wrote badly rolls
back its own work and leaves the customer's booking standing. An automation may not trigger an
automation: chaining is a feature, a cycle is an outage, and the rows cannot tell them apart. No
action computes what the domain layer owns — there is no action that prices and none that finds a
free slot.

### D31 — A switch leads to its inputs

**Decision.** Every module declares where it is configured. Turning one on renders a link to that
place, and the platform says what is still missing before it does anything.
**Why.** Card payments could be switched on while the section that connects an account was hidden,
so the business turned the switch on and the page said nothing — which from their side is what
finishing looks like.
**Two lines it does not cross.** It hides on a module, never on a role. Its sentences describe
application state only, never a word put in a tenant's mouth.

### D32 — The model drafts, a person applies, and the proposal is a row between them

**Decision.** A business describes itself, reads back a proposed configuration with the questions
the drafting could not answer, edits any part, and applies it through the same
`configureBusiness` the milestone test drives. There is no second configuration path.
**Load-bearing.** The drafting adapter holds no database handle and no domain writer — the model
reaches business state through nothing, which is stronger than a tool it may not misuse. Only a
draft is editable; the moment a proposal is applied it is frozen, so what was applied cannot be
rewritten to say something else. Applying adds no capability: every step is already gated by the
capability it needs.

### D33 — A tenant's own integrations are an axis, and the tenant holds the account

**Decision.** When a tenant connects their own calendar, accounting system or mailbox, the tenant
holds the account and the credential. GOLD stores a reference, never a shared key.
**Why.** The same reasoning as D27, on a second axis.

**Built, first slice — CSV/spreadsheet import into Customers**
(`20260914000001_a_tenant_connects_its_own_data_sources.sql`,
`20260914000002_an_import_run_snapshots_its_mapping_and_never_rewrites_it.sql`). Six tables:
`integration_connections` (a tenant's own authorization — RLS policy-gated like `customers`,
deliberately not `organization_provider_bindings`, which is D44's staff-provisioned axis and
assumes the wrong owner entirely), `integration_resources` (one sheet, tab or uploaded file
reachable through a connection), `integration_mappings` (source column → GOLD field, `target_entity`
closed to `'customer'` until a second one has a real caller — D7's "no seventh kind" discipline,
one axis over), `import_runs` (snapshots the mapping it used — I8, see I36 below), `import_staging_rows`
(one reviewed source row, durable), `external_record_links` (the idempotency backbone — I37). The
capability is `integration.manage`; `secret_id` on `integration_connections` is withheld from
every grant and written only through `store_integration_secret`, the same Vault shape D44's
`store_provider_secret` already uses (I34), reapplied to a tenant-writable table. CSV needs no
vendor handshake and is the first working connector; Google Sheets and any OAuth-based connector
land later as a `lib/adapters/` implementation, no schema change, per D44/I15's own reasoning
about where a vendor's name may live. `tests/integration/database/integrations.test.ts` proves idempotency (re-importing
the same file never duplicates a customer), tenancy isolation, capability refusal, and that
disconnecting a connection never reaches a customer already imported through it.

### D34 — A tool is a function in Postgres, run under the caller's own token

**Decision.** Every AI tool is a `stable`, `security invoker` Postgres function. Python holds only
its name, its sentence and its JSON schema.
**Why.** *At risk of being late* is a definition, and a definition in the other runtime is
business logic in the wrong place. Postgres refuses a write inside a non-volatile function, so the
tool layer cannot write by construction.
**The failure a tool layer invites.** A model chooses its arguments, so protection a model can
pick the value of is no protection. **RLS decides, and a model is never asked which business** —
the loop fills the id in and drops one the model supplies.
**Load-bearing.** This axis has no Postgres role, and that absence is the security model. A run is
readable by the person who asked and nobody else, and it records tool calls as a name, arguments
and a row count — never rows. **A conversation is the same boundary one level up:** runs belong to
an `agent_conversations` row readable only by its starter, a run cannot be filed under anybody
else's (a composite key carrying the asker and the business), and a follow-up sends the answering
side only the earlier *finished* questions and answers of that one conversation — text, never tool
rows — bounded by turn count and size in both runtimes. A New chat is nothing until its first
question, and its title is that question shortened, never a second model call. **A file attached
to a question is a Document, owned by the person and not by a record:** the same private bucket and
table, in an `agent/<person>/` namespace that only its owner can read, list or sign — the rest of the
business's documents stay the whole business's. What a model receives of one is text, and only
text: no PDF or image reader exists here, so the supported set is exactly text, Markdown, CSV and
JSON, checked as bytes and not by the browser's word, bounded, and sent with the turn it belongs to
only. Widening the set means adding the reader that consumes the new type in the same change. The loop writes nothing; an intended action is recorded as pending
and performed only when a person presses the button, mapped through a whitelist on the executing
side.

### D35 — An aggregate is a function in Postgres, and the calculation it agrees with stays in TypeScript

**Decision.** `invoiced_and_incurred` is one `stable`, `security invoker` function, read by the
Reports screen and by the AI loop. `priceWorkItem` stays the price calculation and moves nowhere.
**Why it is allowed at all.** Expressing the same rule twice is normally forbidden. It is admitted
here because a correspondence test totals the same invoices through both and fails on any
disagreement — the same mechanism that has always held the availability predicate honest across
the constraint and the query. When a tax or rounding rule lands, that test fails, which is the
event this rule exists to catch. Repair it by teaching the aggregate, never by relaxing the test.
**It says *invoiced*, never *revenue*.** Only invoiced and incurred are dated by something a
person chose. A group is keyed by an entity *and* a currency, because neither converts. No total
is stored, and none may be.

### D36 — A saved report is a row with an audience, and the audience is a policy

**Decision.** A report definition holds a measure, a grouping, a period and up to three typed
filters. Running one calls the same aggregate. Who may see it is a policy, never a filter in a
page.
**Why.** A report shared with a role the caller does not hold returns *no row*, which is what lets
one dashboard show different people different tiles with nothing in code deciding it.
**Consequence.** A dashboard has no audience of its own — who sees it follows from which of its
reports each viewer can read. A second role list would be a second thing to keep in step. The
platform seeds no dashboard.

### D37 — A demo business is a script that runs the real path, never a seed file

**Decision.** `pnpm demo` builds two populated businesses by calling the domain layer through the
same functions a person uses. It is covered by the gate, so a changed domain signature breaks the
build.
**Why not `seed.sql`.** It would run inside the test suite's own resets, and the suites would stop
exercising a genuinely empty database.
**Why it matters commercially.** The demo is how the product is shown, and showing it is how the
first tenant arrives. `run.ts` contains no branch on which business it is building; everything
that differs lives in `businesses.ts`. If it ever needs `if (business.name === …)`, the data model
is wrong.

---

## Decided, not yet built

Nothing here is refused. Each row names the event that starts it, and that event is a default for
*unprompted* work — the trigger this table waits on when nobody has said otherwise. It is not a
permission gate: being told to build one directly is itself the trigger, and does not wait for a
hypothetical customer to ask first. If you want one sooner, say so, or decide the trigger was
wrong and change this table.

| Thing | Waiting on | Trigger |
|---|---|---|
| `packages/sdk` | Somebody outside this repository integrating | The first tenant or partner who asks for an API. `apps/web` calls its own domain layer directly and needs no indirection layer in front of it — building one now would be the "empty package with no caller" shape this file already refuses elsewhere |
| **Geographic route/travel optimizer** | A distinct optimization problem beyond Scheduling's ownership of time and resource commitment | A route-shaped tenant whose daily work cannot be assigned adequately using the Scheduling engine |
| **Inventory engine** — stock levels, suppliers, purchase orders | D12 admits the vertical; the engine is a scope decision | An e-commerce or parts-heavy tenant |
| **Recurring maintenance plans** | Recurrence on a calendar — *every first Monday* — is a different question from an interval | A maintenance tenant with contracted plans |
| **Desktop** | M10 | No customer has asked |
| **Calendar recurrence** — *every first Monday* | A different question from an interval, which is built | A tenant whose plans are dated rather than metered |
| **Approval workflows** on work items | Changes the commitment flow | A business whose jobs need signing off before they proceed |
| **Richer message templates** — amount, address, who is coming, a link to the customer's own page | Nothing. It is a list rather than a mechanism | Each one must be fillable *reliably every time*; a placeholder that is sometimes blank is a sentence that is sometimes nonsense |
| **Drafting templates from what a business already sends** | Nothing structural — a template is still a row the business owns | The same shape as drafted configuration: propose, review, apply |
| **Group and proximity discounting** | Travel cost modelling, so a discount never exceeds what the business provably saved | A business that actually routes |

Website distribution, shared controls, theming, Voice, two-way email, terminology, reusable
business setup, platform-wide usage visibility and incumbent migration are no longer deferred:
they are built foundations or active roadmap work. Moving them out of this table does not claim
completion; `roadmap.md` owns their remaining acceptance criteria.

Two of these carry reasoning worth keeping in full, because finding it out later is expensive.

**A lead is a state of a customer, not a second kind of person.** When sales arrives, the
temptation is a `leads` table beside `customers`, then a `contacts` table beside both — at which
point one human being is three rows and every question about them is a union. The entity is the
person or company; *lead*, *opportunity* and *customer* are stages of the relationship. So
`customers` gains a lifecycle rather than a sibling, exactly as work did: a stage the tenant
configures and names in its own words. **Written down before it is built**, because the cost of
finding out afterwards is a migration that must decide which of three tables a given human was.
Still open: whether a lead appears in the customer list before it converts, and whether a work
item may reference one.

**Counter-triggered work has two behaviours that are not obvious and were found by building it.**
The first reading sets the mark and raises nothing — switching a rule on for a machine that has
already run nine hundred hours must not raise nine services that were done years ago. And the
mark advances by whole steps rather than to the reading, so a counter that jumps three intervals
leaves two still owing.

---

### D38 — Every call is a conference, and a party on it is a row

**Decision.** A call is a conference from its first second, including the ones nobody ever
transfers. A participant is one party's leg — its own provider identifier, status, and joining/
leaving (I2, I18 apply unchanged). The recording belongs to the conference, never to a leg.
**Why.** Hold, transfer, merge and a supervisor listening in are one structure — an operation on a
participant — not four features. A plain two-leg dial supports none of them: no third party to
add, nothing to mute, no way to hand the far end off without dropping the call.
**Rejected.** Upgrading to a conference only on transfer: a two-leg call can't become one without
the parties hearing it happen, so it means dropping and redialling mid-conversation, plus two dial
paths and two sets of callbacks to keep agreeing — the second-answer problem I4/I5 refuse one
level up. Waiting for a customer to ask for transfer: right everywhere else in this file, wrong
here, because the deferred cost isn't a later feature — it's rebuilding the one screen a floor
stares at for eight hours.
**Cost, stated rather than buried.** Billed per participant per minute, on every call, forever — a
fraction of a cent on all of them to buy something used on a few.
**Not decided here.** Whether an agent on a call is a scheduling `Resource` — an argument exists
and no caller yet; the answer arrives when dispatch and the floor have to share a person.

### D39 — The tenant's telephone account is a subaccount of GOLD's; what's stored is an identifier

**Decision.** GOLD holds the master carrier account; each business gets a subaccount, so one
business dialling from another's number is impossible at the carrier rather than merely prevented
in application code (I2, one layer further out). What's stored is a subaccount identifier — not a
credential, grants nothing alone.
**Why the opposite ownership from D27.** On payments the tenant holds the account because they
must be the merchant of record and their customers' money must never touch GOLD's balance.
Neither applies to a phone call — no customer money moves, and nothing requires the business to
hold the account — so what carries over from D27 is the *storage* rule (identifier, never a
secret), not the ownership.
**Rejected.** A business pasting a carrier auth token into a settings form — a real credential
needing rotation and revocation, the shape D27 already refused (D33 names this as why a tenant's
own integrations are an axis, not built yet). The tenant's own carrier account as the default —
`market.md`'s buyer has no system, and "open a carrier account, register your brand, buy a
number" is four reasons not to start. **It remains the escape hatch** for a business arriving with
numbers and a reputation already attached, authorizing GOLD from their own account.
**A suspended or failed subaccount is a row, not a log line** (D33's rule, I25's shape) — a
business whose calls have stopped is told why by the application, not by silence.

### D40 — Reaching people is paid for in advance, and a balance is a sum

**Decision.** A business buys a pack of credit; calls draw it down; at zero, dialling stops.
Nobody can spend money they haven't already handed over.
**Why not metering.** Count-the-minutes-bill-monthly is a utility company — invoices, arrears,
dunning, credit risk — a different business from the one `market.md` describes, adopted to
support one feature.
**Load-bearing.** A balance is a sum of a ledger (`communication_credits`, append-only, signed),
never a column (I4) — `public.credit_balance` is the one answer. The refusal lives where the
spend starts: `open_call` asks `app.may_spend_on` before it writes a room, long before the carrier
is asked. Nobody signed in may add credit — no policy on `communication_credits` permits an
insert, for anyone, staff included (I21); money in arrives only through a payment via a machine
role, the same shape `payment_webhook` already established.
**A rate is GOLD's price, written by migration** — `communication_rates` carries no
`organization_id` (outside I2 the way `platform_staff` is, not in breach of it), and there is no
application write path. Nothing is seeded: with no rate for a channel, that channel costs nothing
and refuses nothing, so every existing tenant keeps working unchanged.
**Not built here:** the purchase itself — a tenant paying GOLD is a charge on GOLD's own processor
account, the opposite direction and a different code path from D27. Until it exists, a purse is
filled by migration or not at all.
**One thing unsolved:** the spread — a rate exists per currency (amounts never convert, I10), so
GOLD carries the difference between a tenant's own-currency balance and what the carrier bills in
its.

---

### D41 — A module is wanted and paid for, and those are two rows

**Built.** The owner gave the trigger directly, as part of the wider commercial/financial
control plane D43 records. What follows is the decision as specified before it was built;
where the built shape amends it, the amendment is D43's and is named there rather than
silently rewritten in here.

**Decision.** `organization_modules` keeps answering one question only: *does this business want
this module.* A person with `organization.manage` switches it, and D25 is untouched. A second,
append-only table answers the other question: *what has been paid for, and through when.* A
**term** — organization, module key, the period it covers, and its price and currency snapshotted
onto the row (I8) — never updated, only superseded. What a business actually gets is the
**intersection**, computed inside `listEnabledModules` itself so that none of its callers can
forget it.

**Why this shape.** It is D40's, one level up. A balance is a sum of a ledger and never a column;
an entitlement is a term that covers now and never a flag. Neither is a stored total (I4).

**Four states, where there were two.** The middle two are the ones that make this worth building.

| Wanted | Paid | What the business sees |
|---|---|---|
| yes | yes | On |
| yes | no | Screens hidden, **nothing deleted**, and Settings says why |
| no | yes | *You are paying for this and it is switched off* |
| no | no | Absent — not part of this business, so nothing to explain (D25) |

**Load-bearing.**
- **A lapse hides screens and takes nothing away.** No row is deleted, no write path is closed
  retroactively, and the business is told in a sentence. Hiding it in silence is exactly the D31
  failure card payments already shipped once.
- **Nobody signed in writes a term.** No insert policy admits `authenticated`, staff included
  (I21). **Amended by D43**: there is no Stripe integration yet, so the writer is not the
  machine role this record originally imagined — it is `public.record_commercial_term`, one
  `SECURITY DEFINER` function checking `platform_staff` and granted `execute` to that role
  alone, the `provision_organization` shape rather than the `payment_webhook` one. The table
  itself still admits no insert from any role directly, staff included.
- **A price is GOLD's.** No `organization_id` (outside I2 the way `communication_rates` and
  `platform_staff` are), per currency, and nothing seeded — a module with no price costs
  nothing and refuses nothing, so every existing tenant keeps working unchanged. **Amended by
  D43** in the same direction as the term itself: `platform_provider_rates` and
  `platform_retail_rates` are written through `public.record_provider_rate` /
  `public.record_retail_rate`, staff-only `SECURITY DEFINER` functions, rather than by
  migration alone — `communication_rates` (D40) is untouched and still migration-only.
- **No RLS policy reads any of this.** D25's rule survives the arrival of money: a module is
  navigation and billing, never authorization, and a lapsed subscription must never become an
  access control decision.

**A trial stops being a special case.** Founding writes zero-price terms with an end date instead
of switching modules on for free, so `app.enable_default_modules` becomes
`app.grant_founding_terms`. A trial expiring is a term ending — no expiry flag, no second code
path, nothing to remember.

**Rejected.** An `expires_at` column on `organization_modules`: it is the stored total I4 refuses,
and updating it would lose the fact that the module was ever off — the same reason that table has
no update policy today. Merging terms into `communication_credits`: a term is dated and a balance
is drawn down, and forcing a fixed subscription price into a balance rebuilds the metering utility
D40 refused.

**Target enforcement behavior: an unpaid module goes read-only, and never goes dark.** Writes to
what that module owns must be refused, with a sentence naming the module and the date its term
ended. Reads and export remain available. Today the generalized resolution model computes this
state, but only `card_payments` enforces it at its write boundary; M17 owns complete applicable
coverage.

**Amended: deactivation is now a fact this table's own absence of a row can no longer prove
alone.** Before `organization_feature_activation_overrides` existed, "wanted, no term" (row two of
the table above) was the only shape that distinguished a business that never asked for a module
from one that switched it off deliberately — and it conflated that with paid-but-lapsed. The
canonical Feature layer now records a deliberate opt-out as its own fact, independent of whether a
term exists at all (`domain-model.md`'s Activation row). This table's own four states are
unchanged and still legacy-load-bearing; the backfill migration
(`20260921000001`) reads exactly one of them — paid, wanted-absent — as the one case with
independent evidence of a deliberate deactivation worth preserving as an override.

**Refused by a trigger, not by a policy**, and that distinction is D25 surviving contact with
money. No RLS policy consults entitlement. A policy makes rows disappear and cannot explain
itself, so a late webhook or a term boundary an hour out becomes an operator locked out mid-shift
with `permission denied` and nothing to read. A trigger is the shape this schema already uses
wherever a refusal has to say why — `app.check_status_transition`,
`app.check_work_item_update_capability` — and unlike a check in the domain layer it also holds
against a caller reaching PostgREST directly.

**A write that spends is already refused one level down.** `open_call` asks `app.may_spend_on`
before it writes a room, because that write costs GOLD money at a carrier. Entitlement is the
slower, commercial half of the same idea; it does not duplicate that check and does not replace
it.

**Which tables a module owns has to be written down**, because nothing records it today —
`MODULES` names where a module is *configured*, not what it *owns*. **Only partly done.** The
generic trigger, `app.check_module_entitlement`, is attached to exactly one table in this
slice — `payment_accounts` (`card_payments`) — chosen as the smallest complete example rather
than because the other five optional modules own nothing. Booking's, the portal's, assistant's
and reception's own tables are an explicitly named gap, not a covered one; there is no
conformance test yet asserting every module-owning table carries the trigger, because the map
this bullet calls for has not been written for the rest of them. That is the next slice's
opening line, not a defect in this one — see D43.

### D42 — GOLD dogfoods as an ordinary tenant (account split superseded by D45)

**Current decision.** GOLD-the-business is a tenant with no exemption of any kind. One identity
may simultaneously hold platform authority and ordinary memberships, including membership in
GOLD's own organization. Platform authority and organization membership are separate security
facts, not separate visual applications.

**Operating context.** GOLD's own organization is the canonical dogfood/operating workspace for
GOLD staff who are actual members of it. Global Platform tools are reached from that GOLD
workspace when the actor also has platform authority. Neither fact substitutes for the other.

**Why a tenant at all.** This file's own *Known defects* section already says GOLD dogfoods its
own Organization Context exactly as any other business does, and that what GOLD's own use needs
counts as evidence. Reception's first real user is GOLD's own sales calls, which is the module it
most needs to sell.

**Load-bearing.** No branch anywhere names GOLD's organization id, and no code path is reserved
for it. Its modules are ordinary D41 terms at zero price — the same rows a paying customer's
purchase writes, for the reason D37 gives about the demo builder: a seeded exception is a path
nobody tests. The SQL that grants them lives in `supabase/snippets/`, not in a migration,
because a migration cannot name an organization id that only exists in one deployment. No signed-in
person may write one either way; D41's rule is unchanged.

**Two money paths, and they must not be confused.** The `billing` module is a tenant invoicing
*their* customers, and D27 keeps GOLD out of that flow entirely. A tenant paying GOLD is D41's
ledger, on GOLD's own processor account, in the opposite direction. GOLD's tenant may well use
`billing` for its own consulting invoices; subscription revenue never travels through it.

**Historical note.** Session-claimed staffhood was once deferred as an escape from two logins.
D45 instead implemented live authority checks and a context switcher, so that deferral is closed.

---

### D43 — GOLD's own commercial/financial control plane, and what it amends

**Access-mechanism note.** This record predates D45. References below to grants or functions
being available to the `platform_staff` Postgres role describe the historical mechanism; D45's
live `app.is_platform_staff()`/`app.require_platform_staff()` checks are current.

**Decision.** GOLD can now answer, for any tenant: what it bought, what it is entitled to use
right now, what GOLD charged it, what it used, what that usage cost GOLD at a provider, and the
margin between the two. D41's entitlement **resolution model** is the middle of this and is
built in full; enforcement remains partial and is separately qualified below. The rest
generalizes D40's usage thinking past
voice, SMS and email to every meter this platform will eventually price — call recording,
transcription, text-to-speech, AI tokens, email sends, and whatever a future provider adds.

**The catalogue, and a correction found writing the first provider bindings against it.**
`platform_meters` (what can be metered) and `platform_products` (what GOLD sells, recurring: the
base platform, one row per real module, a seat) are platform vocabulary, migration-written, like
`communication_channel` was. Neither is authorization and neither is read by any policy.
These are the current persistence model: `platform_products` rows are sellable line items,
not the canonical customer-facing Product families, and `organization_commercial_terms` are
not yet Plans or Subscriptions. The target vocabulary and correspondence are authoritative in
`domain-model.md`; migration must preserve current facts without pretending the target exists.
**A
meter first shipped naming one provider each — `transcription_seconds` said `deepgram`,
`ai_tokens_input` said `anthropic` — which cannot express Deepgram *or* ElevenLabs both
transcribing, or an OpenAI-compatible host sitting beside Anthropic on the same meter.**
Corrected: `platform_meters` carries no provider column at all, and a new table,
`platform_providers`, names who can be paid — vocabulary of the same kind, seeded the same way.
A meter describes consumption; a provider is who answered it, for a given reading. This changes
no historical usage's meaning — a row already saying `voice_minutes` still does.

**Two rate cards, not one, and neither is `communication_rates`.** `platform_provider_rates` is
what GOLD pays a named provider, keyed by `(provider, meter, currency, effective date)` now
rather than by meter alone — the same correction one level down, since two providers pricing one
meter needs two rows, not a table that can only hold one. `platform_retail_rates` is what GOLD
charges, for every meter except voice, SMS and email, whose retail price stays
`communication_rates` (D40) rather than being duplicated; it carries no provider dimension at
all, because a business is charged one retail price per meter regardless of which vendor GOLD
used underneath it. Both are append-only and effective-dated — "current" is the latest approved
row at or before a moment, never an edited one — and both carry `unit_amount_micros`: millionths
of one minor currency unit, because a provider's wholesale price is routinely sub-cent, and
rounding that to the nearest minor unit before multiplying by volume would make a margin wrong by
construction. This is a narrow, deliberate amendment to I10's minor-units rule — for a *rate*
only, never for a recorded amount. `usage_events`, the generalized ledger this record adds
alongside D40's purse, snapshots a provider cost and a customer charge, **each in its own
currency** — the correction below — and every total this platform actually discloses still
rounds to a minor unit exactly once, at the point it is shown.

**The bug this record corrects, stated plainly.** `usage_events` first held one `currency`
column for both facts, and `charge_for_call` looked up GOLD's own wholesale rate using the
*tenant's* currency — treating "what does this Canadian business trade in" as though it answered
"what does Twilio bill GOLD in," which are unrelated. `usage_events` now carries
`provider_currency` and `customer_currency` separately; `app.provider_rate_at` is asked for a
provider and a meter and answers with whichever currency that provider's own rate was recorded
in, rather than being told one to look for. **Nothing converts between the two.**
`public.organization_commercial_summary` groups by both currencies together and reports
`margin_minor` as null whenever they disagree and the cost is not exactly zero (a true zero
needs no exchange rate to subtract) — the same rule `jobEconomics` already holds across a
tenant's own currencies (I10), and the same open question D40 named on the day it shipped voice
("one thing unsolved: the spread"). This record keeps it unsolved rather than solving it
quietly. If this repository ever builds a real conversion, it is a rate with a date and a
snapshot of which one was used (I8), never a division performed inside a report.

**Reconciliation is a second table, not a second row on the first.** `usage_events` is immutable
once written — no update grant reaches it, and the `provider_cost_status` column an earlier
version of this record carried (implying a row could move from `estimated` to `reconciled` in
place) is gone; that implied mutability contradicted "immutable" in the same paragraph.
`usage_cost_reconciliations` is the correction, keyed to one usage event, append-only, carrying
GOLD's real cost and nothing else — no quantity column, no customer-charge column, so a
correction can never duplicate either. `public.record_usage_reconciliation` is its one door,
staff-checked today for the same reason the rate functions are: there is no provider-sync
machine role yet, and that axis arrives with provider bindings rather than being invented early.
The aggregate uses the latest reconciliation in place of the estimate it corrects, never the sum
of both; `public.organization_usage_detail` keeps the original estimate visible next to whatever
corrected it, permanently.

**The first amendment to D40 and D41: a rate and a term are no longer written by migration
alone.** Both records said staff hold no write grant on any table, and both still do — no table
grant changed. What is new is one door each: `public.record_provider_rate`,
`public.record_retail_rate` and `public.record_commercial_term`, three `SECURITY DEFINER`
functions checking `platform_staff` (`app.require_platform_staff`, extracted once for all three
rather than copied) and granted `execute` to that role alone, the exact shape
`provision_organization` already used for the first staff write D28 ever allowed. The reason is
literal: D41 imagined the term's writer as a machine role on a webhook, because it assumed a
payment integration would exist by the time this shipped. There is no Stripe integration yet
(deliberately — internal commercial truth has to exist before payment collection), so the writer
today is a person at GOLD recording what was actually sold, through the narrowest door this
schema knows how to build.

**Entitlement changes what a self-serve module switch does, and that is the point rather than a
side effect.** Before this record, flipping any module on in Settings (or naming one in a
configuration proposal, D32) worked immediately. After it, only the founding modules
(`app.grant_founding_terms` — billing and guided setup, replacing `app.enable_default_modules`)
carry a term from the start; anything switched on afterward sits in D41's second state — wanted,
not paid — until GOLD records a term. Every business that already had a module enabled before
this migration was backfilled a zero-price, open-ended term for it, so nothing already working
stopped working the day it shipped; the demo builder (D37) was updated the same way for whatever
it enables beyond the founding set, so `pnpm demo` keeps showing a fully usable business.

**Two claims that sound like one and are not: the entitlement model, and its enforcement
coverage.** D41's model — the wanted∩paid intersection, the four states, `usable_modules`,
`module_commercial_state` — is built in full and holds for every module; there is no module for
which the *computation* is wrong or partial. Its *enforcement* is a different, narrower claim:
`app.check_module_entitlement` is a generic trigger, and it is attached in this slice to exactly
one table — `payment_accounts` (`card_payments`) — proven rather than assumed to work. The map
of which table each of the other five optional modules owns has not been written for booking,
the portal, the assistant or reception, and the trigger is not on any of their tables yet. Read
"D41 is built" as the first claim only; the second is tracked here and in `domain-model.md`'s I28
so that an empty `Held by` cell for the other five never gets mistaken for the first.

**GOLD's own cost, a reconciliation of it, and the margin either implies are never a
tenant-visible row.** `platform_provider_rates` and `usage_cost_reconciliations` grant `select`
to `platform_staff` only. `usage_events`'s grant to `authenticated` names every column except
`provider_key`, `provider_currency` and `provider_cost_micros` — a column grant, not a row-level
policy, because RLS cannot withhold one column of a row it otherwise allows. Which vendor GOLD
uses is withheld by the same mechanism as what GOLD pays it: neither is a tenant's business.
`public.organization_commercial_summary` and `public.organization_usage_detail`, the only two
functions that ever compute or disclose a margin or a reconciled cost, are granted to
`platform_staff` alone. A tenant's own "Plan & usage" screen (Settings) reads a disjoint set of
functions that never return the withheld columns at all — belt and braces, not either on its
own.

**GOLD selling GOLD stays a different axis from a tenant selling its own customers (D42,
restated a third time).** This record's domain code lives in `lib/domain/commercial/`, never
`lib/domain/billing/` — the `billing` module is a tenant's own price book and invoices, and
folding GOLD's subscription revenue into the same directory would invite exactly the confusion
D42 already named once.

**Not built here, named rather than skipped.** The provider-sync job itself — actually calling a
vendor's billing API to produce a reconciliation automatically (`platform_provider_sync_failures`
exists and reads empty, the same shape `platform_failures` had between M5 and M6, and
`public.record_usage_reconciliation` is staff-only until that job's machine role exists to widen
the grant onto); a real currency conversion, should this platform ever build one, with a
snapshotted rate and date rather than a division inside a report; an AI cost analyst drafting a
provider rate from a source (`approval_state` on both rate tables exists for exactly this, and
nothing writes a draft yet); Stripe, on either side of this ledger; and the remaining five
modules' entitlement maps named above. **Provider bindings — an organization actually choosing
which provider answers which meter, Vault, provisioning — arrived in D44, the record directly
below.**

---

### D44 — An organization's own scope inside a provider, and where a generated secret lives

**Decision.** GOLD can now record which external provider scope belongs to which organization —
a Twilio subaccount, a Resend sending domain — and what GOLD created inside that scope, without
turning `platform_providers` (D43's vocabulary) into a credentials table. Two new tenant-owned
tables carry it: `organization_provider_bindings` (organization → provider → external scope →
lifecycle) and `organization_provider_resources` (one externally created thing beneath a
binding — a subaccount, an API key's public half, a phone number, a sender domain). Neither
carries a secret. Twilio is the one provider proven end to end in this record — a real
subaccount, a real generated API key, a real application — because D39 already gave it a
concrete resource model to prove; Resend gets only what a sending domain needs (D40's own
"nothing is metered until it costs something" restated for infrastructure); Deepgram, ElevenLabs
and model inference get nothing, because nothing yet calls for a binding of their own — D43's
provider vocabulary already lets their usage name a provider without one.

**Not every provider gets a subaccount, and the schema does not pretend otherwise.**
`external_account_id` on a binding is nullable, and no column, trigger or check assumes it is
set. A binding can be `active` with no external account at all — Resend's shape, one platform
account with a business's own domain named beneath it.

**Vault, enabled for exactly one kind of fact.** GOLD's own master credentials (a Twilio account
SID and auth token, a Resend platform key) stay deployment environment secrets, unchanged (D54 adds an opt-in, Vault-held account beside them) — D14
already refused a database as the place a person reads those from, and Vault existing does not
reopen that. What Vault holds is narrower: a credential *this platform generates* per
organization — today, a Twilio subaccount's own API key secret — that must be retained for a
future server-side use and never existed in any deployment's environment to begin with.

**The write door that only ever writes.** `public.store_provider_secret` is the one function
that ever calls `vault.create_secret` or `vault.update_secret` (rotation reuses the same vault
row rather than a second live secret), and it returns the *resource id* it just acted on — never
the vault row's own id, never the secret. No function anywhere selects a secret back out, and no
role — not `authenticated`, not `platform_staff` — holds `select` on `vault.secrets` or
`vault.decrypted_secrets` at all. The distinction this rests on: staff necessarily holds a
generated secret in memory for the one moment it is created, because there is no other way to
create it; what must never exist is a second moment, later, where that value can be asked for
again through this API. `organization_provider_resources.secret_id` — the pointer into Vault —
is withheld from every grant for the same reason `usage_events` withholds GOLD's own cost from a
tenant (D43): nobody needs to read a vault reference back through PostgREST, and a column grant
that could be read is a column grant that eventually will be.

**Provisioning is application code calling a real vendor API, recorded through the same narrow
functions as everything else on this axis.** `lib/adapters/telephony` grew a fourth and fifth
capability — `telephonyProvisioner()` (create a subaccount, an API key, an application) beside
the existing `telephonyProvider()` (place a call, mint a browser token) — using GOLD's *master*
credentials throughout, never a subaccount's own. That works because Twilio lets a parent
account's credentials address any of its subaccounts by naming that subaccount's SID in the
request path; `telephonyProvider` grew exactly that one argument, `actingAccountSid`, and every
call it makes on behalf of a provisioned business happens inside that business's own scope
without a second credential existing anywhere. `lib/domain/providers/twilio-provisioning.ts`
orchestrates the real lifecycle — subaccount, then key, then application, each recorded through
`begin_provider_binding` / `record_provider_resource` / `store_provider_secret` — and is
idempotent by construction: every step first asks what this organization's binding already has
and calls the vendor only for what is missing, so pressing "provision" again after a failure
resumes rather than duplicates. A failure is `organization_provider_bindings.status = 'failed'`
and its own `last_error`, written before the calling code ever sees an exception — durable state,
never only a thrown toast.

**A vendor's name still never reaches the domain layer (I15), including as a resource-type
literal.** The first draft of this record typed `organization_provider_resources.resourceType`
as a union of strings like `'twilio_subaccount'`, and wrote `providerKey: 'twilio'` directly
inside `lib/domain/providers/`. `adapters.test.ts`'s second assertion — the one that scans for the
word itself, not only the import — caught both. `resourceType` is `string`, exactly as opaque as
`externalId` already was; the literal strings belong to `lib/adapters/telephony/registry.ts`
alone (`telephonyProviderKey()`, `TELEPHONY_RESOURCE_TYPES`), the one file I15 has always allowed
to know a carrier's name, and every domain file asks it rather than spelling one.

**Two facts, not one, about a phone number.** `organization_provider_resources` is *"this E.164
number belongs to this organization's Twilio scope"* — a provider fact. `telephony_settings` is
*"this organization chose this number as its default outbound identity"* — a tenant fact,
unchanged in shape since D39's own migration. They stay two tables. What changes is that
`set_calling_number` (recreated, D15 — a signature can be reused, a body cannot be edited) now
refuses a number already bound to a *different* organization. A number nobody has ever bound to
anybody stays exactly as free-text-settable as before this record: most businesses on this
deployment have provisioned nothing yet, and requiring a binding before dialling would be a
different, larger change than this slice asked for. The check itself needed its own `security
definer` helper, `app.phone_number_owner` — `set_calling_number` stays `security invoker`, and an
invoker-mode query against `organization_provider_resources` runs under the *caller's own* RLS,
which can only ever see that caller's own rows and would silently pass every cross-tenant number
by simply failing to notice it belonged to somebody else. The same reason `app.has_capability` and
`app.current_tenant_ids()` are themselves `security definer`.

**A tenant naming its own sending domain is a tenant door, not a staff one.** Unlike Twilio,
Resend has no subaccount for staff to provision first — the only new fact is a business's own
choice of domain, the same shape as choosing a calling number. `public.record_organization_email_domain`
is `security definer` only because there is no RLS policy yet on these two tables to lean on (D40's
"staff hold no table grant" extends to every role, tenant included, on the *new* tables), checking
`organization.manage` inline exactly as `telephony_settings_insert` already does declaratively.
Verifying a domain, once bound, is staff's own door (`set_provider_resource_status`) until a real
Resend-facing verification check exists to widen that grant — the same deferral D43 already made
for reconciliation's machine role.

**Not built here.** Actually calling Resend's or Twilio's verification/status APIs to confirm a
domain or a number automatically; a per-organization Deepgram, ElevenLabs or model-inference
account of any kind (D43's provider vocabulary already lets usage name one without a binding, and
nothing yet needs more); a browser voice token signed by a business's *own* generated API key
rather than GOLD's master one — the deeper secret-resolution-at-the-moment-of-signing problem,
which would need either a second trusted execution context this repository does not have today
or a cryptographic construction inside Postgres this repository has never used, and building
either speculatively, before a softphone screen exists to call it, is exactly what D23 already
refuses; externally managed OAuth credentials (D33's axis, untouched); Activepieces; MCP or any
external agent-tool grant; the Asset/Template Library; call transcription or AI call analysis;
realtime voice agents; QuickBooks or bank integrations; and NextFund's own migration.

---

### D45 — Platform Context and Organization Context are two independently-true facts, and platform authority stops being a Postgres role a session had to choose

**Decision.** "Platform Context" and "Organization Context" are the two names for where a caller
is acting — restating D28/D42 under words that also name what changed. GOLD dogfoods the
Organization Context path exactly as any other business does (D42; no exemption of any kind);
what this record retires is the assumption that a single caller could hold only one of the two
contexts at once. Before this migration
(`supabase/migrations/20260915000001_platform_staff_is_checked_not_worn.sql`), a user listed in
`platform_staff` had their JWT `role` claim rewritten from `authenticated` to a separate
`platform_staff` Postgres role at sign-in — D28's own words said the consequence plainly:
"somebody who is both staff and a member of an organization loses the membership half while
signed in ... one human who both runs GOLD and operates a tenant needs two sign-ins." That was
D28 working as designed, and it is also the thing the owner said explicitly not to want.

**What changed, mechanically.** `app.is_platform_staff()` (boolean, for a policy predicate) and
the pre-existing `app.require_platform_staff()` (raises, for a function body) both read
`platform_staff` live, under whichever role the caller already is — never a role swap, never a
claim. Every table `platform_staff` used to read via a role-scoped `using (true)` policy now
reads it via `for select to authenticated using (app.is_platform_staff())` instead, additive to
whatever member-facing policy the table already had; every "narrow door" write function
(`provision_organization`, `record_provider_rate`, `record_commercial_term`, and the rest) widens
its `execute` grant to `authenticated` and keeps the same internal staff check it already had —
the grant stopped being the enforcement, and the check the writers already carried is what was
already actually holding.

**The one place a grant alone was the enforcement, corrected rather than carried forward.**
`organization_commercial_summary` and `organization_usage_detail` were `security invoker`,
reading `usage_events`'s withheld columns (`provider_key`, `provider_currency`,
`provider_cost_micros`, I29) under whichever role called them — safe only because
`platform_staff`'s role-scoped grant was the sole path to them. A column grant is not
row-conditional, so once staff are `authenticated` too, invoker mode can never reach those
columns for anyone, staff included. Both are now `security definer`, with
`app.require_platform_staff()` as their first statement — the same shape every other narrow-door
function already uses, applied here to a read instead of a write. `usage_events` and
`usage_cost_reconciliations` themselves are untouched: `authenticated` still cannot select the
withheld columns directly, for any row, and `usage_cost_reconciliations` keeps no grant to
`authenticated` at all, on purpose, since nothing in the domain layer reads it except through
that now-guarded function.

**I21's enforcement mechanism moved, and this file says so rather than softening the invariant.**
I21 used to be held by privilege absence specifically — `platform-staff.test.ts` asserted a
literal `permission denied`, and the gap between a missing grant and a declining policy was the
whole of the guarantee. It is now held by a live check instead, the same standing `app.
has_capability` already has under I16 ("a function that raises on the check counts as enforcing
it, even with no policy of its own"). What I21 claims — staff read everything, write nothing
belonging to a tenant that already exists — has not weakened; a table staff have no legitimate
reason to touch (`memberships` inserts, `platform_staff` inserts) still has no grant to
`authenticated` at all and still fails on a missing privilege, unchanged.

**A staff-only console view needed its own guard, found while widening the grant.**
`platform_tenants` (a security_invoker view, staff console only) had no tenant-facing purpose but
also no guard of its own — its whole protection was that nobody but `platform_staff` could reach
it. `organizations` already carries a legitimate member-facing policy, so opening the view's
grant to `authenticated` without more would have let an ordinary member read their own
organization back through a view meant only for the console. Corrected with a
`where app.is_platform_staff()` clause in the view body itself — the same shape the two functions
above needed, one level up. `platformOverview` (`apps/web/lib/domain/platform/overview.ts`), a
TypeScript composition over several of these readers, had the identical latent problem one layer
higher: its "staff only" behaviour was accidental, inherited from whichever underlying read used
to fail first for a non-staff caller. It now checks `isPlatformStaff()` explicitly, itself,
before composing anything.

**Support access is a third, explicit, session-scoped fact — separate from both authority and
membership, and it grants nothing.** `platform_support_sessions` records that and why a staff
member opened one organization from the platform console; `start_support_session`/
`end_support_session` are staff-checked narrow doors, the `record_provider_resource` shape.
**It widens no read.** `platform_staff` already reads `organizations` and `memberships` in full
(D28); a session is the audit trail for that action, not a new path to it — `listMembersForSupport`
reads `memberships` exactly as it always could, `roles` still untouched (staff have never held
`select` on it, and this record does not add it, so a support view shows a member's display name
without their role's name — a real, named gap, not an oversight). **Not built here:** the RLS
widening that would let a support session reach a tenant's own operational tables (customers,
work items, and the rest) — a real, separate, future slice, deliberately not a side effect of
this one.

**The organization's top ordinary role is named `Admin`, and it is tenant vocabulary, not an
authorization primitive.** `FOUNDING_ROLE` (`apps/web/lib/domain/tenancy/organizations.ts`)
changed from `'Owner'` to `'Admin'` — a change to the platform's own *default word*, nothing
more: `roles.name` was already tenant-owned data (D6), capabilities are the only thing
`app.has_capability` has ever checked, and nothing anywhere gained a branch on this string. A
narrow, one-time data migration
(`supabase/migrations/20260915000002_the_founding_role_is_called_admin.sql`) renames existing
seed-created rows named exactly `Owner` holding exactly the founding capability set — the
platform correcting its own default, the same latitude this file already grants "before a paying
tenant" elsewhere — and leaves alone any role a business already renamed or that holds a
different capability set under that name, since either could only mean a business chose it
themselves. Stated once, plainly: an organization `admin` administers that organization only, and
platform authority (`platform_staff`) is a separate axis that this name never implies.

**Organization invitations close the gap `add_member_by_email` left**
(`supabase/migrations/20260915000003_organization_invitations.sql`) — inviting somebody who does
not have an account yet. Modeled on `customer_portal_invites`, with the one difference that
matters: a portal link is view-only and stores its token in plaintext, stated as a shared-
document-link security model; this grants a role, so `organization_invitations` stores only a
`sha256` hash, returns the plaintext once to the caller who made it, and `accept_invitation`
hashes the presented token the same way before comparing. `role.manage` is reused rather than a
new capability — inviting is the authority `add_member_by_email` already required. Acceptance
additionally refuses unless the accepting account's own email matches the invited address, higher
stakes than the portal's view-only link accepts.

**The package layer arrives, each with an immediate consumer, per this file's own trigger
table.** `packages/types`, `packages/schemas`, `packages/ui`, `packages/config` are real now —
`@gold/types`'s `ContextDescriptor` is what the context switcher and the organization resolver
hand around; `@gold/schemas` validates the two new forms this record adds; `@gold/ui` holds the
shadcn primitives extracted from `apps/web/components/ui/` verbatim (plus `Alert`, `Dialog`,
`Table`, `Badge`, this record's own first callers) as subpath exports
(`@gold/ui/components/<name>`), never one barrel; `@gold/config` holds the shared `tsconfig`
those three now extend. This is "being told to build one directly is itself the trigger," stated
in that table's own words, not a rule broken. **`packages/sdk` stays deferred** — nothing inside
this repository needs an indirection layer in front of its own domain calls, and building one
with no real caller is exactly the "empty package" shape this file already refuses.

**Subsequent UI convergence.** Teams remain deferred for the reason in `domain-model.md`.
Organization routes and `/platform/*` now use the same operator shell. GOLD staff operating in
the canonical GOLD Internal organization see ordinary GOLD navigation plus a Platform section;
customer organizations never receive that section.

---

### D46 — Catalogue, Plans, Subscriptions and Entitlements are separate facts

**Decision.** The canonical chain is Product catalogue → Plans and Add-ons → an organization's
Subscription → resolved Entitlements and Limits → organization configuration → provider
capabilities/bindings/resources → runtime → Usage, Cost and Health. Products are CRM,
Communications, Operations, Financial Operations, Automation, Insights and Customer Experience.
Modules and Features sit beneath them. Existing `platform_products` and commercial-term rows
are migration inputs, not evidence that the target Plan/Subscription model is already built.
Entitlements are distinct from RBAC capabilities. See `domain-model.md` for exact terms.

### D47 — BusinessOS is shared context, not an eighth Product or a second data model

**Decision.** BusinessOS names the shared identity, purpose, audience, Business Offerings,
voice, policies, brand and operating context Products consume. Extend Organization, profiles,
brand settings and other precise existing owners. Customer Experience projects that context to
public surfaces; it does not own it. Business Offerings describe what is offered; Financial
Operations' Price Book governs what is charged. BusinessOS is context, never a generic rules
dump: Pricing, Scheduling, Financial Operations and Automation retain their deterministic rules.

### D48 — Intelligence is horizontal and providers supply capabilities

**Decision.** Intelligence owns model-provider routing, fallback, budgets, quotas, concurrency,
metering, cost, health, audit, tools, safety and agents. Product AI features stay in their
Products; GOLD Intelligence may package them as an Add-on. AI Receptionist is a Solution
composed from Voice, Automation, CRM and Intelligence. Product code depends on abstract provider
capabilities, never supplier brands. Local model bindings are Platform Context only initially;
tenant-managed endpoints, credentials and model choice remain deferred.

### D49 — Platform hardened means routine operation needs no developer back channel

**Decision.** A capability is not operationally hardened while normal catalogue, subscription,
organization configuration, provider provisioning, health, drift, retry, usage or support work
requires Claude, VS Code, GitHub, Supabase Studio, manual SQL, a provider console or environment
editing. The pre-NextFund gate in `roadmap.md` makes these control surfaces and recovery paths
acceptance criteria, not optional polish.

---

### D50 — The canonical catalogue and Plans are additive, alongside the legacy commercial layer, never a replacement of it

**Decision.** `platform_catalog_products` (seven rows, locked by key), `platform_catalog_modules`,
`platform_catalog_features`, `platform_catalog_feature_dependencies` and
`platform_catalog_runtime_mappings` are the canonical Product → Module → Feature hierarchy D46
named. `platform_plans` (kind `plan` or `addon`), three typed grant tables, `platform_plan_quotas`
and `platform_plan_prices` are Plans/Add-ons above it. `organization_plan_assignments`,
`organization_plan_agreements` and `organization_plan_quota_overrides` are one organization's
provenance. None of this renames, joins against for authorization, or reduces the load-bearing
status of `platform_products`, `MODULES`, `organization_modules`, `organization_commercial_terms`,
or any other table D41/D43/D44 already built — a legacy organization with no Plan assignment
resolves exactly as it did before this record, because nothing in its path changed.

**Why a many-to-many runtime mapping table rather than a column on the legacy Product.** A single
runtime module can implement pieces of more than one canonical Product — `reception` backs
Communications/Voice's inbound and outbound calling *and* CRM/Sales' pipeline and stages, at once.
A `family_key` column on `platform_products` (an earlier draft's shape) can only ever say one
thing about one row. `platform_catalog_runtime_mappings` is the seam instead: one canonical
Feature may carry several mappings (`module_key`, `product_key`, `capability_key`, `provider_key`,
or `kernel` for an always-on kernel entity with no module to switch), and the same legacy key may
back Features under several different canonical Products.

**Why three typed grant tables and not one polymorphic one.** I18 already refuses a polymorphic
`(entity_type, entity_id)` attachment outside `events`, for the same reason a JSONB reference
column is refused in D7: it accepts a value no foreign key can see. A Plan's entitlement grant at
Product grain, Module grain and Feature grain are three tables instead, each a real foreign key
into its own target — the same fix this schema already used for `document.created`'s owning id.

**Why a whole-Product or whole-Module grant only ever covers `available` Features.** Granting a
Product must never silently promise a planned or partial Feature runs today. Resolution
(`app.plan_grants_feature`) checks `implementation_state = 'available'` at the moment it is asked,
computed fresh rather than snapshotted onto the grant row (I41) — the same "computed, never
stored" reasoning I4 and I5 already hold for price and availability, applied to entitlement.

**Why assigning a Plan never writes `organization_modules` or `organization_commercial_terms`.** A
draft of this record had `record_plan_assignment` also switch on the Plan's modules, to make one
staff action fully self-sufficient. That would have been staff reaching into an *existing*
organization's own operational state (`organization_modules`, the "wanted" axis a business
configures for itself, D25) — the one thing D29 refuses even though it already permits staff to
record a commercial fact (a term, now also a Plan assignment) about that same organization. A Plan
assignment is therefore pure provenance for the paid/entitled side; the organization still
switches its own modules on, exactly as before, and a platform staff member who is also an
ordinary member of GOLD's own organization does exactly that in Organization Context (D42).

**Why a Plan's standard price is never the sum of its Features' list prices.** Feature-level list
prices (where they exist, on legacy `platform_products` via `platform_product_prices`) describe
what a component might cost standalone; a Plan's own `platform_plan_prices` is a separate,
directly-set number, append-only and effective-dated exactly like every other rate card in this
schema. An organization's negotiated `organization_plan_agreements` overrides the standard price
from its own `effective_from` onward without rewriting either the standard history or an earlier
agreement — `organization_plan_price` reads the latest applicable row of whichever table wins.

**GOLD Internal is seeded as a Plan definition by this migration, and assigned to GOLD's own
organization by nobody this migration names.** The same D42 reasoning `platform_meters` and the
founding modules already rest on: a migration cannot name an organization id that exists in only
one deployment. The Plan (`billable = false`, every current Product granted whole, structured
quotas, metering left on) is platform vocabulary and belongs in a migration; assigning it to
GOLD's own organization is a platform-staff action performed once through the ordinary Plan &
Entitlements UI this record also ships — proving that UI by using it, rather than a snippet.

### D51 — `apps/api/app/domains/` exists, narrowly, superseding D2's rejection of it

**Decision.** D2 rejected "a Python domain layer with `domains/crm`, `domains/scheduling` and the
rest" outright. That rejection was of a *wholesale* move and stays correct as one — `lib/domain/`
in TypeScript remains authoritative for essentially every business rule and every transactional
write this platform has. What D2 did not anticipate, and what this record narrows it to, is a
single, named exception: a business operation reachable from more than one caller (a person's
browser, an AI tool, a worker) that would otherwise need its own copy in each. The first two are
`apps/api/app/domains/crm/stages.py::change_customer_stage` and
`apps/api/app/domains/communications/voice/wrap_up.py::wrap_up_call`.

**Why these two, and not more.** Both already had a narrow, single-purpose Postgres write worth
giving its own RPC (`change_customer_stage`, `record_call_outcome` — see the migration that adds
them), and both are genuinely reachable from more than one caller in the near term (a pipeline
board an AI tool could move a card on; a call wrap-up an AI call-summary tool could file). A
command with exactly one caller today stays in `lib/domain/`, in TypeScript, where D2's original
reasoning — one transactional domain, one place a rule can live — still fully applies.

**The shape, reusing D34's rather than inventing a second one.** Every command under
`apps/api/app/domains/` is `security invoker`, calls one narrow Postgres RPC, and forwards the
caller's own access token rather than minting one — `app.core.caller.call_command`, the write
sibling of D34's `call_tool`. There is still no Postgres role for this axis and nothing here
authorizes anything RLS would not authorize again a moment later; a domain module's own job is
translating what the database said (`app.domains.errors`), not deciding on its own account.

**Load-bearing.** `apps/web/lib/api/` is the one place `apps/web` calls one of these commands, and
a route's server action is the one caller of that — no feature component calls `fetch` itself.
Postgres keeps every tenant/RLS/invariant guarantee unchanged: `customers_update` and
`calls_update` are exactly as they were, and the two new functions add no grant a table-wide
policy would have to widen. When an existing TypeScript command moves here, it is retired rather
than kept running in parallel — `recordCallOutcome` (formerly in
`apps/web/lib/domain/reception/calls.ts`) no longer exists; `updateCustomer`'s own stage-changing
path was deliberately left alone because it remains a different act (see that function's own
comment for why moving a card from a board and correcting a customer's details in one sitting are
not the same operation, even though both touch `customers.stage_id`).

### D52 — `apps/api/app/auth/` is the one place a human caller's Supabase token is checked

**Decision.** Before this record, `api/ai_ask.py`, `api/crm_change_customer_stage.py` and
`api/voice_wrap_up_call.py` each wrote their own `presented.startswith("Bearer ")` and forwarded
whatever followed unexamined — a rule a second caller should have extracted rather than copied
(CLAUDE.md's own line on this), copied a third time by the time this was noticed.
`apps/api/app/auth/` is now that one place: `bearer.py` parses the header, `supabase.py` verifies
the token, `context.py` defines the immutable `CallerContext` a handler receives, and
`guards.py::require_caller` composes the three. All three domain-command handlers call it now.

**What it answers, and what it deliberately does not.** *Is this token well-formed, unexpired,
for this project, and — when the project's keys allow it — genuinely signed by Supabase* is the
whole of it. It resolves a user id and exposes Supabase's own claims (including the JWT `role`,
read-only, never branched on) but authorizes nothing: RLS, `app/domains/**`'s own commands, and
`app.is_platform_staff()` remain the only things that decide what a caller may do, exactly as
D17's "identity arrives as a JWT; Postgres decides" already held. Folding a permission decision
into this package would be the mistake D25 already named once on a different axis — the answer
here is the same one D34 gives the AI loop: authenticate once, forward the same token, let
Postgres re-decide.

**Two verification mechanisms, never a third.** `supabase.py` reads the token's own JOSE header
only to choose which one — that field is untrusted input and grants nothing by itself. An
asymmetric-algorithm token (`RS256`/`ES256`/`EdDSA`, the current signing-key architecture) is
verified locally: `PyJWT`'s `PyJWKClient` fetches the target project's public keys from its JWKS
discovery endpoint (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`, cached, re-fetched on an
unrecognised key id), and the signature, issuer, audience and expiry are all checked against it.
An `HS256` token (the legacy shared-secret generation) is verified by asking Supabase's own Auth
server — `GET /auth/v1/user` with the caller's bearer token and this deployment's publishable
key — because this decision refuses to hold `SUPABASE_JWT_SECRET` for a human path, and a 200
from that endpoint is Supabase itself vouching for the token exactly as a local signature check
would. **Both finish in the same place: an identity this process did not assume, but that
something authoritative actually checked.** There is no mode where an unverified claim is read
and treated as good enough to build a `CallerContext` from, and none where a project's tokens go
unverified merely because it has not migrated signing generations yet — item 8's own rule against
calling the legacy path "reduced assurance": it differs from the JWKS path only in being a
networked check rather than a local one, never in what it establishes.

**Fails closed on infrastructure trouble, always.** A JWKS endpoint or Supabase Auth that cannot
be reached, times out, or answers 5xx raises `AuthError(503, ...)` — never treated as "checked and
fine." Only Supabase's own explicit refusal (a non-2xx that is not a server error) becomes the
ordinary `401`. `test_auth.py` proves this for both mechanisms: unreachable JWKS, an unrecognised
key id, an unreachable Auth server, and a Supabase Auth `5xx` are each distinct from an outright
`401`, and none of the four authenticates anybody.

`SUPABASE_JWT_SECRET` — Supabase's legacy shared HS256 secret, and the same one `app.core.db` and
`app.core.runner` mint short-lived machine tokens with (D26) — is never read on this path, by
either mechanism; `verify_access_token`'s own signature carries no such parameter.
`SETUP.md`'s "Human-auth pre-flight" records which state the hosted project is actually in, and
that a project need not migrate before this code is safe to run.

**Load-bearing.** `SUPABASE_ANON_KEY` becomes `SUPABASE_PUBLISHABLE_KEY` throughout
`apps/api/app/core/config.py`, matching `apps/web`'s `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; the
legacy name is read only as a fallback (`_publishable_key()`), and nowhere does anything prefer it
over the current name. `SUPABASE_JWT_SECRET` remains exactly as narrowly scoped as D26 already
made it — three machine Postgres roles, no table grant, no human path — and this decision does
not widen or replace it; migrating it away is tracked separately (`SETUP.md`, "SUPABASE_JWT_SECRET
pre-flight (machine roles only)") and stays open.

---

## Known defects in this document

Recorded rather than quietly fixed, because a constraints file that hides its own faults is
advice.

- **D8's budget counts files.** The failure it exists to prevent is not measured in files. See D8.
- **The evidence bar has no exit for a pre-revenue product.** Admissible evidence is prior
  repositories or a signed customer. The prior repositories are finite and all from one author, so
  "two independent pieces" is weaker than it sounds. The resolution in practice is that **the demo
  is a caller** — GOLD dogfoods its own Organization Context exactly as any other business does
  (D42, D45; no exemption, and no "tenant zero" special-casing anywhere), and what GOLD's own use
  needs in order to be shown to a prospect counts as evidence. `market.md` says this already; this
  file now agrees with it.
- **`market.md` and this file once disagreed about the tenant marketing surface.** M16 now owns
  public distribution while `market.md` owns demand and commercial hypotheses.

### D53 — Setup is a lifecycle the shell and every entry follow, and a map of configuration that lives elsewhere

**Decision.** While `operationalState === 'setup'`, a business is entered through `/setup`, the
sidebar and the phone bottom bar each carry one Setup item — navigation only, no count, since Setup
owns progress — and Home carries no setup chrome (it once held a sentence pointing back; a
setup business is entered through Setup and the row is always there, so the sentence was a third
affordance). After Launch the row stops, on its own: the layout reads the state once and hands both
renderings the same value, Launch revalidates the layout and lands on Home, and Setup stays
reviewable from Settings' *Setup & launch* entry, worded so Launch never sounds available again. Setup lists *areas*, never fields, and every area links to the workspace that owns its
configuration; nothing on `/setup` edits a business. Importance is only what the domain already
says: `required` is exactly what `organization_launch_blockers` names (I27), `recommended` is a
switched-on module with a note that does not block, and `optional` is kernel configuration (work,
resources, locations), which `computeReadiness` already refuses to make a requirement. Drafting is
one optional card on the page; the areas and Launch render outside every drafting condition.

**Why.** Setup had seven separate manifestations — a sidebar call to action, a header badge, a
readiness widget on Home, a banner, a section on `/setup`, a Settings card and a creation redirect
that depended on whether drafting existed — and none of them agreed. One lifecycle state, one entry
decision (`organizationHomeHref`, I44) and one place that lists areas replaces them.

**Not done, deliberately.** No area is made *required* to fill a fuller-looking cockpit: a Business
(currency, profile) or Connections area would need a fact the domain does not hold, and a required
Work area would contradict the launch blockers. Readiness reads wanted modules, not wanted ∩ paid
(D41), as `computeReadiness` always has.


### D54 — A GOLD provider account is a row with a write-only credential, used by one runtime

**Decision.** GOLD's own account with an upstream provider (the Twilio parent) is a row in
`platform_provider_accounts`, beside the three older nouns: a **provider account** is the
GOLD-owned upstream account; an **organization provider binding** (D44) is the scope provisioned
for one organization beneath it, and now records which account it lives under; an **organization
provider resource** is one safe thing inside that scope; an **integration connection** is a
tenant's own authorization to an outside system and is a different owner and a different table.
The credential is written to Vault by `store_provider_account_credential`, which returns the
account id and nothing else. A row exposes `credential_set_at` and no more.

**The one exception to D44's "nothing selects a secret back out", stated exactly.**
`read_provider_account_credential` returns a decrypted credential, and is executable by a new
machine role, `provider_operator`, and by no signed-in role. Only `apps/api` can wear it, and only
after proving through RLS that the human asking is platform staff
(`app/domains/providers/operations.py`). A function granted to `authenticated` would let a staff
member read the secret from a browser console, which is why using a stored credential is not done
in `apps/web`: that runtime holds no signing secret and must not (D14). `provider_operator` holds
no table grant and exactly two executes — the reader and `record_provider_account_verification`,
so that only the runtime that actually asked the provider can mark an account verified. It is the
fourth role on `SUPABASE_JWT_SECRET`'s legacy path; `app/core/db.py` says not to widen that path,
and this widens it by one role deliberately, narrowly and on record. Retiring it is the same
migration the other three wait on.

**Deployment credentials keep working.** A binding with no `provider_account_id` is a bootstrap
binding: it keeps provisioning, retrying and placing calls from the deployment's own environment
exactly as before, and is never moved under an account by a retry. Only a new organization is
placed under the provider's default account. Runtime call placement (`telephonyProvider`,
`apps/api`'s voice handlers) still reads the environment; giving it a Vault-held credential is not
built.

**Reconciliation reports; it does not repair.** It compares a provider's own subaccount list with
GOLD's bindings and records *in sync / missing / changed* on each binding. A subaccount GOLD does
not know is listed and never adopted; a missing one is never recreated; no status moves. Disabling
an account stops new provisioning under it and touches nothing existing.

### D55 — A connector is catalogue data, and is neither a provider nor a connection

**Decision.** The outside apps GOLD knows about are rows in `platform_connectors`: key, name,
category, optional suite, `planned`/`beta`/`live`, auth and connection method, public or private,
and the GOLD capabilities it takes part in. Three nouns, three owners: a **provider**
(`platform_providers`, D44) is who GOLD buys infrastructure from; a **connector** is an outside app
a business may authorize; an **integration connection** (D33) is one business's actual
authorization to one connector, and now names a connector by foreign key. A catalogue edit never
rewrites a connection.

**Status is enforced, not displayed.** `integration_connections_insert` requires a connector that
is `beta` or `live` and that the caller can see, so a planned or private connector is refused by
the table, whichever door is used. A private row is visible to platform staff alone.

**Two descriptions.** `description` is in-product; `marketing_summary` and `marketing_description`
are public copy an admin edits without touching anything that runs.

**Not built yet, on purpose.** There is no write door and no public read; the staff editor and the
published catalogue arrive with the screens that call them. Rows arrive by seed.

**Capability vocabulary.** The Integrations area gates on `app_connections`, `file_imports`,
`data_mapping`, `scheduled_sync`, `triggers_actions` and `agent_tools`, Features under CRM → Data.
`csv_import` is renamed `file_imports`: it named one connector, and the capability is importing a
file.

### D56 — A tenant's OAuth credential is written by the API, read by the API, and never by a person

**Decision.** A business connects an outside app (Google Workspace, Microsoft 365) by signing in
at the vendor; the tenant holds the account and GOLD stores a reference (D33). The whole handshake
runs in `apps/api` (`app/domains/integrations/`), because the credential it produces is readable
by exactly one machine role and only that runtime can wear it (D14, D26). `apps/web` relays: it
forwards the caller's own token and a browser's one-time values, and holds no token, no vendor
client secret and no state-signing secret.

**The reader is `integration_operator`, and D54's exception is repeated, not widened.** It holds no
table grant and exactly five executes: read a credential, store one, record a connection's health,
replace what a connection can reach, clear a credential. It is the fifth role on
`SUPABASE_JWT_SECRET`'s legacy path, added deliberately, narrowly and on record; retiring it is the
same migration the other four wait on. A signed-in role cannot execute any of the five, so a
business cannot mark its own connection healthy and a staff token cannot read a tenant's credential
from a browser console.

**Authorization is proved before a credential is touched, and RLS proves it.** The API asks
`can_manage_integrations` under the caller's own token and selects the connection row the same
way; only then does it mint the machine token. A `state` is signed, ten minutes old at most, names
the business, the person, the connector and the nonce, and is completed only by the same person
holding the same browser's cookie.

**One contract, six connectors.** `app/connectors/base.py` is the handshake, the refresh and
two reads (who is this account; what can it reach). Google Workspace, Microsoft 365, HubSpot,
Notion, Slack and Dropbox each implement it in one small file. A difference between them is
absorbed by the base or by an override, never by the domain: Microsoft rotates every refresh
token; Notion exchanges a code with Basic credentials and a JSON body and issues tokens that
never expire (`default_expires_in`); Slack reports a refusal as HTTP 200 with `ok: false`;
Dropbox is POST-only. Salesforce, QuickBooks and Shopify are still `planned` because each needs
a value from the person before the handshake (an instance, a company, a shop domain) that this
contract has no place to carry. That is the signal to extend the base, in the change that adds
one of them.

**Connected is not permitted.** A connection says a business authorized an outside app.
`assistant_resource_grants` is the separate decision: a person with `integration.manage` names
each *resource* GOLD's assistant may read. Absence is the default, a resource a later sync
discovers starts ungranted, and `public.assistant_may_read_resource` also requires the resource
and its connection to be active, so disconnecting ends the assistant's reach without a delete.
Read is the only access; a write grant arrives with the first tool that writes. No assistant tool
calls the check yet.

**Health is the provider's words.** `integration_connections.last_error` holds what the vendor
said, is visible to the business, and is written only by the runtime that asked. A refused refresh
marks the connection *needs attention* and does not delete its credential; Disconnect does.

**A correction.** D33 and `20260914000001` claimed `secret_id` was withheld from every grant.
`select` had been granted table-wide, so a business could read the Vault pointer. `20260929000005`
re-grants `select` by column without it.

**Not built.** No write scope, no scheduled sync and no webhook from a vendor: the connection
proves itself when a person checks it. Microsoft's grant is removed in the person's own account;
GOLD deletes its copy.

### D57 — Commercial service access is derived, enforced at the request, and never a stored flag

**Decision.** Whether a business may use GOLD's operational surfaces is one derived answer,
`resolveServiceAccess` in `lib/domain/platform-billing/service-access.ts`, read from two facts
that already exist: the current base Plan's `billable` flag and the processor's cached
subscription. A billable Plan needs a subscription whose status the one mapping
(`SERVICEABLE_SUBSCRIPTION_STATUS`) calls serviceable — today `active` and `trialing`; every other
status, and no subscription at all, locks. A non-billable Plan (GOLD Internal) and a business with
no current base Plan are never locked. Nothing is stored: an `is_paid` or `locked` column would be
a second copy of those two facts.

**It is enforced where a request is decided, not by navigation and not by RLS.** `requireOrganization`
answers membership and then service, and every page, server action and route handler inside a
business calls it. `requireOrganizationForBillingRecovery` is the one named door past the service
question — for the shell layout, Plan & usage, checkout, the portal and the locked screen — and its
users are a closed list a test holds. No RLS policy reads it (D25: a lapsed term is not an access
policy), which is also why locking writes nothing: data is refused a door, never deleted, disabled or
rewritten. Authentication is a separate question and is unaffected; platform administration does not
pass through this guard at all.

**Deferred edges, recorded rather than guessed.** `past_due` locks immediately; a grace period is a
one-line change to the mapping. A Plan assignment that has lapsed reads as *no current Plan* and so
as unlocked. A locked business cannot reach General settings, so one with no currency cannot start
Checkout until staff set it. The Python runtime (`apps/api`) and the OAuth callback do not yet
consult the policy.

### D58 — An organization is Home, its workspaces and Settings; the operator's taxonomy is not the catalogue's

**Decision.** The organization shell is *Home*, a set of *workspaces*, and *Settings*. Home is an
adaptive business dashboard, not a renamed list of today's appointments, and it draws a block only
when its capability is entitled and relevant to the caller — the same `areaAvailable` predicate
navigation applies — and the domain already answers the question. It computes nothing itself. A
workspace follows one contract (Overview, primary views, Activity, contextual Insights, Configure);
a page-support rail with three modes (Activity, Insights, Configure) is the one place a page shows
them, and it holds a single open mode. Insights is the deep cross-workspace analytics workspace
(`/insights` saved dashboards, `/insights/reports` the builder); a workspace's Insights rail is a
few numbers from the same aggregates.

**Why.** Today was too narrow to be the root of an organization, and Reports mixed a dashboard
reader, a report builder and dashboard management on one screen. The sidebar answers *where do I do
this kind of work*; it must not expose Product → Module → Feature. A commercial Plan packages
Features across several workspaces, and one workspace composes Features from several Modules, so the
two taxonomies are kept apart on purpose (D25, D46).

**Holds.** `navigation.test.ts` (one Home, no Today or Reports route, no workspace without a page,
one section heading), `organization-home.test.ts` (Home reads only what a business has and totals
nothing), `workspace-shell.test.ts` (one support mode at a time, only supported modes offered).

**Not built, and why.** Financials, Website & Portal and Library are target vocabulary, not rows: no
operating surface exists yet for the first two beyond Settings-owned configuration and per-record
job billing, and Documents are attached to a customer, location, asset or job with no
organization-level collection to list. Quick Create waits on create flows a link can reach — every
create form today is a sheet opened from its own page. Communications keeps the `/calls` route
until the call-domain work lands.
