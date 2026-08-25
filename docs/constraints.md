# Constraints and decisions

The guardrails. Highest value per line in `docs/` — read it before any structural change.

Two kinds of entry live here. **Nevers** are rules with a reason; violating one is a bug
even if the tests pass. **Decisions** (`D1`, `D2`, …) record a fork in the road, what was
chosen, and what was rejected. Cite them from code comments, migrations, and pull requests
so the reasoning travels with the change.

An entry nobody could violate is not a constraint. Delete it.

---

## Never

### Scope and abstraction

- **Never build a module before a second business needs it.** The first business gets code
  written for it. The second reveals which parts were actually general. Modules extracted
  from one caller are guesses wearing a costume.
- **Never create a workspace package with one consumer.** It buys a build step and a
  `dist/` for no isolation. `saas-agent-platform` collapsed `ui`, `shared`, `config`, and
  `assistant-core` for exactly this reason. Code used only by `apps/web` lives in
  `apps/web/src`.
- **Never add a column, table, enum value, or abstraction without a caller in the same
  change.** A field nothing reads is a speculative abstraction that will be maintained,
  migrated, and eventually misinterpreted as meaningful.
- **Never write a document ahead of the evidence.** See D8 for the budget and the
  admission rule.

### Business logic

- **Never let the UI own a business rule.** Not in a React component, not in a route
  handler, not in a server action. Pricing, scheduling, assignment, and status transitions
  live in the domain layer.
- **Never let the AI own a business rule.** Agents call domain tools that validate and
  check permissions. An agent that can reach the database directly has become a second,
  undocumented implementation of the business.
- **Never let the database own a business workflow.** Constraints enforce invariants;
  triggers that quietly perform business steps hide the process from everyone reading the
  application.
- **Never duplicate a rule across callers.** When a second caller needs a rule that is
  currently inline, extract it first, then call it twice. Do not copy it.
- **Never hardcode** terminology, statuses, service types, prices, business hours, buffers,
  or currency. All of it is per-tenant configuration.
- **Never hardcode a claim a business makes about itself** — guarantees, trust points,
  service assertions, section headings. Copy is configuration. Strings describing
  *application state* ("Loading", "No results", aria labels) stay in code.

### Tenancy

- **Never create a tenant-owned table without `tenant_id`, RLS keyed to it, and `tenant_id`
  as the leading column of every unique index and every exclusion constraint.** See D4, and
  see the failure it prevents below.
- **Never assume tenants share a database.** Tenant resolution goes through one function.
  A Private deployment is a database containing one `organizations` row, running identical
  code.
- **Never scope a query by application-layer filtering alone.** One forgotten `WHERE` is a
  cross-tenant data leak. RLS is the boundary; the application filter is an optimisation.
- **Never separate tenants by provisioning.** Not a bucket per tenant, not a schema per
  tenant, not a project per tenant. Isolation is `tenant_id` and RLS; files live in shared
  buckets under a tenant-scoped path prefix, with the row in `documents` as the authority on
  who owns the bytes. Per-tenant provisioning is operational work that grows linearly with
  customers and proves nothing RLS has not already proved.

> **The failure this prevents.** `tire-app-template` has an exclusion constraint that
> coalesces a null technician to the zero UUID, so every unassigned booking in the database
> shares one exclusion key. Add a second tenant and their unassigned 9am job blocks yours,
> as a bare `23P01` with no obvious cause. Its `customers_email_unique` is global too, so
> two tenants could never share a customer email address. Both are correct single-tenant
> and wrong the moment tenancy arrives.

### Sources of truth

- **The database is the source of truth.** Not React state, not a calendar provider, not a
  payment processor.
- **A vendor is authoritative for its own events only.** Stripe knows about Stripe payments.
  Cash and manual payments never touch Stripe and are never recorded as though they did.
- **Never make an external calendar canonical.** Sync flows internal → external, never back.
- **Migrations are the source of truth for the data model.** Read them rather than inferring
  the schema. Comment the *why*; the *what* is already in the SQL.
- **Never modify a migration that may have been applied.** Corrections are new migrations.

### Security

- **Hiding a UI element is not authorization.** Every sensitive operation is checked
  server-side, regardless of what the client could render.
- **Never expose a service-role key to a client.** Secrets and OAuth tokens stay
  server-side, encrypted at rest.
- **Never give an LLM unrestricted database access.** It gets domain tools with validation
  and permissions attached, or it gets nothing.
- **A middleware redirect is not the authorization boundary.** Server-side guards plus RLS
  are.
- **Never build an open redirector.** Any stored destination resolves against a closed set,
  validated on read as well as on write.
- **Never serve a private file from a durable public URL.** Buckets are private; access is a
  short-lived signed URL minted server-side *after* the same permission check the rest of the
  operation gets. Contracts, call recordings, transcripts, and employee records must never be
  reachable by guessing a path.

### Data

- **Money is integer minor units.** Never floats. Currency is per-tenant configuration and
  is never assumed.
- **Time is `timestamptz`.** The tenant's IANA timezone is stored separately and applied at
  render. Never free-text time windows.
