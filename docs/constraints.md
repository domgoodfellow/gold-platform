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
| **1. Kernel** | The entities every business gets and none can decline | Us, in a migration | `lib/domain/`, `infra/supabase/migrations/` |
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
| **Maintenance** | Customer-owned assets, readings, condition-triggered work | Assets and readings built; recurring plans are not |
| **Dispatch** | Routes, travel time, geographic assignment | Not built — see *Deferred* |
| **Inventory** | Stock levels, suppliers, purchase orders, shipments | Not built — see *Deferred* |
| **Voice** | The realtime communications plane, the dialer | Not built — M9 |

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
    components/           the design system
    features/             UI a second surface needs
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
infra/supabase/           migrations, policies, snippets
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

### D23 — The interface has a decided visual language

**Decision.** One design system in `apps/web/components/`, one set of colour roles read from
variables, one neutral treatment for tenant-owned words. `docs/ui-spec.md` holds the surfaces, the
renderings and the control set.
**Why.** Five surfaces do not share a navigation model, and only the operator shell has an
information architecture. A control reads a variable and never a literal, which is what makes a
per-tenant theme a question of where values come from rather than a second pass over every screen.
**No colour is keyed to what a status means.** The platform does not know what a tenant's status
means; two words in two languages are the same shape of row.

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

**Decided before the browser dialer is built, because it is the shape of that dialer rather than
a feature added to it.**

M9's first slice records a call as one row with two telephone numbers on it. That is enough to
write down what happened and not enough to *do* anything while it is happening. Hold, transfer,
merge and a supervisor listening in are the four things a floor asks for, and a plain two-leg
dial supports none of them: there is no third party to add, no participant to mute, and no way to
hand the far end to somebody else without dropping the call in front of them.

**In a conference each of those is one operation on one participant.** Hold is a flag on a
participant. Merge is a participant joining. Transfer is one joining and another leaving. A
supervisor is a participant nobody else hears, and coaching is that same participant heard by one
side only. The capability is not four features; it is one structure with four verbs.

**So a call is a conference from its first second, including the ones nobody ever transfers.**

**The cost, stated rather than buried.** A conference is billed per participant per minute, on
every call, forever — a fraction of a cent, paid on all of them to buy something used on a few.
That is a real ongoing charge and it should be argued with rather than waved through.

**Rejected: a conference only once somebody presses transfer.** This is the obvious saving and it
does not work. A two-leg call cannot become a conference without the parties hearing it happen,
so *upgrade on demand* means dropping and redialling the person being sold to, at the exact
moment the conversation got interesting. It also means two dial paths, two sets of callbacks and
two things to keep in agreement — which is the second answer to one question that I5 and I4
refuse one level up.

**Rejected: waiting for a customer to ask for transfer.** Ordinarily that trigger is right and
this file says so repeatedly. It fails here because the cost of the deferral is not a later
feature, it is rebuilding the dialer — the one screen a floor stares at for eight hours, and the
one place a rewrite is most visible.

**What this decides about the schema.** `calls` keeps its meaning as *the conversation*; a
participant is one party's leg, with its own provider identifier, its own status, and its own
joining and leaving. I2 and I18 apply unchanged: a participant carries `organization_id` and
reaches its call through a composite key. **The recording belongs to the conference and not to a
leg**, because what a business plays back is the conversation.

**What this does not decide.** Whether an agent on a call is a `Resource` in the scheduling
sense — which would make a call something that occupies a person for a window, and put it in
front of the exclusion constraint that stops double-booking. There is an argument for it and no
caller yet, and D5's ordering says the answer arrives when dispatch and the floor have to share a
person.

### D39 — The tenant's telephone account is a subaccount of GOLD's, and what is stored is an identifier

**The question every customer asks: do I bring my own accounts?** For the database and the
hosting the answer is never — a tenant is a row under RLS, and a tenant with its own deployment
would be a fork with its own migrations rather than a customer. For the carrier it is a genuine
fork, and this is the answer.

**GOLD holds the master account and each business gets a subaccount.** Numbers belong to the
subaccount, so one business dialling from another's number is impossible at the carrier rather
than prevented in application code — I2 expressed one layer further out than usual. What is
stored against a tenant is a **subaccount identifier**, which is not a credential and grants
nothing on its own.

**This is D27's shape and D27's opposite ownership, and the difference is worth stating.** On
payments the tenant holds the account because they must be the merchant of record and their
customers' money must never touch a balance of ours. Neither applies here: no customer money
flows through a telephone call, and nothing requires the business to be the account holder. So
what carries across from D27 is the *storage* rule — an identifier, never a secret — rather than
the ownership, and the two records agree on the thing that matters and differ on the thing that
does not.

