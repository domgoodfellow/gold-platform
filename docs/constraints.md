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
  is enough, and can arrive in week one — or in the same change, when an approved plan's next slice
  is that second caller.
- **An engine gets named when it owns rules that two different business shapes both need, or when
  told to.** A direct instruction to build one is evidence on its own — the two-shapes bar exists
  to stop an engine being invented speculatively, ahead of any real use, not to make an approved
  plan argue with this document.
- **No column, table or enum value without something using it in the same change.** A caller is a
  screen, a route, a domain function, a demo you are about to show, or an operator who needs it on
  Monday. It is not "a second existing call site" — that is the bar for extracting a function. A
  slice of an approved multi-slice plan supplies its own caller: the screen, route or domain
  function that slice adds *is* the thing using it, so the canonical shape the plan calls for gets
  built for that slice rather than a narrower stand-in awaiting a second consumer that was never
  the bar.
- **A workspace package waits for its second consumer** — unless an approved plan's next slice is
  building that second consumer, in which case the package arrives with it. One consumer with no
  plan behind it still buys a build step and a `dist/` for no isolation; each package in the target
  tree has a trigger in *Deferred*.
- **A vendor goes behind an adapter.** Domain code names capabilities — *place a call*, *charge a
  card* — never providers. A domain file importing a vendor SDK means the adapter is missing.
  *Vendor* here always means a third-party service, never the packaging sense of the word.
- **A document waits for the code it describes.** See D8.

**Approved-plan completeness.** Once a multi-slice work plan is approved, each slice is an
explicit requirement, not a proposal to re-litigate against the rules above. Implement slices in
order; lack of a second caller, a second consumer, or reuse elsewhere is not a blocker for a slice
the plan already calls for — the plan is the need "before something needs it" refers to. When a
later slice depends on infrastructure that does not exist yet, build the minimum canonical version
that slice requires, following this repository's existing security, tenancy, audit and domain
invariants, rather than treating the missing infrastructure as a reason to defer. A genuine
technical blocker — an invariant the slice cannot be built to satisfy, or a product decision the
plan leaves genuinely undefined — is still a reason to stop and ask; absence of reuse is not one.

**This section's failure mode, stated so it stays checkable.** It has removed features that
should have shipped — module enablement was cut by applying the engine bar to a question about
what a tenant switches on, which is not code at all. **Before applying any rule here, name the
layer it governs and check that it is the layer in front of you.** These rules refuse speculative
*code* — work with no plan and no caller behind it. They have never had anything to say about what
a tenant turns on, what a screen shows, what you need in order to sell, or a slice of a plan
someone has already approved.

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

### D23 — The interface has decided layers, not a decided page

**Decision.** "Decided visual language" names the layers, the semantic roles, the ownership
boundaries and the accessibility expectations — never every current page composition, every
current component placement or every current Tailwind spelling. Five layers: design tokens,
`packages/ui` (generic source-owned primitives), `apps/web/components` (shared GildOps
application UI and chrome — broader than "domain-agnostic": it may know cross-cutting concepts
like workspace, page, shell and organization context, provided the responsibility is genuinely
shared), `apps/web/features` (product-capability UI), `apps/web/app` (route entry and server
composition). Both organization and platform shells use the shared shadcn Sidebar through
`AppShell`, with separate navigation models; the phone bottom bar remains an intentional
organization-shell adaptation. Colour roles and tenant brand values flow through variables.
`docs/ui-spec.md` holds the surfaces and acceptance rules.
**No colour is keyed to what a status means.** The platform does not know what a tenant's status
means; two words in two languages are the same shape of row.
**Ownership and dependency direction.** `app/` owns routes and server composition; `features/`
owns product-capability UI and may import `packages/ui` directly for a low-level primitive with
no stable shared abstraction; `components/` owns shared application UI and must never import
`@/features/*` or `@/app/*`; `packages/ui` must never import upward into `apps/web`. Reusable
client interaction moves to `hooks/` only after the repeated behavior exists. Caller count is an
extraction signal, not the primary boundary — the test is whether the responsibility is a stable
cross-feature application contract.
**Settings is one organization Area, not a second application shell.** A first-class product
workspace has one canonical owner and is not repeated as a Settings destination — see
`docs/ui-spec.md` §2's Configuration section table and `lib/navigation.ts`'s `AREAS`.

**Four kinds of rule, not one.** Frontend rules are one of:

- **Hard invariant** — a violation creates a correctness, security, accessibility, authority or
  dependency problem (tenant isolation, authorization boundaries, dependency direction, semantic
  HTML/focus/keyboard correctness, one authoritative state owner, no feature import from
  `components/`). Strong automated enforcement belongs here.
- **Product contract** — a deliberate product/IA decision (Platform Administration is not a
  tenant workspace, workspace terminology, organization vs platform scope, which concepts are
  URL-addressable). Tested where changing it would change the product model.
- **Pattern/default** — a preferred reusable solution (`PageHeader`, `ViewNav`, `PageDrawer`,
  `DataTable`'s responsive representation, one prominent page action). A default, not a law; a
  later screen may compose differently when its task requires it.
- **Implementation detail** — exact Tailwind classes, exact JSX ordering, exact visual control
  order. Not protected by architecture-static tests unless the assertion prevents a demonstrated
  correctness or accessibility regression. Visual implementation belongs to rendered
  verification (`docs/testing.md`), not to source-scanning.

Do not write an architecture-static test for an ordinary visual preference; do not treat a
pattern's current implementation as a hard invariant merely because it is the only one that
exists today.

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
every grant and written only by the `integration_operator` role through `store_integration_credential`
(D56), the same Vault shape D44's `store_provider_secret` already uses (I34). CSV needs no
vendor handshake and is the first working connector; Google Sheets and any OAuth-based connector
land later as a `lib/adapters/` implementation, no schema change, per D44/I15's own reasoning
about where a vendor's name may live. `tests/integration/database/integrations.test.ts` proves idempotency (re-importing
the same file never duplicates a customer), tenancy isolation, capability refusal, and that
disconnecting a connection never reaches a customer already imported through it.

**Built, second slice — Cloudflare, and the axis it bridges without crossing.** Cloudflare is the
first OAuth connector on this axis: the tenant authorizes at Cloudflare, GOLD stores a reference
(`integration_connections`) and never the tenant's token outside Vault. `integration_resources`
rows this connector *observes* (a zone, a DNS record it reads) are not the same fact as a row a
tenant uploads — a tenant session with `integration.manage` could otherwise `insert`/`update`
`cloudflare_zone`/`cloudflare_dns_record` rows directly and forge provenance nothing ever checked
with Cloudflare at all. `integration_resources_insert`/`_update` now require `connection_id is
null` in both `using` and `with check`: a tenant may still write a connection-less row (an
uploaded file, D63), but a connector-observed one is written only through
`record_managed_integration_resource`, a new `integration_operator` door, the same narrow-door
shape D56's other four already use. **This axis never merges with Vercel's.** A custom domain's
*hosting* credential is GOLD's own (`20261010000001`, D54/D62's axis: GOLD registers the hostname
and asks Vercel to serve it) — a fact about GOLD's infrastructure, not the tenant's. Cloudflare is
the tenant's own DNS, the other axis entirely. The two meet at exactly one read-only question —
*could this business's connected zone answer for this hostname* (`preview_automation`) — and at
exactly one write a person has explicitly asked for after reviewing the records
(`apply_dns_automation`); nothing ever writes DNS as a side effect of registering or checking a
hostname with Vercel.

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
| **Team/group membership model** | A real relationship, not an inference from role name or shared preset | A tenant whose assignment, dispatch or reporting actually needs team-scoped visibility, and only once a real Team relationship is asked for on its own terms |
| **`schedule.read.self`/`schedule.read.organization` capabilities (or an equivalent visibility-scope mechanism)** | A Slice 0C decision on whether scoped visibility is a Schedule-surface permission or a true `work_items` data boundary — see domain-model.md's "Visibility scope" | Told to build Slice 0C directly. Resource↔Membership (below) is no longer the blocker — `getResourceForCurrentMember` already resolves "which Resource is mine" — but nothing yet reads it for authorization |
| **Member-seat hard-limit enforcement** against `platform_plan_quotas`'s existing `users` allowance | Semantics: whether a pending invitation consumes a seat, whether `included_quantity` differs from a hard limit, whether overage is allowed | A decision on those semantics, then wiring the four membership-creating doors (`add_member_by_email`, `invite_member`/`accept_invitation`, `create_organization`, `provision_organization`) to check it |
| **Schedule workspace reconstruction** ("Slice 1"): a viewport-filling `ScheduleWorkspaceShell` — header/controls, a Resource rail, and a `ScheduleCanvas` holding `DayBoard`/`WeekBoard`/`MonthBoard`, with Dispatch and Map as later projections of the same one availability calculation (I5), never a second scheduling system. The load-bearing rule: **the canvas renders and occupies the available workspace even at zero Resources and zero Work Items — empty state draws inside the canvas, and must never replace it**, the way `DaySchedule` currently replaces its own board with `<EmptyState>` when `resources.length === 0`. The little shadcn `Calendar` stays exactly what it already is — a date-picker popover — and is never again treated as the scheduling surface itself. This also corrects an earlier decision: `scheduling-workspace.test.ts`'s "does not add a Month view" assertion is superseded, not merely relaxed — Month becomes a real third view, sibling to Day and Week, not an exception carved into the old restriction | Slice 0C (Schedule visibility) landing first, per the agreed sequence 0A → 0B → 0C → 1 | Told to build Slice 1 directly, once 0C is done — the design already exists in this row and in the conversation that produced it |

Website distribution, shared controls, theming, Voice, two-way email, terminology, reusable
business setup, platform-wide usage visibility, incumbent migration and the Resource↔Membership
relationship (Slice 0B: `resources.membership_id`, a nullable composite reference to
`memberships`, one Membership to at most one Resource) are no longer deferred: they are built
foundations or active roadmap work. Moving them out of this table does not claim completion;
`roadmap.md` owns their remaining acceptance criteria, and for Resource↔Membership specifically:
it is a relational fact only — no Schedule visibility scope reads it yet (see domain-model.md).

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
**Load-bearing.** A balance is a sum, never a column (I4): credit bought and adjusted
(`organization_credits`, append-only, signed, holding nothing but money in) less every customer
charge on a usage event, in the business's own currency. `public.credit_balance` is the one
answer. The refusal lives where the spend starts: `open_call` asks `app.may_spend_on` for the
`voice_minutes` meter before it writes a room, long before the carrier is asked. Nobody signed in
may add credit — no policy on `organization_credits` permits an insert, for anyone, staff
included (I21); money in arrives only through a payment via a machine role, the same shape
`payment_webhook` already established.
**A price is a retail rate for a meter.** Voice, SMS and email are the meters `voice_minutes`,
`sms_segment` and `email_send`, priced in `platform_retail_rates` like every other meter:
effective-dated, staff-written through `record_retail_rate` (D43), resolved by
`app.retail_rate_at`. With no rate for a meter in the business's currency, that meter costs
nothing and refuses nothing, so every existing tenant keeps working unchanged. Communications
know which meter a channel is and own no price.
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
- **A price is GOLD's.** No `organization_id` (outside I2 the way `platform_staff` is), per currency, and nothing seeded — a module with no price costs
  nothing and refuses nothing, so every existing tenant keeps working unchanged. **Amended by
  D43** in the same direction as the term itself: `platform_provider_rates` and
  `platform_retail_rates` are written through `public.record_provider_rate` /
  `public.record_retail_rate`, staff-only `SECURITY DEFINER` functions, rather than by
  migration alone.