- **Never rewrite history.** Amounts and terms are snapshotted onto the record at the moment
  of commitment; catalogue edits are not retroactive. A change after the fact is a new
  adjustment row, never an edit to a snapshot.
- **Consequential writes are attributable.** Who, what, when, and to which entity.

### Vendors

- **A vendor belongs behind an adapter.** Twilio, Stripe, ElevenLabs, Google, and any map or
  weather provider are implementation details. Domain code names capabilities — *place a
  call*, *charge a card* — never providers.
- **Never scatter provider logic into domain modules.** If a domain file imports a vendor
  SDK, the adapter is missing.

---

## Decisions

### D1 — `tire-app-template` is a reference, not the base

GOLD starts fresh. Pneu3L continues to run on `tire-app-template` independently, and that
repo is not migrated, forked, or vendored.

**Rejected:** moving the repo in and retrofitting tenancy. It is genuinely the cheapest
moment to do so — pre-V1, seed data only — but it couples the platform's first months to
finishing one business's admin screens, and a fork would mean building the tenancy migration
twice.

**Consequence:** we lose the free head start and must re-derive the domain layer. We keep
the ability to make the kernel tenancy-correct from the first migration rather than the
fifteenth. Harvest deliberately and cite the source: the invariants form, the migration
commenting style, the pricing and scheduling engines' structure, the constraint that pricing
never leaks the schedule.

### D2 — Python is the intelligence and realtime plane, not the domain layer

TypeScript owns the transactional domain: entities, pricing, scheduling, work items,
invoicing. Python owns what it is genuinely better at and what Vercel cannot host — Twilio
media streams, streaming speech-to-text, the live rebuttal loop, embeddings and retrieval,
route optimisation, and batch analysis workers.

**The contract between them:** the Python plane writes to its own tables (`calls`,
`transcripts`, `agent_runs`, `embeddings`) and *proposes* actions. The TypeScript domain
validates and executes them. This is the same rule as "AI does not own business logic,"
applied across a process boundary.

**Rejected:** a full FastAPI domain layer, as recommended in
`docs/starting_conversation.txt`. That advice predates the evidence. `saas-agent-platform`'s
own CLAUDE.md records the cost:

> `packages/contracts` — Zod schemas describing the Python API's request/response shapes…
> These are hand-maintained TypeScript; the FastAPI service cannot import them, so they are
> a mirror of the API contract rather than a shared source of truth.

A hand-maintained mirror drifts — but `docs/starting_conversation.txt` §7 anticipates that and
proposes the stronger form: FastAPI's OpenAPI output as the source of truth, with the
TypeScript client generated from it. The quotation above rejects hand-maintenance, not
generation, and generation is genuinely better than a mirror. It is still not enough, because
it settles the shape of the contract and not the authorization model behind it: the domain
runs under the caller's JWT with RLS as the boundary, and a service-role FastAPI layer
discards that however its types are produced. That is the argument doing the work.

**Trigger to revisit:** if the realtime plane ever needs to *write* transactional state
synchronously and the proposal round-trip becomes the bottleneck.

### D3 — Python lives in `services/api/`, not `apps/api/`

`docs/starting_conversation.txt` §5 explicitly recommends `apps/api/`, having corrected an
earlier inconsistency. We diverge.

`apps/*` is the pnpm workspace glob. A Python service placed there is a package manager
being asked to manage something it cannot. `saas-agent-platform` hit this and moved the
service, and its README states the reason plainly: *"the Python API isn't a pnpm workspace
package."*

**Consequence:** `apps/` means "a thing pnpm builds and ships." `services/` means "a thing
deployed on its own runtime." One-line reversal if this turns out to be wrong.

### D4 — Shared-schema multi-tenancy with RLS, deployment-neutral

Every tenant-owned row carries `tenant_id`; Postgres RLS enforces isolation; tenant identity
resolves through one function so the application never assumes how many tenants a database
holds.

**Rejected:** schema-per-tenant (migration cost grows linearly with customers) and
database-per-tenant as the default (operations cost grows linearly).

**Consequence:** Private and Enterprise deployments are a deployment topology, not a code
path. This must stay true; it is the cheapest architectural promise to keep now and the most
expensive to retrofit.

### D5 — Field service is vertical one; the dialer is vertical two

**Rejected:** starting with Sales OS, as `docs/starting_conversation.txt` §16 recommends.

Field service exercises the harder half of the kernel — scheduling, geography, work items,
resource assignment, dispatch — which are the primitives that generalise to machinery
maintenance and weather-driven dispatch. Sales OS exercises CRM plus communications, a
narrower slice, and it requires the realtime voice plane to exist first. Building the most
latency-sensitive component before a kernel exists means debugging streaming audio and a
greenfield domain model simultaneously.

The dialer remains the highest-margin product. It is cheaper to build second, once
customers, timeline, and audit already exist for it to attach to.

### D6 — Statuses are data, not enums

Work item statuses, their allowed transitions, and their display vocabulary are per-tenant
rows. A Postgres enum means a migration and a deploy every time a customer renames a column
on their board.

**Consequence:** transition validity is enforced in the domain layer against configuration,
not by the type system. That check needs a test from the first slice.

