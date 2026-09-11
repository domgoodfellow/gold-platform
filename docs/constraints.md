# Constraints and decisions

What this platform is, where each piece goes, and the decisions already taken.

Read the first two sections to understand the shape. Read *Rules that protect data* before
touching schema or auth. Read a decision record before changing the thing it governs.

**How to read a rule here.** There are two kinds and they are deliberately separated, because
they are not equally serious. Break a rule in *Rules that protect data* and a customer sees
another customer's rows, or a record you cannot reconstruct is destroyed. Break a rule in *Rules
that keep the code sane* and you lose an afternoon. Both are worth following. Only one is worth
stopping a release for.

**Nothing here says "never build this."** Where something is not built, it is in *Deferred, with
triggers* at the bottom, with the specific event that starts it. If you find a refusal in this
file with no trigger, that is a defect — report it.

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

## The four layers

Every part of this platform sits in exactly one of these. Naming the layer is the first step in
any design conversation, because the rules that apply are different in each.

| Layer | What it is | Who changes it | Where it lives |
|---|---|---|---|
| **1. Kernel** | The entities every business gets and none can decline | Us, in a migration | `lib/domain/`, `supabase/migrations/` |
| **2. Engines** | Code that owns rules — scheduling, pricing, automation, reporting | Us, in a migration | `lib/domain/<engine>/`, plus Postgres functions and constraints |
| **3. Modules** | Capabilities a tenant switches on and is billed for | A tenant, with a switch | `lib/navigation.ts` `MODULES`, plus a row |
| **4. Configuration** | Everything a business says about itself | A tenant, on a screen | Rows in their own tables |

**The kernel is:** organizations, memberships, users (via Supabase auth), roles, customers,
locations, assets, documents, resources, operating hours, events, custom fields, statuses.

**Configuration is:** terminology, statuses, transitions, fields, forms, roles and their
capabilities, prices, hours, currency, timezone, automations, message templates, reports,
dashboards. None of it is hardcoded. All of it is rows the tenant owns.

**A module is not a directory.** It is a row and a line in `MODULES`. An engine is not a
product. The two are not one-to-one: Scheduling, Dispatch, Bookings and Maintenance are four
modules over one scheduling engine, and CRM is a module with no engine at all. Confusing them
once deleted a feature — see D25.

---

## The engines

Each owns entities and rules. This is the honest state, not the plan.

| Engine | What it owns | State |
|---|---|---|
| **Work** | Work item types, statuses, transitions, checklists, time entries, costs | Built |
| **Scheduling** | The calendar, availability, resource assignment, operating hours, double-booking | Built |
| **Pricing** | Price book, quoted lines, invoices, payments, job economics | Built |
| **Automation** | Rules, conditions, actions, message templates, deliveries, counters, external readings | Built |
| **Reporting** | Aggregates, saved reports, audiences, dashboards | Built |
| **Booking** | The public booking flow and the external actor axis | Built |
| **AI** | Domain tools, the answering loop, drafted configuration | Built |
| **Communications** | Sending on a channel, as a capability | Adapter and templates built; channels are per-deployment |
| **Commercial** | GOLD's own catalogue, entitlement terms, provider and retail rates, the usage ledger — GOLD selling GOLD, never a tenant's own books (D42, D43) | Built — D41, generalized |
| **Maintenance** | Customer-owned assets, readings, condition-triggered work | Assets and readings built; recurring plans are not |
| **Dispatch** | Routes, travel time, geographic assignment | Not built — see *Deferred* |
| **Inventory** | Stock levels, suppliers, purchase orders, shipments | Not built — see *Deferred* |
| **Voice** | Calls as conferences, participants, carrier callbacks, a customer's stage | Built — M9 |

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
    app/core/             configuration, database handles, tokens
    app/ai/               the loop, the tool registry, the provider registry
    app/channels/         sending a message, as a capability
    app/conditions/       what the world is doing at a place
    app/integrations/     the only place Python names a vendor
    app/api/              HTTP entrypoints — one file, one route
  desktop/                Electron shell — M10
packages/                 shared code, when a second app consumes it — see D13
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

**On `packages/`.** The source tree lists `types`, `schemas`, `ui`, `config`, `sdk`. Every one of
them is a real target. None is built yet because each needs a second consumer to be anything but
a build step — and the second consumer is a named, scheduled thing rather than a hypothetical.
See D13 and the *Deferred* table, which give each one its trigger.

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

**Decision.** `lib/domain/` in TypeScript owns every business rule and every transactional write.
Python owns what has no human session: webhook ingress, the clock, the model loop.
**Why.** One transactional domain, one place a rule can live. Two would be two implementations.
**Rejected.** A Python domain layer with `domains/crm`, `domains/scheduling` and the rest.

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