- **No RLS policy reads any of this.** D25's rule survives the arrival of money: a module is
  navigation and billing, never authorization, and a lapsed subscription must never become an
  access control decision.

**A trial stops being a special case.** Founding writes zero-price terms with an end date instead
of switching modules on for free, so `app.enable_default_modules` becomes
`app.grant_founding_terms`. A trial expiring is a term ending — no expiry flag, no second code
path, nothing to remember.

**Rejected.** An `expires_at` column on `organization_modules`: it is the stored total I4 refuses,
and updating it would lose the fact that the module was ever off — the same reason that table has
no update policy today. Merging terms into `organization_credits`: a term is dated and a balance
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
base platform, one row per real module, a seat) are platform vocabulary, migration-written. Neither is authorization and neither is read by any policy.
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

**Two rate cards.** `platform_provider_rates` is
what GOLD pays a named provider, keyed by `(provider, meter, currency, effective date)` now
rather than by meter alone — the same correction one level down, since two providers pricing one
meter needs two rows, not a table that can only hold one. `platform_retail_rates` is what GOLD
charges, for every meter, voice, SMS and email included; it carries no provider dimension at
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
SID and auth token) stay deployment environment secrets, unchanged — D14 already refused a
database as the place a person reads those from, and Vault existing does not reopen that. What
Vault holds is narrower: a credential *this platform generates* per organization — today, a
Twilio subaccount's own API key secret — that must be retained for a future server-side use and
never existed in any deployment's environment to begin with. A Resend platform key is no longer
this category: D62 gave it an opt-in `platform_provider_accounts` row, Vault-held exactly like an
AI runtime provider's, and `app.services.platform_email` prefers that account once staff have set
one active and credentialed; the environment variable (`RESEND_API_KEY`) remains only as the
bootstrap fallback before that.

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
**Resolved.** The deferral this paragraph originally named — verification left to staff's own hand
(`set_provider_resource_status`) until a real Resend-facing check existed — closed with
`20261106000001_a_business_proves_its_own_sending_domain.sql`. `record_organization_email_domain`
keeps naming the domain the tenant door above describes; what the provider actually says about it
is now `record_email_domain_provisioning`'s alone, `provider_operator`-only and holding no grant
to staff or the tenant either — D54's shape, extended from reading a credential to writing the
state that credential's own calls confirm, rather than D43's staff-recorded reconciliation. The
provider adapter (`app.providers.resend.domains`) creates the domain at Resend, reads the DNS
records it requires, and asks Resend to recheck them; `app.services.email_provisioning.operations`
sequences that against this business's own connected DNS (`app.services.dns`) exactly as the
pre-existing Vercel custom-domain path already does, and `active` is written only once Resend
itself says so — never because a form was submitted or a record was published.

**Not built here.** Actually calling Twilio's verification/status APIs to confirm a number
automatically; a per-organization Deepgram, ElevenLabs or model-inference
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

> **Amended by D59 and D60.** The data and authorization boundary this record draws stands. Its *interface* consequence — a Platform shell and phone bar of their own, and Platform Administration as a context-switcher destination — is replaced by one adaptive shell in which `/platform/**` renders inside GOLD's own organization for an operator whose staff row names the permission.
 D60 nests it: `/organizations/{goldId}/platform/**`.

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

**Decision.** `platform_catalog_products` (eight Products and one shared Workspace row, locked by key — D61 renamed the seven this record was written against), `platform_catalog_modules`,
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
no table grant and a small, narrow set of executes — the reader, `record_provider_account_verification`,
and (added for AI Runtime assignment, below) `resolve_ai_runtime_assignment` — so that only the
runtime that actually asked the provider can mark an account verified, or resolve which account
answers an AI capability. It is the
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
file. The `csv` connector itself is gone (D63): a file is not a connection.

**A fourth noun beside the three above.** A **provider service** (`platform_provider_services`)
is one capability a provider exposes, finer-grained than the provider itself (Google is a
provider; Gemini Interactions and Routes are two of its services) — see `docs/domain-model.md`'s
Provider and Intelligence section. A connector's own child apps carry the identical two facts
(`implementation_state`, `vendor_status`) at the same grain, never inherited from the connector.

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