### D7 — Custom fields are typed core columns plus a `custom` JSONB column

A `field_definitions` registry per tenant and entity type governs what may appear in
`custom`, with a GIN index for querying.

**Rejected:** EAV (unqueryable at any useful scale) and columns-per-tenant (unmigratable).

**Consequence:** this lands in the kernel, not a later phase. Retrofitting per-tenant fields
onto entities that already hold production data is the most painful migration in this
category of product.

### D8 — The documentation budget

**Eight files in `docs/` until there is a paying tenant.** Currently four, plus archived
sources which do not count.

A new document requires either deleting or absorbing an existing one, or naming a specific
decision that was made wrong *twice* without it. "It would be useful to write this down" is
not admission — that sentence is how `saas-agent-platform` reached fifty-three files
including `CLEANUP_RULES.md`, `NAMING_CONVENTIONS.md`, `IMPORT_BOUNDARIES.md`, and
`MAINTENANCE_INDEX.md`. Documents that police sprawl are a symptom of it.

**Tier 1 documents unlock when the code they describe exists**, not when it is planned:
`multi-tenancy.md` when tenancy lands, `security-model.md` when capabilities run,
`provider-adapters.md` at the *second* provider, `billing-usage.md` at the first usage event.

**Never write:** naming conventions, cleanup rules, refactoring rules, import boundaries,
documentation maps, maintenance indexes, correction notes. If this file works, they have
nothing to govern.

### D9 — Status is not tracked in markdown

Milestone definitions live in `roadmap.md`; task state lives on the issue board; shipped work
is recorded in `CHANGELOG.md` on merge. No checkboxes in any document — nothing in git forces
a checkbox to stay accurate.

### D10 — Edge Functions are infrastructure adjacency, never the business backend

Supabase Edge Functions exist for work that must sit next to Supabase rather than next to the
domain: a Stripe webhook signature check, an OAuth callback, a storage-upload hook. They may
verify, record, and enqueue. They may not decide anything.

`docs/starting_conversation.txt` §3 of the final turn reaches the same conclusion for a
different reason — it keeps the business backend out of Edge Functions because the Python
plane needed to be stateful and latency-sensitive. D2 removes that reason and the rule
survives anyway: an Edge Function that prices, schedules, or transitions a work item is a
second implementation of the domain, running where it cannot import it.

**Consequence:** a webhook verifies its signature, writes the vendor's own event row, and
calls the domain. Whether it is hosted in an Edge Function or a Next.js route handler is an
operational choice, not an architectural one — and with the domain in TypeScript, the route
handler is usually the shorter path.

**Never write one before it has a caller.** The same rule as every other abstraction here.

### D11 — Weather is an integration and a trigger, not a module

`docs/starting_conversation.txt` lists Weather among the modules and gives it a worked
business configuration (§21). It is not a module here.

A module owns entities and rules. Weather owns neither. It is a provider behind an adapter
answering *what are conditions at this place and time*, plus automation rules a tenant writes
against that answer — *when the forecast at a work item's location crosses this threshold,
flag the item and notify the dispatcher*. Both halves must exist for other reasons already.

**Rejected:** a `weather` module with its own tables. It needs a Work Item, a Location, and a
Resource before it can say anything, which makes it a rule set over the kernel.

**Consequence:** weather-driven rescheduling is the sharpest available test of the automation
runtime and of I6 — availability shown to a client is advisory and re-asserted server-side
before work is committed — precisely because the external world changes between the two. Use
it as a test case, not as a directory.

### D12 — E-commerce operations is not a target vertical

One of the four systems this platform generalises from is an e-commerce inventory app, so its
absence from `vision.md`'s scope needs a reason rather than a silence.

Field service, asset maintenance, and sales floors all reduce to *a unit of work needs a time,
a resource, and a place*. Fulfilment does not: work is triggered by an order, batched against
stock, and shipped. Building for it now would generalise the kernel along an axis no paying
tenant is pulling on, and the pull is what tells us which parts were actually general.

**Consequence:** parts and materials consumption still lands — a maintenance job consumes
stock, and I8 governs the price it consumed that stock at. That is inventory as a work-item
concern, not a fulfilment engine.

**Trigger to revisit:** a tenant already running on the platform makes selling stock its
primary motion.

---

## Decided, not yet built

Named so they are not reinvented, and deliberately unbuilt until they have a consumer.

- **Approval workflows** on work items — changes the commitment flow; no caller yet.
- **Recurring work generation** — needs the maintenance module's trigger model first.
- **Group and proximity discounting** — a discount must never exceed what the business
  provably saved; requires travel cost modelling that does not exist.
- **Terminology overrides** per tenant — a display-layer concern that needs a second vertical
  before its shape is knowable.
- **Business templates** — a named, cloneable bundle of modules, statuses, fields, and roles,
  so onboarding a field-service business starts from `Field Service` rather than from zero.
  `docs/starting_conversation.txt` calls this the thing that turns four apps into a product,
  and it is — second. A template is an extract of configuration that has already proven
  itself; cloned before two businesses have been configured by hand, it clones a guess. M3's
  test stays the harder one: configure a second business shape with no pull request.