**Decision.** Eight files in `docs/` until there is a paying tenant. A new document requires
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
**Trigger to revisit.** The first real second package — `packages/ui` when desktop arrives, or
`packages/types` when `apps/api` shares generated types with `apps/web`. At that point `pnpm -r`
rebuilds what did not change and Turbo's caching starts earning its configuration.
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

### D20 — The four surfaces, and what each waits on

**Decision.** Four surfaces: GOLD's own site, the operator shell, public booking, the customer
portal. Three are built. The **per-tenant marketing surface** — a tenant's own site with pages and
editable blocks — is the one still deferred.
**What is built instead.** One row of copy per tenant, rendered at the top of any public surface:
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
**A second, narrower caller.** GOLD's own homepage (`request_workflow_review`,
`20260909000001_a_workflow_review_leaves_no_way_back_in.sql`) uses anonymous sign-in for the same
reason booking does — I11 needs a real actor — but writes no `external_actors` binding at all,
because there is nothing this caller should ever read back. The target organization is GOLD's own,
which is not a slug a visitor supplies but D42's problem exactly: no migration can name an id that
exists in one deployment, so it lives in `platform_settings`, set by hand
(`supabase/snippets/workflow-review-target.sql`), never accepted as a parameter the function
would otherwise have to trust.

### D23 — The interface has a decided visual language

**Decision.** One design system in `apps/web/components/`, one set of colour roles read from
variables, one neutral treatment for tenant-owned words. `docs/ui-spec.md` holds the surfaces, the
renderings and the control set.
**Why.** Five surfaces do not share a navigation model, and only the operator shell has an
information architecture. A control reads a variable and never a literal, which is what makes a
per-tenant theme a question of where values come from rather than a second pass over every screen.
**No colour is keyed to what a status means.** The platform does not know what a tenant's status
means; two words in two languages are the same shape of row.
**Ownership.** `app/` owns routes and server composition; `features/` owns product-capability UI;
`components/` owns domain-agnostic UI; reusable client interaction moves to `hooks/` only after
the repeated behavior exists. Caller count is an extraction signal, not the primary boundary.

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

### D26 — `apps/api` arrives at M4, and webhook ingress is what brings it

**Decision.** The Python deployable exists because Stripe calls in with no human session. It now
holds three endpoints: the webhook, the automation tick, and the AI ask.
**Why not a route in `apps/web`.** A second thing called *api*, inside the app that is not the
API. There is no `api/` directory under `apps/web` and none may be added.
**The three differ deliberately.** The webhook and the tick hold Postgres roles with no table
grants, because no person is present. The AI endpoint holds **no role** and forwards the asking
person's own token, because somebody is sitting there.

### D27 — A tenant connects their own processor; GOLD never holds their keys or their money

**Decision.** Each tenant connects their own payment account. Funds move between the tenant and
their customer. GOLD is never in the flow.
**Why.** Holding a tenant's money makes this a payment facilitator, which is a different company
with different regulators.

### D28 — Platform staff are a Postgres role, not a membership and not a service key

**Decision.** GOLD staff arrive as the `platform_staff` Postgres role, because
`custom_access_token_hook` rewrites the token's role claim for a user listed in `platform_staff`.
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
about where a vendor's name may live. `tests/integrations.test.ts` proves idempotency (re-importing
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
and a row count — never rows. The loop writes nothing; an intended action is recorded as pending
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
| **Per-tenant marketing surface** — a tenant's site with pages and editable blocks | Nothing technical. `market.md` names it as the third sale to the same customer and moves it up | The next real customer conversation. This is a **revenue line**, and it is the oldest deferral here |
| **The shared control set** — Button, Input, Field, Dialog, Empty state | Nothing. `ui-spec.md` §4 has the inventory and states the acceptance test | Already earned. The design work is done; what remains is writing the controls |
| **Per-tenant theming** | The control set above, so a theme is a change of values rather than a pass over every screen | Control set lands, then a tenant asks |
| `packages/ui` | A second app consuming it | `apps/desktop` — M10 |
| `packages/types` / `packages/schemas` | `apps/api` and `apps/web` needing to agree on a generated shape | The first type that must be identical in both runtimes |
| `packages/sdk` | Somebody outside this repository integrating | The first tenant or partner who asks for an API |
| `packages/config` | Two packages sharing lint or tsconfig | The second node package of any kind |
| **Dispatch engine** — routes, travel time, geographic assignment | A business whose work is genuinely route-shaped | A field-service tenant with mobile technicians and more than a handful of daily jobs |
| **Inventory engine** — stock levels, suppliers, purchase orders | D12 admits the vertical; the engine is a scope decision | An e-commerce or parts-heavy tenant |
| **Recurring maintenance plans** | Recurrence on a calendar — *every first Monday* — is a different question from an interval | A maintenance tenant with contracted plans |
| **Voice plane and the dialer** | M9, D5 | Call volume, not audience: thirty calls need a phone and a list |
| **Desktop** | M10 | No customer has asked |
| **Calendar recurrence** — *every first Monday* | A different question from an interval, which is built | A tenant whose plans are dated rather than metered |
| **Approval workflows** on work items | Changes the commitment flow | A business whose jobs need signing off before they proceed |
| **Richer message templates** — amount, address, who is coming, a link to the customer's own page | Nothing. It is a list rather than a mechanism | Each one must be fillable *reliably every time*; a placeholder that is sometimes blank is a sentence that is sometimes nonsense |
| **Drafting templates from what a business already sends** | Nothing structural — a template is still a row the business owns | The same shape as drafted configuration: propose, review, apply |
| **Two-way email** — a customer's reply attaching to the job it is about | A grant against somebody else's mailbox, refreshing tokens, and a matching problem with no perfect answer | M9, which owns communications. The hardest third of a comms feature does not go first |
| **Terminology overrides** per tenant | A second vertical, before the shape is knowable | The second vertical |
| **Group and proximity discounting** | Travel cost modelling, so a discount never exceeds what the business provably saved | A business that actually routes |
| **Business templates** — a cloneable bundle of modules, statuses, fields and roles | Two businesses configured by hand first | The source conversation calls this the thing that turns four apps into a product, and it is — **second**. A template is an extract of configuration that has already proven itself; cloned earlier, it clones a guess |
| **Incumbent displacement** — import, parity, a reason to switch | Deliberately not scoped | Phase two. Named so it is a recorded decision rather than an assumption |

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