**Amended: payment is mandatory at Launch, not at Setup.** A Sales-founded business is entitled
to a billable Plan the moment `hand_off_accepted_proposal` creates it, but subscribing is its
owner's own later act (checkout), so "billable Plan, no subscription" described every such
business and locked its owner out of Setup. `operational_state` is now one *input* to the same
resolver: in SETUP, no subscription (or only a checkout that never completed — `incomplete`,
`incomplete_expired`) reads as `subscription_pending_setup`, permitted; a subscription that took
effect and lapsed still locks in either state. Launch asks the resolver as if live
(`computeReadiness` adds a `subscription` blocker), so a business cannot go live into a lock; the
database launch trigger does not know the billing environment and does not carry this check, and
a business launched around it is locked on its next request, never left half-open. Setup is not
a bypass of entitlement (still the Plan), of the subscription (still Stripe's fact) or of
authorization (membership is checked first). Nothing in the Python runtime consults this yet, so
Setup does not widen what a provider-backed meter may spend.

**Deferred edges, recorded rather than guessed.** `past_due` locks immediately; a grace period is a
one-line change to the mapping. A Plan assignment that has lapsed reads as *no current Plan* and so
as unlocked. A locked business cannot reach General settings, so one with no currency cannot start
Checkout until staff set it. The Python runtime (`apps/api`) and the OAuth callback do not yet
consult the policy.

### D58 — An organization is Home, its workspaces and Settings; the operator's taxonomy is not the catalogue's

> **Amended by D68.** The workspace landing surface is **Home**, not Overview. Insights is a
> cross-cutting capability and may retain deep routes; it is not an operator workspace.

**Decision.** The organization shell is *Home*, a set of *workspaces*, and *Settings*. Home is an
adaptive business dashboard, not a renamed list of today's appointments, and it draws a block only
when its capability is entitled and relevant to the caller — the same `areaAvailable` predicate
navigation applies — and the domain already answers the question. It computes nothing itself. A
workspace follows one contract (Home, primary views, Activity, contextual Insights, Configure);
a page-support rail with three modes (Activity, Insights, Configure) is the one place a page shows
them, and it holds a single open mode. Insights is the deep cross-workspace analytics capability
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

**Not built, and why.** Financials and Website & Portal are target vocabulary, not rows: no
operating surface exists yet beyond Settings-owned configuration and per-record job billing.
Library has a shell (its own `AREA_GROUPS` row, `/organizations/{id}/library` and seven
empty-state destinations) but no organization-level collection behind it: Documents stay attached
to a customer, location, asset or job, and the agent's files stay private to their asker. Quick
Create waits on create flows a link can reach — every create form today is a sheet opened from its
own page. Communications keeps the `/calls` route until the call-domain work lands.

### D59 — One adaptive shell: entitlement and permission are separate, platform authority is a set of permissions, and roles are editable bundles

> **Amended by D60.** The address is now `/organizations/{goldId}/platform/**`, not `/platform/**`, and each Platform page guards itself as well as its area's layout. Everything else here stands.

**Decision.** D45 separated Platform from a business as a *context* with its own sidebar. That
overcorrected the interface while being right about the data. The interface is now one shell:
organization context is the normal operating context, and `/platform/**` — still the route
namespace for global data — renders inside GOLD's own organization. What a person sees is a
projection (`projectShell`, `lib/shell.ts`) of four separate facts: the organization's
entitlements, the member's capabilities, whether the organization is GOLD's own, and the member's
platform permissions. It is resolved once and drawn by every renderer, so a breakpoint, a role name
or a component cannot hold a second rule.

**Entitlement and permission are separate and both required.** A business without a product has no
workspace for it whatever its roles hold; a member without a capability does not operate a
workspace the business has. **Configuring is not operating**: a Settings entry is a `ConfigTarget`
that borrows a workspace's *entitlement* and declares its own *configuration* permission
(`field.manage` for call outcomes, `call.place` for calls). `field.manage` is deliberately one
capability for declaring the shape of how a business records and runs its work, not narrowly
"Custom Fields": it is the same act whether the shape being declared is a custom field, a work item
type or status, a call outcome, or an opening-hours entry (Schedule configuration), so all four use
it rather than each growing its own single-purpose permission. The Business section is drawn one item at a
time by the authority for that item — there is no Business section a role has or lacks.
Setup is kernel; Agent-assisted drafting is an optional accelerator inside it, and losing the
`drafting` module does not remove the lifecycle.

**Platform authority is a set of permissions on a `platform_staff` row** (`capabilities`, default
all five, so no existing operator lost a door): organizations, catalogue, commercial, providers,
health. Membership of GOLD is not platform authority; a GOLD salesperson uses GOLD as any business
and sees no Platform. Platform is offered only inside GOLD's own organization — never beside a
customer's business — and the context switcher answers only *which organization am I operating?*.

**Roles are editable permission bundles.** A role is a row of an organization's own capabilities,
already creatable and editable per organization. `ROLE_PRESETS` are templates copied at creation:
a saved role records nothing about the preset it began as, and behaviour asks about capabilities,
never a role's name.

**What is not done, and the risk it leaves.** The narrow-door functions
(`record_provider_rate`, `begin_provider_binding`, the catalogue writers and the rest) still call
`app.require_platform_staff()`, which asks *is this person staff*, not *which part*. So a limited
operator is narrowed by navigation and by a server-side refusal on each `/platform/*` area's layout,
not by each database door, and a hand-made server-action POST or PostgREST call by a staff member
is not narrowed at all. Staff rows are written by hand by GOLD (D28), so the exposure is a trusted
colleague exceeding their intended scope, not an outsider — but it is real, and it is why this is
recorded. Making each door check a permission, and each `actions.ts` guard its area, is the next
bounded slice. Phone and desktop cannot disagree (one projection); Platform destinations that share
a permission share an area layout.

**Holds.** `shell-projection.test.ts` (the persona matrix), `adaptive-shell.test.ts` (no renderer
decides; every platform area refuses; Setup is kernel), `settings-map.test.ts` (configuring is not
operating), `platform-permissions.test.ts` (the row, read live, never self-issued).

### D60 — Platform is a sub-scope of GildOps' own organization; a URL names a context, never an owner

**Decision.** There are three scopes: a **person** (`/settings/account/**`), an **organization**
(`/organizations/{id}/**`), and **Platform Administration**, which is
`/organizations/{goldId}/platform/**` — available only while operating GildOps' own organization, and
only to somebody holding a platform permission. It is not another tenant and no longer a route
tree of its own. There is one canonical tree; `/platform/**` survives only as a redirect
(`app/platform/[[...path]]/page.tsx`) that resolves GildOps' organization from the caller's
memberships and GildOps' current Plan — never from the URL — and keeps the path and query.

**A URL names a context, not who owns the data.** Providers, catalogue, plans, billing and rates
are the same platform-scoped records they always were. Nothing below `/platform` filters by the
organization in the address, and `goldId` in those pages is spelled into links and passed to a
component that spells links, nothing else. `platform-control-plane.test.ts` reads the source and
refuses any other use.

**Three facts, proven for every Platform request** (`requirePlatformScope`): the organization is
GildOps' own (its Plan says so, not its name), the caller is a member of it, and the caller holds at
least one platform permission. The organization layout, each area's layout and each page ask for
themselves — a layout is not re-rendered on every client navigation and renders beside its page.
Any other organization, staff or not, answers `notFound()`. Finer permissions per area are exactly
what D59 built and are unchanged; this adds none.

**The switcher answers one question.** Which organization am I operating? While inside Platform the
answer is still GildOps. Platform is shown by the sidebar section, the page's own heading and its
breadcrumb, never by pretending the context changed. It is a section beneath GildOps' own workspaces,
not a replacement for them; on a phone the bar presents Platform while the address is inside it and
the business's own places otherwise.

**Plan ≠ Product ≠ Workspace ≠ Page.** A Plan or Add-on grants capabilities; a Product groups the
customer-facing capability; a workspace is where an operator uses it; a page is one task inside a
workspace. Only the last two are navigation. `Area.parent` makes a page a child of its workspace:
Work, Schedule, Resources, Locations and Assets are pages of **Operations**, which has an overview
of its own. Their routes did not move, so no address changes to say which workspace a page belongs
to.

**Holds.** `adaptive-shell.test.ts` (the three-fact guard in order, every page names its
permission, no hand-spelled `/platform` address, one legacy entry), `context-switcher.test.ts` (the
switcher reads no path), `shell-projection.test.ts` (nesting, active branch, both phone scopes),
`navigation.test.ts` (parents are real workspaces), `agent-conversations.test.ts` (one Agent
mounted by route, the Platform Agent handed no organization or conversation).

**Not built, and why.** Quick Create: every create form today is a sheet opened from its own page,
so a menu of them could only be decoration until a link can open one. Library has a shell but no
organization-level collection: Documents still belong to a customer, location, asset or job and the
agent's files are still private to their asker. Financials, Communications sub-pages, Website &
Portal and the rest of the target page maps are vocabulary until a real surface exists.
Communications keeps its `/calls` route.

### D61 — Gild Products are eight, the shared Workspace is not one of them, and a workspace row is only ever real pages

> **Partially superseded by D68.** The catalogue history and the
> Product/Module/Feature distinctions below stand. Its operator-workspace mapping, CRM-inside-Sales
> implication, and Studio-owns-Marketing wording do not. Sales and Service may remain catalogue
> families without being operator workspaces.

*Previously amended by D66 and D67. The catalogue rows below keep their keys.*

**Decision.** Three internal layers and eight customer-facing Products, kept apart on purpose.

- **GildOps** is the company and platform umbrella. It is not a Product.
- **Gild Platform** is the privileged SaaS control plane (D60): Organizations, Catalog, Plans &
  Add-ons, Pricing, Billing, Providers, Usage, Health.
- **Gild Admin** is organization administration: Team, Roles, Connections, Features, Plan & usage,
  Settings, Setup. It applies to every organization, GildOps included.
- **Gild Workspace** is the shared substrate every Product reuses: Home, Documents, reporting
  primitives, dashboards, activity, search, the Agent shell and the page-support rail.
- **The Products** are Gild Sales, Service, Comms, Finance, Agents, Automations, Field and Studio.

**Boundaries.** CRM is a module area inside Sales. A customer-service *case* is Service; the
*channel* it is discussed on is Comms, and Voice is a module of Comms. Scheduling and field
operations are modules of Field. Price book, quotes, invoices, payments and job economics are
Finance, distinct from GildOps' own subscription and provider economics, which are Platform. An
Agent is Agents; a rule is Automations, and an Automation may invoke an Agent. Website, booking,
forms, the portal, brand, domains and marketing are Studio. Reporting is not a Product: each
Product shows a dashboard, activity and reports over the one aggregate, and the cross-Product
analytics page stays as the *Shared* Insights. Plan ≠ Product ≠ Module ≠ Feature ≠ Workspace ≠ Page.

**The catalogue.** `platform_catalog_products` holds those eight rows (`kind = 'product'`) and one
more, `workspace` (`kind = 'workspace'`). Reporting Features need a parent to be granted and
resolved, and a parent that is not sellable has to be distinguishable from one that is — a column,
not a ninth Product. Renames were in place, so every Plan grant, activation override and runtime
mapping kept its id: crm→sales, communications→comms, operations→field, financial_operations→finance,
automation→automations, customer_experience→studio, insights→workspace. The module holding Ask
(`intelligence`) moved to Agents on runtime evidence, with the planned agent-tools Feature; Service
was created with planned Features only and is `unlisted`. A Plan that granted the old Insights
whole was given that module, and GOLD Internal was given the two new Products, so no organization
lost a capability. The old keys are outside the check constraint and cannot be written again.

**Navigation.** *(Superseded by D66: `WORKSPACES` now registers all nine and a row is derived from pages.)* `WORKSPACES` listed the Products that had a real operating surface, and only those;
`Area.workspace` names a page's Product. No real page, no row. One page, a plain row. Several, an
expandable one that holds only real, reachable pages — never a placeholder, never *coming soon*.
Sidebar children are the major pages of a Product; a `ViewNav` is for views inside one page, and the
same set is never both (Automations' Rules, Messages and Activity are routes; Insights' Overview and
Reports are views). Operators see product names — *Gild Field*, not *Operations*.

**Not built, and why.** Service, Finance, Agents and Studio have no workspace row: Finance's price
book is configuration reached from Settings (D59), Agents' only surface is the rail, and Studio's
site, booking and portal are configured in Settings. No brand or repository rename: GOLD stays in
identifiers and history, and only the Product labels and the catalogue changed.

**Holds.** `gild-taxonomy.test.ts` (exactly eight, no old key, every Module has a home, Service is
planned, no Plan lost reach), `navigation.test.ts` (every workspace is a Product, no row for a
Product without a surface), `shell-projection.test.ts` (leaf against branch, one projection for the
sidebar and the phone), `catalogue-plans.test.ts` (GOLD Internal still resolves every implemented
Feature).

### D62 — A generic Provider Account serves an API-key-only provider; AI Runtime assignment is a platform-global policy over it

**Decision.** `platform_provider_accounts` (D54) already fit a provider with no subaccount or
per-organization scope beneath it — a label, a credential, verification and default status, and
nothing else. OpenAI, Anthropic and Google (`GENERIC_ACCOUNT_PROVIDER_KEYS`) use it directly rather
than growing a second table; Twilio keeps its own bespoke binding/resource path (D44), because it
alone needs one. `provider_operator` gained a third execute, `resolve_ai_runtime_assignment`,
alongside the two D54 already named — same role, same narrowness, no table grant added.
Vercel and Resend joined the same set afterward (`GENERIC_ACCOUNT_PROVIDER_KEYS`), for two
unrelated consumers rather than an AI capability: Vercel's row is the hosting credential GOLD uses
to register a tenant's own custom domain on the tenant's behalf (D33's bridge, above), and Resend's
is GOLD's own platform invitation email. Both read the same "Default" and "Verified" status the AI
providers already show; the page names no AI-runtime section for either, because
`platform_provider_services.kind = 'runtime'` is what that section is actually gated on, not the
provider key.

**AI Runtime assignment** (`platform_ai_runtime_assignments`) is the platform-global choice of
which implemented Provider Service, Provider Account and model answers one current AI capability —
`operator_assistant` (`apps/api/api/ai_ask.py`) or `public_assistant` (`apps/api/api/public_chat.py`)
today, never a tenant-scoped row. `record_ai_runtime_assignment` refuses a service the catalogue
has not marked `implementation_state = 'available'`, a provider/account mismatch, an inactive
account or one with no credential stored — verification is deliberately not required (a freshly
stored credential is unverified by default; requiring a successful `verify()` first would make
Verify a mandatory gate rather than diagnostic evidence a staff member reads before assigning).
The table itself carries no select grant to any role, staff included — `record_ai_runtime_assignment`
and `platform_ai_runtime_assignment_overview` are the only two doors, both staff-checked internally,
matching D40's rule for narrow commercial doors.

**Explicit beats implicit, and never fails over.** An assignment is authoritative; a failure
(missing credential, a provider error) is a failed run, never a silent switch to another vendor.
No assignment for a capability keeps that deployment's legacy environment-variable default
(`app.ai.registry`) — the same graceful-degradation rule D31 already established.

**Holds.** `ai-runtime-assignments.test.ts` (no direct select for any role; every validation
refusal; `resolve_ai_runtime_assignment` is `provider_operator`-only); the Python adapter test
suites for each provider (translation only, mocked SDK boundary).


### D63 — A file is an artifact, not a connection; an import consumes it

**Decision.** Four nouns, four owners. A **Connection** is a persistent relationship with an
outside system: authorized, configured, synced, disconnected (D33, D55). A **File** is a discrete
artifact handed to GOLD. An **Import** is a domain operation that consumes a file. A **parser** is a
capability that reads one. Permission decides *who* may invoke the operation; **policy** decides
*which artifacts, and how large*, an organization admits. None implies another.

**What was wrong.** `csv` was seeded as a connector ("CSV / spreadsheet file", `auth_method = none`,
`connection_method = file`) so an uploaded file had a `connection_id` to hang from, and a business
had to "connect" CSV before it could import one. That modelled a format as a system, put it on
Browse beside Google and HubSpot, and would have invited PDF, Markdown and Spreadsheet next.

**What holds now.** `integration_resources.connection_id` is nullable, and
`integration_resources_has_an_owner` requires a connection *or* a stored file. An uploaded file is a
resource with no connection; `begin_import_run` names its source `file_upload`. The `csv` connector
and `connection_method = 'file'` no longer exist. Google Drive is a Connection; a sheet retrieved
through it is an artifact — provider authorization belongs to Connections and what comes back
through it belongs here.

**The file layer** is `apps/web/lib/domain/files/` and knows no consumer. `formats.ts` is the
registry and keeps four claims apart — *recognized* (in the table), *parseable* (a reader exists),
*uploadable* and *usable by* a consumer (both derived from the format's `consumers`, so they cannot
disagree). Only CSV is usable by `crm_import`; CSV, JSON, text and Markdown by `agent_attachment`.
PDF, DOCX, XLSX, images and the rest are recognized and nothing more, and a format joins a consumer
in the change that adds the reader that consumer needs (D31). `policy.ts` holds
`FileIngestionPolicy` (enabled, allowed categories, allowed MIME types, max size); `intake.ts` is the
one validation — name, format, policy, size — that the CRM import and the Agent attachment both call,
with a consumer's own ceiling applied beneath the organization's.

**Not built, on purpose.**
- No per-organization policy is stored: nothing edits one, so a column would have no caller. Callers
  get `PLATFORM_FILE_POLICY`. When it is stored, its home is *Settings → Files & Data*, and the
  value reaches `checkFileIntake` through the parameter that already exists.
- No `files.*` capabilities. Import is gated by `integration.manage`, the Agent by `assistant.ask`,
  and a record's documents by `document.create`; each is enforced in the database. Splitting a
  `file.import` out of `integration.manage` means rewriting every import door and policy and is its
  own change. Never a per-extension permission.
- Record documents (`uploadDocument`: customer, location, asset, work item) still take any type and
  are not yet under policy.

**Holds.** `file-intake.test.ts` (the registry's four claims, policy against parser, consumer ceiling
beneath policy); `file-boundary.test.ts` (the file layer imports no consumer; no code names a `csv`
connector); `connector-catalogue.test.ts` (no format is a connector); `integrations.test.ts` (an
upload has no connection, and an unreadable format is refused before it is stored).

### D64 — A platform table is vocabulary, commercial configuration or control plane, and reads follow the class

**Decision.** Every platform table's read policy names one of three classes, and a booking visitor —
`authenticated`, with no membership (D22) — is admitted only to the first.

- **Vocabulary**, for any signed-in caller: `platform_meters`, `platform_products`,
  `platform_catalog_products`, `_modules`, `_features`, `_feature_dependencies`, and the module and
  capability rows of `platform_catalog_runtime_mappings`.
- **Commercial configuration**, for a member of some business or platform staff: `platform_plans`,
  the three plan grant tables, `platform_plan_quotas`, `platform_plan_prices`,
  `platform_retail_rates`. A business is entitled to know what it is
  offered and charged.
- **Control plane**, staff only: `platform_providers`, `platform_provider_services`,
  `platform_provider_service_features`, `platform_connector_app_features`,
  `platform_plan_provider_prices`, and the `provider_key` rows of the runtime mapping table. D40's
  rule that a business never learns who GOLD used applies to the vendor's name as much as to its cost.

**The one tenant reader of the control plane** was checkout, which runs under the caller's own
session (D14) and read the processor's price reference straight from `platform_plan_provider_prices`.
It reads it through `plan_price_provider_reference` instead: `billing.manage` in the organization, a
price that is approved and for a plan that may be sold, and nothing else. This supersedes the
earlier reasoning that the table had to be readable because a staff-only policy would have broken
checkout; the door keeps checkout working without the table.

**Definer views stay definer.** `bookable_resources` and `resource_commitments` are the projection
the external axis is given in place of a policy on `resources` and `work_items`, which would
expose every column. They are a deliberate security boundary and not an oversight.

**Holds.** `catalogue-visibility.test.ts` (each class from both sides against real row counts, and no
`using (true)` policy beside another for the same role); `platform-billing.test.ts` (the door
allows a billing manager and refuses another business, a signed-out caller and staff).

### D65 — Usage is one model: a meter, an event that says how it was fulfilled, and two rates

**Decision.** `platform_meters` says what is measured. `usage_events` is the one record of usage,
written only by `app.record_usage`. An event names, where they apply, the catalogue feature that
produced it, the business's provider binding and resource, the GOLD provider account that served
it, and the two rate rows its amounts came from. Retail and provider rates are effective-dated and
unique on their key with the moment, so the rate in force at any moment is one row and never a tie.

**Usage exists whether or not it can be priced.** A provider carried it, so GOLD incurred it. A
business with no currency, a meter with no retail rate, or a provider with no rate on file changes
what can be charged and costed, never whether the usage is recorded. The customer charge, its
currency and the provider cost are nullable: null is *not priced* / *not costed*, which is not
zero; a rate of nothing prices the usage at nothing and says so by naming the rate row. A charge
needs a currency, a rate row needs a charge, and usage that carries no provider cost says
`provider_cost_applicable = false`. The staff readers (`organization_usage_detail`,
`organization_commercial_summary`) report the state (`priced`, `no_currency`, `no_rate`; `costed`,
`uncosted`, `not_applicable`; awaiting reconciliation) and withhold a margin until every event in
a group has both a price and a cost.

**Fulfilment is the event's fact, not the meter's.** The same meter can be carried by GOLD's own
account for one business and by the business's own number, domain or connection for another, so
how it was fulfilled belongs to the path that fulfilled it. `fulfilled_through` on the event is
`organization_binding` (a binding is named, and only then), `platform_account` (GOLD's account
served it, so naming one is refused as false provenance) or `unrecorded` (the reporter could not
say, a gap that can be filled later). A row that says nothing is unrecorded.

**History is written once.** An event snapshots what usage cost GOLD and what it charged the
business, each in its own currency, and records which rate rows those came from. A later rate, or
a reconciliation against a provider invoice, adds a row beside the event and never changes it; the
rate rows an event used cannot be deleted from under it. A rate cannot be dated in the past: it is
appended, never rewritten backwards.

**Communications are consumers.** A call reports voice minutes with the capability
(`outbound_calling` or `inbound_calling`), the number it used and the binding that carries it, and
the call's id as the reference so a carrier retry cannot bill it twice. It is recorded whatever
the business's pricing state. Spending is refused by `app.may_spend_on(organization, meter,
units)`, which asks the retail rate for that meter. `organization_credits` keeps only what usage
cannot say, purchases and adjustments, so what was spent has one record instead of two.

**Known limits.** `app.charge_for_call` names the carrier as `twilio` in SQL: a call should reach
its provider through the binding and service that fulfil the capability, not assume one. The link
from a feature to its meters is still the `meter_ids` array on `platform_catalog_features`, which
`record_usage` reads; it becomes a relation with the catalogue.

**Holds.** `usage-economics.test.ts` (resolution by meter, currency and moment; provenance;
tenant integrity; history preserved across rate changes; usage kept in every pricing state);
`usage-boundary.test.ts` (`communication_rates` stays gone; only `app.record_usage` inserts a
usage event; the composite keys; amounts stay nullable with no default).

### D66 — Nine registered workspaces; registered is not visible; Studio owns the form, the destination owns the record

> **Superseded by D68 for workspace information architecture.** This decision remains historical
> evidence of the implementation generation that introduced a nine-workspace registry. Sales,
> Service and Insights are not members of the target operator-workspace set.

**Decision.** A business has nine workspaces: Gild Sales, Service, Comms, Finance, AI,
Automations, Field, Studio and Insights, in `WORKSPACES` (`lib/navigation.ts`). Two D61 words are
corrected. **Agents → AI**: the workspace is intelligence — assistants, chatbots, knowledge,
conversations, tools, models and runtime, evaluations, usage — and an *agent* is one implementation
inside it (the rail, `agent_runs`, the Agent module keep their names). **Gild Workspace → Gild
Insights**: every Product is a workspace, so a workspace named *Workspace* is recursive; the shared
analytical one is Dashboards, Reports and Analytics over the one reporting aggregate. D61's
Product/Module/Feature/Workspace/Page distinction and its rule that a row is only ever real pages
stand.

**Registered is not visible.** The registry holds the whole target. A workspace draws a row when a
page names it (`Area.workspace`) and that page is reachable to the person, by the module, feature
and capability gates it already carries. Readiness is therefore a fact about pages: no flag on the
workspace, and no entitlement standing in for "not built yet". Service, Finance, AI and Studio are
registered and have no row. `Area.workspace` now means *owner*: Pricing names Finance and has
`sidebar: false`, so it is owned and not drawn. `ConfigTarget.workspace` names the owner of a
configuration entry the same way (branding and website → Studio, communications → Comms).

**Home, Overview, Insights are three things.** Home is the cross-workspace cockpit (*what needs
attention*). A workspace Overview is that function's own lens (*what matters in Sales*). Insights
is deliberate cross-domain analysis (*which lead sources give the most profitable jobs* — Sales,
Field and Finance, so none of them owns it). One reporting substrate with several lenses; no
reporting engine per workspace. Insights leaves the *Shared* section and is a workspace row.

**Ownership.** AI = intelligence, Comms = channels, Automations = orchestration, Studio = public
surfaces, Insights = analysis. A communication belongs to Comms even when it belongs to a Service
case; an AI assistant taking part in a conversation does not put Comms inside AI; AI may be an
Automation action without Automations being part of AI. **Studio owns the form; the destination
workspace owns what a submission becomes.** Platform Administration is a scope of GOLD's own
organization (D60), not a tenant workspace.

| Surface today | Owner | Kind | Route |
|---|---|---|---|
| customers, pipeline | Sales | workspace page | unchanged |
| calls; call setup; `settings/communications` | Comms | page; configuration | unchanged |
| pricing, quotes, invoices, payments, job economics | Finance | Pricing owned, not drawn; the rest live on the job screen | unchanged |
| automations (Rules, Messages, Activity) | Automations | workspace pages | unchanged |
| field, work, schedule, resources, locations, assets | Field | workspace pages | unchanged |
| insights, reports | Insights | workspace page | unchanged |
| the Agent rail, Setup drafting | AI | not an area (rail); Setup stays kernel | unchanged |
| `settings/website`, `settings/branding`, `/book/{slug}`, `portal/{token}`, public intake, marketing routes | Studio | configuration and public | unchanged |
| Home | none — cross-workspace | shell | unchanged |
| custom fields, Team, Connections, Setup, Settings, Features, Plan & usage | none — cross-cutting configuration | configuration | unchanged |
| `platform/**` | not a workspace — control plane | scope | unchanged |

**Routes do not encode the hierarchy.** `/customers` does not become `/sales/customers`. A move is
weighed against links, tests, bookmarks, the Agent's context, gates and public URLs first, and no
route moved in this decision.

**The migration boundary the next slices work to.**

- *Studio — website.* Today one authority is database-backed (the GOLD homepage revision model in
  `lib/domain/public-site`, edited from Studio's homepage editor) and another is TypeScript
  (`lib/marketing`, the routes under `app/(marketing)`: sales, operations, customer-service,
  how-it-works, integrations, pricing, contact, demo, privacy, terms). The target is one authority:
  pages, navigation and legal copy as revisioned public-site content that Studio edits and the site
  renders, with the constants gone. Two authorities for one site is the defect.
- *Studio — Forms & Intake.* The demo and contact path is form → server action →
  `lib/domain/public-intake` → `submit_public_inquiry` → a customer and a `customer.created` event.
  It keeps working. The target is Studio form → Sales intake → contact → lead or pipeline entry, so a
  demo request is first-class Sales work and not a customer row with metadata in an event. No lead
  model exists to receive it yet; do not invent one inside Studio.
- *Service.* A Case/Request is the object. Callback requests, complaints and change requests that
  arrive as calls, work items or intake rows are what eventually feed it; none is built.
- *AI.* Assistants, knowledge, conversations and evaluations under one workspace. Today: the rail,
  agent conversations, attachments, drafting and the platform's AI runtime assignment (D62).
- *Comms.* Inbox, SMS and Email join Voice; the channel and the delivery record stay Comms.
- *Finance.* An overview and operating pages over `priceWorkItem`, invoices and payments, never a
  second calculation (I4). Pricing stays reachable from Settings.
- *Automations.* Rules, Messages and Activity are the existing pages of Workflows, Actions and
  Runs & Review; nothing is renamed until those pages are.
- *Overviews.* Each workspace's overview reads the one reporting aggregate; Home composes previews.

**Holds.** `navigation.test.ts` (nine registered in order, the four without a page are named and
draw nothing, Gild AI and Gild Insights are the names, every owned page names a real workspace,
one section heading), `shell-projection.test.ts` (rows come from pages, Insights is a plain row),
`gild-taxonomy.test.ts` (every workspace maps to a real catalogue row).

**Known contradiction, not resolved here.** The catalogue still names its Product `agents` /
*Gild Agents* and its shared row `workspace` / *Gild Workspace* (`platform_catalog_products`, keys
locked by a check constraint). The registry maps to them through `WORKSPACES[].product`; renaming
the rows is catalogue work for M12, with a migration, and no operator-facing sidebar text depends on
it. D61's "Insights is not a ninth Product" is now a statement about the catalogue, not the sidebar.

### D67 — The workspace, capability and AI contract: what owns what, and how the gates stack

> **Amended by D68.** The canonical-record, projection, invocation, provider and related-record
> rules below stand. D68 replaces the workspace registry and ownership table: CRM replaces Sales as
> the relationship workspace; Marketing is a target workspace independently of catalogue timing;
> Service is not an operator workspace; and Insights is cross-cutting rather than a workspace.

**Decision.** Vocabulary and ownership, written once so later work does not redefine them. This
decision changes no behaviour, route, table or price. It corrects D61 in three places, named under
*Corrections to D61*, and leaves D66's registry, routes and migration boundary as they are.

**Words.** GildOps is the company; *Gild* prefixes the products (D61). Historical migrations,
database identifiers and old changelog entries keep their legacy names.

| Word | Means | Is never |
|---|---|---|
| **Workspace** | Where an operator does one kind of ongoing work | a data owner, Product, Plan, SKU, Module, Feature, permission or directory |
| **Page** | One task inside a workspace | a Feature |
| **Product** | A customer-facing family in the catalogue | a workspace (see below) |
| **Module** | A coherent area inside a Product that a business switches on | authorization (D25) |
| **Feature** | One concrete capability; what a Plan grants | a page |
| **Permission** | May *this person* operate it (`call.place`, `assistant.ask`) | evidence the business bought it |
| **Entitlement** | The business bought or was given it (Plan → Feature) | a permission |
| **Seat** | An entitlement to a *person* using a Feature (calling users) | a permission or a role |
| **Allowance** | How much may be used per period, under the Plan (`platform_plan_quotas`) | a rate limit |
| **Rate limit** | How fast, whatever was bought; abuse protection | an allowance |
| **Provider readiness** | Whether GildOps can technically fulfil it | an entitlement |

At the time of D67, a workspace mapped to one catalogue row through `WORKSPACES[].product`. D68
superseded that implementation: the field no longer exists because Product-to-workspace mapping is
many-to-many through Features.

**Records are canonical once; workspaces project them.** A Customer, Document, Inventory item, Call
or Work item is one record. The owning workspace has its canonical page; any other workspace shows a
link or summary of it and never a copy of the record or its rules. **The sidebar answers *what kind
of work am I doing*; a record's relationships answer *what is related to this*.** A related-record
card is a link plus a read, filtered by the caller's permissions and the organization's entitlements,
with its own loading, error and empty states.

**Ownership.**

| Owns | Workspace |
|---|---|
| Relationship acquisition and progression: customers, pipeline, qualification, follow-up and intake state | **CRM** |
| Channels and conversation history: voice, dialer, numbers, SMS, email, recordings, transcripts, call outcomes, delivery state, the Voice Agent as a channel | **Communications** |
| Performing work: jobs, scheduling, dispatch, resources, locations, field execution, operational assets | **Field** (D66's name; *Operations* is the concept) |
| Money: price book, quotes, invoices, payments, credits, job economics | **Finance** |
| Rules, triggers, conditions, sequences, run history | **Automations** |
| Intelligence: agents, assistants, models, knowledge, conversations, runtime, usage | **AI** |
| Public presence: website, forms, booking entry, portal, brand, domains | **Studio** |
| Cross-domain analysis over the one reporting aggregate | **Insights capability**: cross-cutting, not an owner workspace |
| Cases, requests, complaints | **Support**: canonical workspace; not yet visible because no operating surface exists |
| Audiences, segments, campaigns, journeys, lifecycle policy | **Marketing**: canonical workspace; not yet visible because no operating surface exists |
| Products sold, SKUs, variants, catalogues, orders, promotions | **Commerce**: not built, not registered |

Home is the cross-workspace cockpit and is not a workspace. Customers, Documents, Knowledge,
Inventory, Assets, the Scheduling engine, events, Connections, identity and usage serve several
workspaces and are not workspaces. Inventory is shared: a service business may hold stock with no
Commerce, and Field consumes it; Commerce sells items and never owns the stock. A lead is a stage of
a customer (*Decided, not yet built*), so CRM and Marketing share one person record.

**Target is not visibility (D68).** Marketing and Support are registered canonical workspaces even
though neither has a page. A row still waits for a real, reachable surface; architectural existence
does not wait for a Product. Commerce remains undecided and unregistered.

**Invocation.** Another workspace *invokes* a capability and never re-implements it. A CRM customer
shows Call, Email and Message that open the same Comms capability with the customer as context; there
is one dialer. The same holds for Customer → Finance, Work item → Inventory, Order → fulfilment work,
and a Voice Agent using CRM lookup, Scheduling, Documents or Finance tools. **Comms owns talking,
Scheduling owns scheduling, Finance owns tenant money, CRM owns relationship state, AI reasons and
invokes, and Automations owns durable orchestration.**
Marketing will consume CRM state, Automation triggers, Comms delivery, Finance offers and Commerce
items, and own none of them. An operational notice, a lifecycle message and a marketing message are
three kinds, because consent, suppression and urgency differ. An offer references a Finance price and
never carries an amount in a template.

**The dialer as the test.** Feature `outbound_calling` (catalogue) → calling-user seat → seat held by
a person → permission `call.place` → organization Voice configuration and number → provider binding
and Gild's telephony runtime → Twilio subaccount → call record → usage event (`voice_minutes`) →
Finance. One Feature implementation; a Sales package and a Comms package may both grant it. Two links
in that chain are not built (*Findings* 7 and 15).

**Scope.** An organization runs one business. Platform Administration runs GildOps itself: provider
accounts, model catalogue, Product catalogue, Plans, rate cards, provider cost, health, provisioning,
subscriptions, global AI policy. It is a sub-scope of GildOps' own organization (D60); rendering it
inside that shell does not make its records tenant-owned, and no tenant workspace is duplicated
beneath it so staff can inspect tenant data (I21).

**The finance planes remain separate.** Tenant Finance owns customer → tenant prices, quotes,
invoices, payments, credits and job economics. Platform Administration owns organization → GildOps
Plans, subscriptions, allowances, overage, provider cost and platform margin. AI and Communications
screens may show entitlement, usage and upgrade state; they keep no price of their own (D40, D43,
D65).

**AI has four surfaces, and each is its own entitlement and its own usage pool.**

| Surface | For | Included? | Model chosen by |
|---|---|---|---|
| **Gild Guide** | Setup, navigation, explaining the app, diagnosing configuration | Baseline; metered; fair-use limits; never unlimited | The platform |
| **Business Agent** | Business work: analysis, drafting, research, proposing actions | Commercially entitled; metered; allowance and tier apply | The user, from the models the organization may use |
| **Public Assistant** | A business's visitors and customers | Separate entitlement | The business, once; the visitor never |
| **Voice Agent** | Spoken conversation; operated by Comms, defined on the shared AI runtime | Separate entitlement | The business |

A public traffic spike must not drain staff allowance unless a Plan says so. Guide sees only what the
asker may see (I48).

**Models and tiers are catalogue data.** A model is a platform row that will carry: a stable Gild id,
display name, provider, the provider's own model identifier, provider service, lifecycle, commercial
tier, supported surfaces, whether a tenant may select it, and a link to its cost. Tiers (AI Standard,
AI Pro, Advanced Reasoning) name packages of models; membership is data, never a conditional in the
Agent UI, and no model name is architecture. Model *visibility* and provider *infrastructure* are
separate: a tenant sees and picks a model and never sees a Gild key, provider account, vault record
or wholesale rate.

**Gates for a Business Agent request: ten, separate, all server-side.** (1) platform runtime ready;
(2) organization entitled; (3) feature enabled and configured; (4) `assistant.ask`; (5) model enabled;
(6) model supported on this surface; (7) model allowed by the organization's tier or override;
(8) allowance or credit permits; (9) rate limit permits; (10) the provider account can execute it.
**A model id sent by the browser authorizes nothing.** The server resolves it against the
organization's effective entitlement before any provider spend.

**Providers stay platform infrastructure.** Accounts, keys, the vault, verification, routing, upstream
model ids and wholesale cost are Platform Administration (D54, D62). No second provider system is
built; what exists already satisfies this and is kept.

**Meter everything worth controlling; bill selectively.** Every workload above should emit usage even
when it is included: Guide requests, Business Agent requests, Public Assistant conversations, Voice
Agent minutes, call minutes, SMS segments, email. Lower-level figures (tokens, speech-to-text,
text-to-speech, latency, provider cost) sit beneath. Tenant-facing units stay understandable and need
not equal a provider's. One writer, `app.record_usage` (I59).

**Shared components.** shadcn primitives → GildOps product components → workspace composition.
Existing equivalents: `record-header` (entity header), `features/timeline` (activity timeline),
`widget` and `kpi-card` (metric group), `collection-view` and `table` (resource table), `view-nav`,
`page-drawer`, `configure-registrar` and `support-registrar` (configuration and support panels). Named
and not built: related-records card, open-in-workspace link, usage meter, cost summary, context and
knowledge sources, setup checklist. Each is built by its first real caller, not before.

**Documents and knowledge are one record with many readers.** A document may guide the Business
Agent, Voice Agent, Public Assistant, Automation and others without being copied. The screens will
eventually show *Guided by* and *Used by* on a record, and *Affects*, *Depends on* and *Used by* on a
configuration such as the Voice Agent. Not built; the information architecture is fixed here.

**Corrections to D61.**
1. *"Website, booking, forms, the portal, brand, domains and marketing are Studio."* Marketing
   (audiences, campaigns, journeys) is its own future workspace; Studio keeps the public form and the
   destination owns the record (D66). The catalogue's `studio` description still says *and
   marketing*; that wording changes with M12's catalogue work.
2. *"Operators see product names: Gild Field, not Operations."* Stands as the label, but *Operations*
   is the concept and Field is today's implementation of it.
3. *"Workspaces are the Gild Products"* (`ui-spec.md` §1) becomes *are surfaces of them*.

**Historical findings at the time of D67.** D68 and later implementation supersede the workspace
registry statements below; the remaining runtime findings retain their value as dated evidence.

1. **Service** is a planned Product with planned Features only, unlisted, and a registered workspace
   with no page. No case object exists.
2. **Field** is the present, deliberate implementation of Operations. Kept.
3. **AI** is the workspace; *agent* is one implementation in it; the catalogue Product is still keyed
   `agents` (M12).
4. **Insights** is a workspace and a shared analytical surface, mapped to the catalogue's non-sellable
   `workspace` row. It is not a Product a business buys.
5. **Studio** owns website, forms and intake, booking entry, portal presentation, brand and domains.
6. **Customer-service work today** is spread over Comms (calls), Sales (customers), Field (work items),
   Studio (intake) and the Agent. No Service surface exists.
7. **`reception`** is one Module (*Reception and sales*) gating both the Comms Calls page and the Sales
   Pipeline page, on purpose: a pipeline with no calls is a hand-kept list. That is against the target,
   where calling belongs to Comms and the pipeline to Sales. The later step is two modules; the
   catalogue Features are already separate (`inbound_calling`, `outbound_calling`, `pipeline`). Nothing
   needs it until a Plan sells one without the other.
8. **Wording that implied identity:** `ui-spec.md` §1 (Product = workspace, corrected above) and
   D61's Studio and marketing line. No document was found equating entitlement with permission, a
   Module with a workspace, or a provider account with tenant configuration.
9. **AI, platform-global:** provider accounts, credentials, runtime assignments, adapters.
   **Organization-specific:** conversations, runs, attachments, proposals, assistant grants, public
   deployments, `assistant.ask`, the drafting module.
10. **One model per capability.** `platform_ai_runtime_assignments` is keyed by capability
    (`operator_assistant`, `public_assistant`) and holds one provider, account and free-text model,
    platform-wide, with no organization, tier or surface. This blocks model choice and is left alone.
11. **Configure → Connections.** The tenant Agent's Configure panel links *Connections & permissions*
    to `/integrations` (`features/agent/tenant-agent-rail.tsx`), and `agent-conversations.test.ts`
    pins that link and text. Connections are outside apps; what the assistant may read is
    `assistant_resource_grants`. The mismatch is recorded; the later Agent slice updates that test
    with the screen.
12. **The ask flow does not meter.** No path in `apps/api` calls `record_usage`. `ai_tokens_input` and
    `ai_tokens_output` exist as meters and catalogue Features name them; nothing writes them.
13. **AI readiness is not end-to-end.** The web treats *`ASSISTANT_API_URL` is set* as available
    (`answeringProvider`). The API resolves assignment, credential and adapter at request time and
    fails the run there, so a screen can say available when a run will fail.
14. **Telephony credentials against configuration.** A business stores one number and no secret
    (`telephony_settings`, D39). The subaccount is a provider resource; Gild's master token lives in
    `apps/api` and the vault, readable only by `provider_operator`.
15. **Commercial gaps for calling.** Present: Features with `voice_minutes`, plan allowances
    (`calling_users`, `intelligent_call_minutes`, `sms_segments`), an `additional_caller` add-on,
    usage events, provider rates and cost. Missing: nothing reads `calling_users` (a seeded,
    unenforced row), no table assigns a seat to a person, and placing a call does not check the
    Feature at the write. M17 owns that enforcement (`CLAUDE.md`, *Current state*).

**Packaging and model tier are two things, joined by one entitlement axis.** Add-ons and Plans are
what Gild sells; a *model tier* (standard, pro, advanced) is what an organization is entitled to; a
model is classified into a tier. `ai_lite` (labelled **AI Standard**, key kept) and `ai_pro` are
Add-ons that each grant a tier, and a Plan may grant the same tier without either Add-on: both
resolve to one axis, so no parallel set of AI Products exists. Tiers are cumulative by default
(pro includes standard, advanced includes both) unless a model states an exception. The grant is per
surface, so `business_agent` Pro does not make the public chatbot run Pro models. The tier attribute
and its resolver are Slice 2's; `ai_lite` and `ai_pro` are neither renamed nor duplicated
(`20261008000003` changes the `ai_lite` label only).

**Not built, and why.** Model catalogue, model picker, tier entitlement, the AI request gate, a
readiness probe, AI usage metering, the Guide, Public Assistant and Voice Agent runtimes, seat
assignment, Marketing, Commerce, Service, the related-record components, the `reception` split. Each
is a later slice or milestone and none has its first caller yet.

**Holds.** Nothing new. Already pinned: `navigation.test.ts` (no workspace drawn without a page),
`usage-boundary.test.ts`
(one usage writer), `provider-accounts.test.ts` (credentials), and `agent-conversations.test.ts` (the
Configure link, on record above as wrong). The rest of this decision is definition with no test.

### D68 — Operator workspaces compose capabilities; canonical records, Insights, Library and Administration remain shared

**Decision.** The canonical operator workspace identities are exactly **CRM, Communications,
Marketing, Support, Finance, AI, Automations, Field and Studio**. This is an operator taxonomy —
where a person goes to perform a kind of ongoing work — and is independent of the commercial
catalogue. A Product may contribute Features to several workspaces, and a workspace may compose
Features from several Products. Sales and Service may remain catalogue Products or families
without becoming operator workspaces. Plan ≠ Product ≠ Module ≠ Feature ≠ Workspace ≠ Page.

Canonical keys are stable architectural identities used by routes, permissions, capability
mappings, analytics and cross-workspace contracts. Their default labels are `crm` → CRM,
`communications` → Communications, `marketing` → Marketing, `support` → Support, `finance` →
Finance, `ai` → AI, `automations` → Automations, `field` → Field and `studio` → Studio. A future
organization terminology override changes presentation only; it does not change ownership or the
canonical key.

**Target and implementation are separate facts.** `apps/web/lib/navigation.ts` registers all nine
canonical identities, but a workspace earns a visible row only when at least one real, reachable
operating surface names it. CRM currently uses the legacy `/sales` Home route; Marketing, Support
and AI have no Home. Documentation, implementation state and the commercial catalogue must remain
separate facts rather than forcing any one to impersonate another.

| Target area | Canonical responsibility | Current implementation |
|---|---|---|
| **CRM** | customers, leads, relationship state, pipeline, qualification, intake, opportunities and relationship follow-up | CRM Home still uses `/sales`; Customers and Pipeline provide much of the present surface |
| **Communications** | calls, voice, email, messaging, threads, delivery state, numbers and routing | Home and Calls are present |
| **Marketing** | audiences, segmentation, acquisition, campaigns, lifecycle journeys, promotional consent and attribution | registered canonical identity; no route or visible row |
| **Support** | cases, requests, complaints, queues, assignment, escalation, service-level policy and resolution | registered canonical identity; no route or visible row |
| **Finance** | tenant/customer pricing, quotes, invoices, payments and job economics | Home is present, kernel like Sales and Field's; Pricing stays a Settings-only configuration target, and per-record finance lives on the job screen |
| **AI** | assistants, business-intelligence interaction, knowledge and tool configuration | Agent rail/runtime only; no Home |
| **Automations** | durable rules, triggers, sequences and workflow execution | Home, Rules, Messages and Activity are present |
| **Field** | operational work, schedule, resources, locations and equipment/assets | implemented |
| **Studio** | authoring and publishing website, forms, brand and portal experiences | Home summarizes public-surface status; Website, Forms, Brand and Portal remain configuration reached from Settings, not yet real pages |

**Canonical records and projections.** A business record exists canonically once. Customers,
support cases, invoices, payments, conversations/threads, calls, work items, documents, assets,
resources and automation runs may appear in several workspaces without becoming several records. A
projection reads canonical state, may add context-specific secondary data and authorized actions,
and links to the canonical or owning destination. It never copies authoritative state, acquires
ownership or reproduces the record's business rules.

**Ownership does not follow invocation.** CRM may invoke Communications to contact a customer;
Marketing may consume Studio content and Communications delivery; Finance may send an invoice
through Communications; Support may reply through Communications; Automations may invoke every
domain; AI may use permitted domain tools. The invoked implementation remains owned by its
canonical domain. Communications owns talking; CRM owns relationship state; Support owns problem
resolution; Marketing owns acquisition and promotional/lifecycle intent; Finance owns
tenant/customer money; Scheduling owns time/resource commitment; AI reasons and invokes;
Automations owns durable orchestration; Studio owns authored customer-facing experiences.

**CRM, Support and Communications remain separate.** A customer relationship and a support case
are each canonical and related. CRM may summarize a customer's open cases but does not own their
lifecycle. A communication is not automatically a support case: Communications owns the channel
and conversation history, while Support owns durable assignment, priority, escalation, service
targets and resolution. There remains one SMS thread, email thread or call history rather than a
Support-specific copy.

**Workspace Home contract.** The workspace-row body opens its canonical Home. Its chevron only
expands or collapses children and does not navigate. Home is never repeated as a child and
Overview is not a competing architectural page type. A Home summarizes the workspace and links to
real child surfaces; a child list contains only real, reachable pages.

**Insights is cross-cutting.** It is reporting and analysis over shared aggregates, not an owner or
operator workspace. `/insights` and other deep report/dashboard routes may remain real and
reachable, and a page's Insights support mode may link to them. Route existence does not create a
workspace or sidebar section.

**Library is shared organization infrastructure, not a workspace.** Its target collections are
Files, Media, Templates, Knowledge, Collections, Sources and Trash. It has its own `AREA_GROUPS` row, ruled apart from Home and
Workspaces, and a shell at `/organizations/{id}/library` with an empty-state page for each target
collection plus Collections, Sources and Trash — but record-attached Documents remain the only
files that exist; an organization-wide Library collection does not. A generalized Form or Template
record is introduced only when multiple real consumers require the same canonical object. Until
then, domain-specific templates retain their domain behavior and owner.

**Studio and Marketing remain distinct.** Studio authors and publishes experiences and reusable
content. Marketing owns campaign, audience, acquisition and lifecycle intent and consumes Studio
outputs. A form's canonical owner and the record created by a submission may differ: Studio can
own the published form while CRM owns resulting relationship/intake state.

**Two finance planes.** Tenant Finance owns customer → tenant money. Platform Administration owns
organization → GildOps money: SaaS catalogue, Plans, subscriptions, provider cost, platform margin
and global provider/model policy. Rendering Platform Administration inside GildOps' ordinary
organization shell (D60) transfers no ownership and creates no special tenant.

**Resource and Asset.** A Resource is capacity — what work is done **with**. An Asset is the subject
— what work is **about**. Their relationship on a work item does not make either a projection of
the other.

**Administration and shared engines are not workspaces.** Organization Settings configures the
environment in which workspaces operate: business settings, team, roles, permissions, connections,
provider configuration, Features, Plan and usage, onboarding, terminology and workspace
configuration. Platform Administration is a separate SaaS/operator scope. Scheduling, Search,
Events, Identity, usage metering, provisioning, permissions and reporting aggregates remain shared
engines even when several workspaces invoke them.

**Migration rule.** Sales migrates to CRM; Customer Experience is removed as a workspace identity;
Marketing and Support gain rows only with their first real operating surfaces; partial workspaces
gain Homes and child pages incrementally; canonical keys stay stable if displayed terminology
changes. The current shell treats a workspace parent destination as Home, never repeats Home among
children, and keeps Insights as a real `sidebar: false` route. No documentation-only decision may
create an empty row, and no implementation slice may redefine the taxonomy locally.

### D69 — GildOps naming and technical namespaces migrate forward, never by rewriting history

**Decision.** Current human-facing prose and branding use **GildOps**, and the canonical public
domain is `gildops.com`. The target technical namespace is `@gildops/*`, `gildops_*` and
`GildOps*`. Existing `@gold/*`, `gold_*`, `Gold*`, `gold-platform` and repository metadata are live
legacy identifiers and explicit migration debt, not the preferred vocabulary for new identifiers.

**Applied migrations and historical evidence are immutable.** Never rename an applied migration or
rewrite its body merely to modernize branding. Database identifiers move only through forward
migrations with an explicit compatibility and rollback plan. Historical changelog and audit prose
may retain the name accurate to its time when changing it would falsify the record.

**Package and repository changes are atomic operations.** Rename `@gold/*` only in a change that
updates package manifests, imports, build/test configuration, CI and operational commands together.
Rename `gold-platform` repository/external metadata separately with redirect and integration checks.
Until those migrations land, operating documentation must show commands and identifiers that
actually run and label them as legacy/current rather than pretending the target is already live.

**Current source identifiers move deliberately.** Names such as `findGoldInternalOrganization`,
`goldApiAnsweringProvider`, `gold_internal`, `bootstrap_gold_internal_workspace` and
`gold_public_organization_id` remain load-bearing until a bounded source or forward-database
migration changes their callers. Blind repository-wide replacement is prohibited.

### D70 — One commercial reading may carry many independently reconciled provider costs

**Decision.** `usage_events` remains the one commercial usage ledger. A row says what an
organization consumed; `usage_cost_components` says every vendor-billed ingredient used to fulfil
that reading. Provider cost meters live in `platform_provider_cost_meters`, separate from the
tenant-facing `platform_meters`, so one `voice_minutes` reading can carry PSTN, browser-client,
conference and recording quantities without selling four telecom products. A component names its
provider, precise cost meter, quantity, rate version, native amount and currency, and optional
reporting conversion. Missing rate or FX produces `unknown` with a reason and a null amount, never
zero.

**History and reconciliation.** Provider rates remain append-only and now include cost meter,
region, direction, resource type, optional provider-account scope and an effective window.
`usage_cost_component_adjustments` appends a reconciled or adjusted amount beside the estimate;
neither the commercial quantity nor the first estimate is replaced. `platform_fx_rates` is a small
effective-dated catalogue whose selected row and numeric rate are both snapshotted onto the cost
component. Same-currency reporting needs no invented FX row; different currencies with no matching
row remain unconverted.

**Operational ownership.** `app.charge_for_call` and `app.charge_for_message` derive quantities from
the canonical call, participant and message records, then ask Finance's cost-component writer to
resolve money. `record_phone_number_month` emits a recurring `phone_numbers` reading keyed by
number and month, so a retry returns the existing event. No historical number backfill runs:
earlier phone-number rows do not retain a trustworthy active interval from which one could infer
every past billable month.

**Visibility.** Cost components, adjustments, provider cost meters, provider rates and FX rates
are staff-only under `app.is_platform_staff()`. Tenant reads continue to use the commercial
columns of `usage_events`; they cannot reach a wholesale row by guessing its URL or id. Commercial
staff pages use the guarded `platform_usage_economics` and `platform_usage_cost_components`
readers.

**Holds.** `usage-economics.test.ts` proves multiple components and providers on one event,
component idempotency, historical rate selection, unknown-not-zero, number-month idempotency and
tenant refusal. The Communications and usage-boundary suites continue to prove one usage ledger
and server-derived call/message quantities.

### D71 — Settings is one destination; Organization, Account, Access, Connections and Subscription are scopes inside it

**Decision.** Reverses the earlier split (never itself a numbered decision) that gave "Business
settings" and "Account settings" separate account-menu entries and separate visual shells. There
is one Settings destination, one shared tab bar (`SettingsScopeNav`, `lib/route/settings.ts`)
naming five scopes, and one account-menu entry that opens it — landing on the Organization scope
when a business is in play, on Account otherwise. A Subscription shortcut sits beside it for the
same reason a person reaches billing often enough to skip a hop.

**What does not move.** Account remains the signed-in person's own route tree
(`/settings/account`), independent of which organization is selected (D45) — merging the *shell*
does not merge the *domain*. Organization (`/organizations/{id}/settings`), Access
(`/organizations/{id}/roles`), Connections (`/organizations/{id}/integrations`) and Subscription
(`/organizations/{id}/settings/plan`) keep their existing routes, RLS and capability gates
unchanged; the tab bar is a navigation layer over them, not a re-platforming. `configTarget`,
`CONFIG_TARGETS` and the Settings configuration map (`settings-map.ts`) are unaffected — they
remain how the *Organization* scope's own index of configuration doors is built and gated.

**What is still owed.** Work/Schedule configuration, Pricing, Custom fields, Calls/sales-stage
wording, Branding, Website, Domains and Phone/email provider setup remain reachable only from the
Organization scope's own index, not from Connections or a workspace's contextual Configure surface
— they are workspace-owned configuration this slice deliberately left in place rather than
migrating blind (see `CLAUDE.md`'s "the load-bearing absences" table and the roadmap's contextual
Configure work). The sidebar's own Business-section label for Access still reads "Team"
(`lib/shell.ts`'s `BUSINESS_ITEMS`) and the underlying `Area.label` for `roles` still reads "Team"
(`lib/navigation.ts`) — both are legacy labels a later pass may rename; only the pages a caller
actually lands on say "Access" today.

**Holds.** `personal-settings.test.ts` proves the account menu offers one Settings entry, no
Business/Account split, and that `PersonalSettingsShell` and every organization-scoped Settings
page render the same `SettingsScopeNav`.

### D72 — Communications is multi-channel at its foundation: one Conversation, per-channel identities, a server-decided sender

**Decision.** `conversations` gains `channel` (`sms`, `email`) and an `email_identity_id`, and
`phone_number_id`/`external_number` stop being required — a conversation is no longer defined by
a phone number. Which addressing columns a row holds is its own check, so a row cannot be both
channels or neither. Email gets its own organization-facing identity, `email_identities`, beside
`phone_numbers` rather than a generic identities table the two would share no columns of. An
identity references the thing that backs it (a sending-domain resource, a connection) and
readiness is read from that thing, so there is one authority for whether a domain can send.
Tenant mail to customers is `lib/adapters/tenant-email` (`EmailProvider`), a third capability
beside `PlatformEmailSender` (GildOps' own invitation mail) and `SendingDomainProvider`
(proving a name); none widens into another.

**Why.** Email was about to be added to a conversation model that could only hold a phone number,
and a sender address was a value the browser supplied and the server forwarded. Fixing either
under a half-built email channel would have meant replacing SMS underneath itself.

**The sender.** A client names its own resource by id (`phoneNumberId`, later `emailIdentityId`);
the server resolves the address (`resolveSmsSender`, `resolveEmailSender`) and checks ownership,
lifecycle, direction and provider-resource state. There is one input, not an id and an address that
might disagree.

**Navigation.** `call.place` and `message.send` are independent. Text messages needs `message.send`;
Calls needs `call.place`; Communications Home and Numbers take either. `message.send` already reads
"send a text message and see the conversation", so no read-only capability was added: the table
policy still lets any member read, and a read-only role is a decision for the day one is asked for.

**Still reserved.** `gildops_managed` and `connected_mailbox` email identities have a schema and no
writer: no managed domain and no mailbox sync exist, so a tenant cannot create one and a managed
address is never reported ready. An email conversation has no tenant-writable path yet; `channel`
and `email_identity_id` are outside the insert grant until the email channel's own writer exists.

**Holds.** `communications-foundation.test.ts` (static and database), `messaging-sender.test.ts`,
`adapters.test.ts`. I69, I70.

### D73 — Email is a channel of the one Message; the database queues it, a provider runtime sends it, a provider's word is the only thing that moves it

**Decision.** `messages` and `conversations` carry email (`requested_transport = 'email'`,
`channel = 'email'`); `email_message_details` holds only what an email alone has (subject, RFC
Message-ID, threading headers, HTML), `message_events` is the append-only history of what happened to
a message, and `message_attachments` holds files that belong to one message. There is no
`email_messages` and no `email_conversations`. Sending is two acts: `queue_outbound_email` writes the
message under the sender's own session, deciding every authoritative fact itself; `apps/api` is then
handed only the message id, reads everything else under the caller's token, and records what the
provider answered through `provider_operator`. The provider's own callbacks arrive through a separate
destination, secret and role (`tenant_email_webhook`), which hold no table grant.

**Why.** The first design that comes to mind has the web runtime call a provider with a `from` it
was given. That makes the browser the authority on who a business is speaking as, and it makes status
a column anybody who can send can also set. Here the message row is the command, so there is nothing
to redirect, and a status is a statement by whoever actually knows.

**What a message's status means.** `queued` is a message that exists and has not left (*not sent
yet*, never *sending*); `sending` is claimed by one attempt; `sent` is the provider having accepted
it, and is when `email_send` is billed once; `delivered`, `bounced`, `failed` and `rejected` are the
provider's later word. Order is forward-only with every failure outranking every success, so a late
callback cannot undo a bounce and a bounce after delivery is real. Opens, clicks, delays and
complaints are history and never status. The same vocabulary serves SMS; its writers are unchanged.

**Threading is what the mail says.** `In-Reply-To`, then `References`, matched against Message-IDs
the provider confirmed for mail we sent or the mail itself carried, inside one business and one
address. A subject, a sender, or a provider thread id is never a conversation; no match is a new
one. The outbound Message-ID is read back from the provider after the send rather than assumed.

**Authority.** Sending reuses `message.send`: writing to a customer is one trust whichever channel
carries it, and configuring an address (`organization.manage`) is a different authority from using
it. A separate email capability waits for a role that needs one without the other.

**Receiving is a business's statement, not a provisioning step.** A customer-domain address may be
marked as receiving once the domain's mail records point here; mail is accepted only for an active,
receiving address beneath a verified domain. Pointing a domain's mail records at the provider is not
provisioned by this decision, so inbound has not been exercised against the live provider.

**Deferred.** Forwarding, drafts, `cc`/`bcc`, an HTML composer, malware scanning, managed and
connected-mailbox addresses (schema only), a unified Inbox, assignment, and automatic customer
resolution for an unknown sender.

**Holds.** I71, I72, I73.

### D74 — The Inbox unifies the operator's task, not the channels; status, handler and customer are facts of the conversation

**Decision.** `/comms/inbox` is the one list of every asynchronous conversation and `/comms/inbox/{id}` the
one conversation screen, SMS and email alike; `comms/messages` and `comms/email` redirect to it already
narrowed to their channel (`next.config.ts`), and no second operating screen exists. A row is read from the
canonical `conversations` table through `listInbox` — filtered in the database, newest activity first, paged
by keyset on `(last_message_at, id)` — and carries no provider field. A text stays a text and an email stays
an email inside the screen: bubbles and delivery words for one, cards with subject, attachments and
sanitized body for the other.

**Three facts, each with one home.** *Status* (`open`, `waiting`, `closed`) is on the conversation and is
deliberately not a ticket: no severity, no SLA, no category. It follows the messages conservatively — a
message from them reopens it, an answer that actually *left* (sent, never merely queued) moves `open` to
`waiting`, a closed conversation stays closed when we reply, and a delivery callback never changes status or
unread. *Assignment* is one column keyed by membership, with the `events` trail as its history; handler
(human, AI, automation) is a different thing and is not modelled here. *Customer* is the CRM relation, set
by the one contact-point rule or by a person.

**Assignment is not CRM ownership, and CRM has no owner field to conflict with.** Nothing in
`customers` records an owner today; when one exists it will be a separate fact. A conversation may be
handled by someone other than the person who owns the relationship, and neither overwrites the other.

**Authority.** Handling a conversation (status, claim, assign, link) reuses `message.send`; creating a
customer from a conversation additionally needs `customer.create`. A role that can read conversations but
not send is shown them and cannot change them. A separate "assign others" authority waits for a role that
needs one.

**Deferred.** Teams, AI or automation as assignee/handler, a priority, merging conversations, search,
bulk actions, call activity inside a conversation (no canonical relation exists), and real-time push (the
list refreshes every half minute and on any change a person makes).

**Holds.** I74, I75; `inbox.test.ts`, `inbox-boundary.test.ts`.

### D75 — Forms are their own domain; booking intake is a consumer, a template is a starter, and Studio authors while infrastructure serves

**Decided.** Four separations. (1) *Booking intake is not Forms.* The public booking form is a use of form primitives with its own write (`create_booking`); the catalogue feature `booking_intake` stays on it, and `contact_forms` is what the Forms domain earns. **Superseded by D81:** a booking may now ask one of the business's forms beside its own fixed fields; the fixed fields stay Booking's. (2) *A form, a revision and a submission are three things.* A submission records the revision it was answered against, so history stays readable; publishing is the only door a visitor's view changes through. The lifecycle is draft, published, archived — the website's `in_review` step is left out because it exists to put a second person in front of GildOps' own homepage, and a business's form has none. (3) *A template is a starter, not inheritance.* Platform templates are typed (`form_templates`), carry no tenant and are copied into the form's own draft; a business's own saved templates will be a separate tenant-owned table when built, and Library is not their home (Library holds content and files, a template holds a starting definition). (4) *Studio authors; infrastructure serves.* Authoring names no DNS, certificate or provider concern; a form is addressed `/forms/{business slug}/{form slug}` today, and a tenant-hostname route, website block and external embed are later delivery of the same artifact.

**Permissions.** `organization.manage` governs creating, editing, publishing and reading responses, as it already does every public surface of a business; no `forms.*` capability was added because nothing yet needs forms to be granted apart from the rest of Studio.

**Not decided here.** Whether a submission becomes a Customer or starts an automation (consumers of `form.submitted`), rate limiting beyond a honeypot and input size limits, and moving booking onto the shared renderer.

### D75 — SMS is a channel of Communications; the carrier, not the sender, decides a text's state

**Decision.** SMS needed no new subsystem: it already runs on the canonical `conversations` and `messages`
(`channel = 'sms'`), appears in the Inbox and the one conversation screen, resolves customers, assignment
and status exactly as email does, and sends through `MessagingProvider` after the server resolves the number
from a `phoneNumberId`. What the closeout changed is who may say what happened to a text. Before, the
sender's own session could write `status`, `external_id` and `delivered_at` on its text, a late carrier
callback could move a delivered text back to sent, and an unfamiliar carrier word raised inside the callback.
Now a text is created `queued`, a send reports only what the send itself answered (`record_sms_send_result`:
taken, or refused), and the carrier's callbacks apply forward-only through the same rank email uses.

**Same ownership, not the same mechanics.** Email queues in the database and is sent by `apps/api`; SMS is
sent by the web runtime through the adapter and its result is reported through a narrow door. Both are
correct, and neither was forced into the other's shape. SMS keeps its state on the message row; it does
not write `message_events`, because its callbacks carry no id of their own and a forward-only status is
already idempotent for them — a decision to revisit only if SMS needs a delivery history to show.

**Truthful failure.** A carrier refusal is recorded `failed` with a sentence of ours (the carrier's answer
stays in the server log), never bills, and never moves a conversation to `waiting`: only a text the carrier
reports as sent does that. If the carrier took the text and our bookkeeping then failed, the text is not
marked failed.

**Metering.** `sms_segment` is recorded once per text, at first `sent` for outbound and on arrival for
inbound (the `inbound_sms` feature, the meter and an inbound cost component all existed; nothing called
them). The count is `ceil(characters / 160)`: an estimate, not the carrier's count — Unicode bodies are
70 to a segment and concatenated segments hold 153. Reconciliation against the carrier is where exactness
belongs, not this meter.

**Not changed.** Consent policy (STOP, START, and the carrier's keyword set, which includes words an
ordinary reply can contain), retry (a failed text is answered by sending a new one), MMS and RCS.

**Holds.** I76; `sms-lifecycle.test.ts`, `sms-boundary.test.ts`, `test_sms_status.py`.

### D77 — A form is placed, not copied: the surface owns the reference, the form owns the fields, and the database owns who a response is about

**Decided.** (1) *The artifact is singular and its placements are plural.* A website carries a `form` section that names a form by id; the portal keeps `portal_forms`; a link, an embed or a business hostname opens the published form directly. No placement copies a definition, and there is no table that points at several owners — each surface owns its own reference and "where is this form used?" asks each (`app.form_placements`). Booking owns no reference yet: its scheduling-critical inputs (service, slot, resource, the identity needed to book) stay Booking's, and an optional intake form will be a reference from Booking configuration, recorded as a response with source `booking`. **The "after the booking succeeds, in two writes" wording is superseded by D81:** both writes are one database and now one transaction. That is a contract, not built. (2) *The website gained exactly one optional section.* The six sections stay positional; a seventh, `form`, may sit immediately before the closing action, and nothing else may be added, removed or moved. Composition beyond that is its own work. (3) *One way in for an anonymous response.* `submit_public_form_by_key` is the only anonymous write: the hosted page, a website, an embed and a hostname page all end there, and the caller may claim only `hosted`, `website` or `embed` as source. `portal` and `booking` are true only when the portal's binding or Booking says so. (4) *A portal response is about the customer the link was made for*, read from the caller's own binding by the database; nothing a form carries can name another. The link's token is presented again by the action because a page render cannot keep a session. (5) *A response is not a customer.* A person with authority may link one, offered by CRM's own matching rule (`app.contact_matches`) and never a second one; creating a customer from a response is not built. (6) *A public write ends only the session it began* (`openPublicSession`); the forms path and the marketing intake both signed a signed-in owner out. Booking, the portal and proposal links only ever sign in. (7) *Addresses.* A form has an immutable public key and the stable link is `/f/{key}`; the readable `/forms/{business}/{form}` and a hostname's `/forms/{form}` depend on slugs that can change, and say so. The application may not be framed by another site except `/embed/forms/{key}`, which shows only what the hosted page shows. (8) *Abuse.* One policy function, `app.form_submissions_per_minute()`, caps a form's total responses a minute inside the one recorder; a per-sender or provider-backed policy replaces its body, and no door changes.

**Not decided here.** `form.submitted` as a selectable Automation trigger: a rule runs against a work item, a form response is not one, so the event is emitted and consumable but no rule UX exists. Custom-domain form addresses (only the managed address is shown). Creating a customer from a response. Booking intake migration. Whether tenants may build their own website (only the platform bootstrap creates a site today).


### D80 — A portal link is exchanged once for a session; the session, not the link, is the customer's request identity

**Decided.** (1) *An access link is not a session.* A business sends a link; opening it is a route handler (`/portal/{token}`) that exchanges it for a session kept in a cookie and redirects to `/portal`, an address with no secret in it. The old page signed the visitor in while *rendering*, and a render cannot write a cookie, so the session lasted for that one render and every action after it ran with none — the invoice "Pay" action included. Forms worked around it by posting the token again; that workaround is removed, and no portal operation accepts a token, an organization or a customer from the browser. (2) *The portal session has a cookie of its own* (`gold-portal`, `HttpOnly`, path `/portal`, `SameSite=Lax`, `Secure` in production), separate from the account session's. A business owner trying their own customer link in a second tab keeps their Studio session and a booking visitor keeps theirs; one identity never replaces another. (3) *Customer ≠ portal identity ≠ organization member.* The CRM customer is the business relationship; the portal binding (`external_actors` with `customer_id` and the link it came from) is authority to customer-facing operations; a membership is authority inside the business. The exchange binds only an anonymous session, so a signed-in account can never be bound as a customer. (4) *`PortalContext` is the one resolution* — `portal_context()` in the database, `requirePortalContext` in the domain: organization, customer, the link and when the exchange ends. A record id is still accepted from the browser because the policy that answers for it reads the same binding. (5) *Semantics, chosen rather than accidental.* The link is reusable until revoked. Each exchange ends the browser's previous portal session and starts a new one (no session fixation; one portal session per browser, so a second business's link replaces the first). An exchange is good for 30 days and reopening the link renews it. Revoking the link ends every session made from it on the very next request, because `app.current_external_customer()` — which every portal policy and function reads — answers null once the link is revoked or the exchange expired; no session table and no sweep. Several devices each hold a session. Passwordless: the link proves possession, as it always did.

**Not decided here.** A portal capability model (`portal.forms.submit`, ...): entitlement, activation and customer authorization stay three separate checks as they are, and nothing yet needs a fourth. Customer-created portal accounts, passwords, per-device session lists.

### D81 — A booking may ask one of the business's forms; the answers are recorded in the booking's own transaction

**Decided.** Booking owns the booking — service, slot, resources, price, status and the name and contact it needs to exist. Forms owns configurable questions, their validation, revisions and answers. They meet at one reference: `work_item_types.booking_intake_form_id`, accepted only for a published, non-archived form of the same business on a type that is on the booking page (a trigger, so every writer meets it; withdrawing the type clears it). The public page renders that form's published revision with the shared field renderer (`FormFields`), never a booking-shaped copy. The browser sends a revision id and answers and never names the form; `create_booking` reads it from the type and records the response through `app.record_form_submission`, the one recorder every door ends in, in the same transaction — so a stale revision or an invalid answer refuses the *booking*: no work item, no resource held, no response. This replaces D77's "recorded after the booking succeeds", which could leave a booking whose answers a second write had lost. A booking-linked response carries `booking_work_item_id` (a composite reference; one response per booking) and the customer the booking found or made; `link_form_submission_customer` refuses to rewrite it. The form's per-minute flood guard does not apply to it — the booking's own controls (one booking per visitor, a free resource, the visitor's binding) do. A form archived after configuration asks nothing, so a booking is never held hostage to it. `form.submitted` carries identifiers only, now including `work_item_id`.

**Not decided here.** Rescheduling asking the questions again; reading a booking's answers with a capability narrower than `organization.manage`.

### D79 — A call is one business fact settled from its legs; a number is an identity whose readiness is read

**Decided.** (1) *The Call is the business's; a leg is the carrier's.* A conference has a telephone per person in it, each with its own provider identifier, and the first version of the schema treated whichever reported first as the call: the agent leaving a cold transfer was "the call completed", and billed. Only a participant now carries an identifier (`calls.external_id` is gone). The call is *answered* when two legs are connected at once, *ends* when its last leg leaves, takes its status from its legs, and is billed once, when it first becomes `completed`, for the longest any one leg was connected — one commercial meter (`voice_minutes`) per business call, with the conference's participant-minutes recorded as a cost component, not a second charge. (2) *Forward only, for everyone who writes.* A call's status and a leg's are guarded by a trigger, not by each writer remembering; a late *ringing*, a second ending or a retried callback is a no-op. (3) *An unknown caller is a call.* `customer_id` is nullable; a customer is linked only when exactly one of the business's customers holds the number (the rule a conversation uses) or a person with authority says who it was, never created. A withheld caller id is a call with no origin. (4) *Inbound is recorded by the carrier's own callback, for the business whose number rang.* `record_inbound_call` derives the business from the called number alone and records the call as not answered, because nothing routes a live call yet; it does not improvise a greeting. (5) *Controls tell the truth.* The carrier is asked first and the database told after; a leg the carrier has not named cannot be controlled; a refusal leaves the call as it was. A cold transfer releases the agent only once the destination has answered. Leaving a call (turning off "ends the room on exit", then going) is a different act from ending it. (6) *A tenant writes none of what the carrier says.* No role has `update` on `calls`, `insert` on a leg or a read of a recording's address; the narrow doors are `fail_call_attempt`, `record_call_outcome` (which no longer overwrites status or a carrier's duration), `set_call_leg_provider_id` (once), `link_call_customer` and `call_recording_reference`. (7) *A number says what it can do for calls and for texts separately; whether it is ready is read.* `phone_number_readiness` derives four words from the provider resource and binding under the reader's own rights; the stored `health` that nothing wrote is gone. A number GildOps does not hold cannot take inbound traffic. Which number a person dials from is one function, `resolve_outbound_number`.

**Why.** A call that ends when a leg ends cannot be transferred, supervised or held without lying to the person who reads its history or the person billed for it; and a screen that shows a state the carrier never agreed to is worse than no screen. Both fail in ways no unit test of a single function finds, because each part is correct about its own leg.

**Rejected.** Keeping a provider call id on `calls` "for convenience": it invites the next reader to treat one leg as the call. Billing per leg: a three-party conference would cost three calls, and the commercial model never said so. Recording an unanswered inbound call as `ringing` until the carrier says otherwise: with no route wired to the request it would stay ringing forever.

**Not decided here.** Answering a live inbound call (routing, hours, queues — Phase G), the browser being the *called* party, a per-business signing key for the browser's credential (the token is the deployment's), mirroring the recording into this platform's own storage, and retiring the routing preview's second outbound-identity resolver. The conference minutes are the longest leg's, and may differ by seconds from the carrier's bill; reconciliation is where exactness belongs.