**Rejected: a business pasting an authentication token into a settings form.** The shape D27
already refused. A carrier's auth token is a real credential: it needs somewhere to live that RLS
alone does not protect, a rotation story, and an answer for the day it is revoked. D33 names that
as the reason a tenant's own integrations are an axis rather than a feature, and none of it has
been built.

**Rejected as the default: the tenant's own carrier account.** `market.md` says the buyer is a
business with no system. *Open a carrier account, register your brand, buy a number* is not
onboarding — it is four reasons not to start. **It remains the escape hatch**, for a business
arriving with numbers and a registered reputation already attached: they authorize GOLD from
their own account and what gets stored is still an identifier rather than a secret. Same table,
same rule, built when a customer needs it and not before.

**The liability this bought is gone, and D40 is what removed it.** This record originally said
GOLD is billed for every call every tenant makes and rebills them, so a business that runs up
spend and does not pay is our loss rather than the carrier's problem -- and that a per-tenant
spend limit was therefore part of this decision rather than a later refinement. **Credit is
bought in advance**, so there is nothing to rebill and no exposure to carry: a business that has
not paid has nothing to spend. The spend limit turned out to be the balance, and the "later
refinement" turned out to be the thing that made the whole model safe.

**A suspended or failed subaccount is a row, not a log line** — D33's rule, and the same one M6
settled for automations (I25). A business whose calls have stopped must be told why by the
application, not by silence.

---

### D40 — Reaching people is paid for in advance, and a balance is a sum

**The question this settles: does charging a tenant for calls make GOLD a metered business.**
`market.md` says billing the tenant is not needed and that implementation and platform fees are
invoiced. Telephony costs real money per minute, so something had to give, and there were two
shapes available.

**Rejected: metering.** Count the minutes, bill at the end of the month. That is a utility
company: invoices, arrears, dunning, credit risk, revenue recognised over a period, and a
collections problem the first time a floor has a bad quarter. It is a different business from the
one `market.md` describes, and adopting it to support one feature would be the tail wagging the
dog.

**Chosen: credit bought in advance.** A business buys a pack, calls draw it down, and at zero the
dialling stops. **Nobody can spend money they have not already handed over** -- no arrears, no
dunning, no exposure, and no invoice at the end of anything. A pack of credit is a *thing
purchased*, which is the same shape as an implementation fee rather than a new one.

**So `market.md` needed one row corrected rather than its position rewritten**, and that is the
whole of the change: *billing the tenant* moves from "not needed" to "one route, prepaid, bought
up front". The business model is unchanged. This record exists because the distinction between
those two sentences is exactly the kind that gets lost, and the wrong reading of it builds an
invoicing system nobody wanted.

**Three decisions inside it.**

- **A balance is a sum of a ledger, never a column** (I4). `communication_credits` is append-only
  and signed -- positive in, negative out -- and `public.credit_balance` is the one answer. A
  balance column would be a second truth, and the two disagree the first time one is written
  without the other. Nothing has measured a slow query here yet; when something does, the answer
  is an index rather than a stored total.
- **The refusal lives where the spend starts, in the database.** `open_call` asks
  `app.may_spend_on` before it writes a room and long before the carrier is asked. A balance
  check in a screen is a suggestion an automation, an AI action or a second caller walks past --
  the same argument that puts every capability check in a policy rather than in a component.
- **Nobody signed in may add credit.** No policy on `communication_credits` permits an insert, so
  a member topping up their own purse is impossible rather than merely ungranted -- and staff
  cannot do it either, because I21 gives them no write grant on any table. Money in arrives from
  a payment through a machine role, which is the shape `payment_webhook` already established.

**A rate is GOLD's price and is written by migration.** `communication_rates` carries no
`organization_id` -- it is not a tenant's row, which puts it outside I2 the way `platform_staff`
is rather than in breach of it -- and there is deliberately no application write path at all. A
price list that changes rarely and must change deliberately is a deploy, and that is the correct
cost.

**Nothing is seeded, and that is what makes this safe to land.** With no rate for a channel, that
channel costs nothing, draws nothing down and refuses nothing: every existing tenant keeps working
exactly as it did. Credit becomes load-bearing on the day somebody decides what a minute is worth,
which is D31's shape applied to money.

**One thing it does not solve: the spread.** A rate exists per currency because amounts are never
converted (I10), so a Canadian business holds a balance in its own currency while the carrier
bills in another. GOLD carries that difference. Converting instead would need a rate, and a rate
has a date, and a date makes this accounting software.

**Not built here, and named so it is not reinvented:** the purchase itself. A tenant paying GOLD
is a charge on *GOLD's own* processor account and must never be confused with D27's flow, which is
a tenant's customers paying the tenant on *their* connected account with the money never touching
a balance of ours. Opposite direction, different account, different code path. Until it exists, a
purse is filled by a migration or not at all.

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