**An unpaid module goes read-only, and never goes dark.** Writes to what that module owns are
refused, with a sentence naming the module and the date its term ended. Reads never stop, export
never stops, and no row becomes invisible — a business that stops paying must always be able to
leave with everything it recorded.

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

### D42 — GOLD runs its own business as an ordinary tenant, and staff is a separate account

**Decision.** GOLD-the-business is a tenant with no exemption of any kind. The people who run GOLD
hold **two accounts**: one listed in `platform_staff`, and one that is an ordinary member of
GOLD's own organization.

**Why two.** D28 makes staff a Postgres role holding no write grant on any table. A single account
that was both would be an operator who cannot write anything, and `/organizations` would redirect
them to `/platform` before they found out. That is not an obstacle to route around — it is the
axis working. Acting as GOLD and acting as a business are two authorization contexts, and putting
both in one token is the thing D28 refuses.

**Why a tenant at all.** This file's own *Known defects* section already says GOLD is tenant zero
and that what tenant zero needs counts as evidence. Reception's first real user is GOLD's own
sales calls, which is the module it most needs to sell.

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

**Rejected, for now.** Staffhood claimed per session — the token hook grants the staff role only
when the sign-in asked for it. It is safe: the claim can only *reduce* privilege, since the hook
still verifies the listing, and one account with two doors is the nicer product. It is deferred
rather than refused because it costs a change to the most security-sensitive function in this
repository in order to save a second login. **Trigger:** the two logins actually getting in the
way.

---

### D43 — GOLD's own commercial/financial control plane, and what it amends

**Decision.** GOLD can now answer, for any tenant: what it bought, what it is entitled to use
right now, what GOLD charged it, what it used, what that usage cost GOLD at a provider, and the
margin between the two. D41 (entitlement) is the middle of this and is built in full by this
record rather than left as a separate deferral; the rest generalizes D40's usage thinking past
voice, SMS and email to every meter this platform will eventually price — call recording,
transcription, text-to-speech, AI tokens, email sends, and whatever a future provider adds.

**The catalogue, and a correction found writing the first provider bindings against it.**
`platform_meters` (what can be metered) and `platform_products` (what GOLD sells, recurring: the
base platform, one row per real module, a seat) are platform vocabulary, migration-written, like
`communication_channel` was. Neither is authorization and neither is read by any policy. **A
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
SID and auth token, a Resend platform key) stay deployment environment secrets, unchanged — D14
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

## Known defects in this document

Recorded rather than quietly fixed, because a constraints file that hides its own faults is
advice.

- **D8's budget counts files.** The failure it exists to prevent is not measured in files. See D8.
- **The evidence bar has no exit for a pre-revenue product.** Admissible evidence is prior
  repositories or a signed customer. The prior repositories are finite and all from one author, so
  "two independent pieces" is weaker than it sounds. The resolution in practice is that **the demo
  is a caller** — GOLD is tenant zero, and what tenant zero needs in order to be shown to a
  prospect counts. `market.md` says this already; this file now agrees with it.
- **`market.md` and this file disagreed about the tenant marketing surface** for as long as one
  deferred what the other called a revenue line. The *Deferred* table above is where that is
  settled; if they diverge again, `market.md` wins on anything about money.
