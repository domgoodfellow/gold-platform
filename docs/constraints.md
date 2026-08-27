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

- **Never build a module before a second business needs it.** *Business* means a second
  paying company — not a second place in this codebase. The first business gets code written
  for it; the second reveals which parts were actually general. A module extracted from one
  business is that business's implementation wearing a costume.
- **Do not confuse that with extracting a rule, which has a far lower bar.** A second
  *caller* — another route, server action, or AI tool in this repository — is enough, and can
  arrive in week one inside a single business. See *Never duplicate a rule across callers*
  below. The two rules pull in opposite directions on purpose: extracting a function stops
  two copies drifting apart, while naming a module claims a generality that one business
  cannot possibly evidence.
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
- **Never reference one tenant-owned table from another without carrying `tenant_id` in the
  foreign key.** `references customers (id)` is the reflex and it is wrong: RLS on the
  referencing row checks *that row's* `tenant_id` and is satisfied, while the id it points at
  belongs to someone else. The reference must be composite — `(tenant_id, customer_id)` to
  `customers (tenant_id, id)` — which needs a `unique (tenant_id, id)` on the target. This is
  I18, and unlike most of this section it is not caught by RLS at all. See the failure below.
- **Never separate tenants by provisioning.** Not a bucket per tenant, not a schema per
  tenant, not a project per tenant. Isolation is `tenant_id` and RLS; files live in shared
  buckets under a tenant-scoped path prefix, with the row in `documents` as the authority on
  who owns the bytes. Per-tenant provisioning is operational work that grows linearly with
  customers and proves nothing RLS has not already proved.

> **The failure a composite reference prevents.** A junction table joining customers and
> locations, with plain `references customers (id)` and `references locations (id)`, lets one
> tenant write a row naming their own customer and another tenant's location. Every policy
> passes, because the row's own `organization_id` is genuinely theirs. Verified by removing
> the composite key: the insert succeeds and RLS raises no objection.

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

**Vendor** in this file always means a third-party *service provider* — Twilio, Stripe, a
maps or weather API. It never means the packaging sense of *vendoring* source code into a
repository, which D1 refers to as bundling for exactly this reason.

- **A vendor belongs behind an adapter.** Twilio, Stripe, ElevenLabs, Google, and any map or
  weather provider are implementation details. Domain code names capabilities — *place a
  call*, *charge a card* — never providers.
- **Never scatter provider logic into domain modules.** If a domain file imports a vendor
  SDK, the adapter is missing.

---

## Decisions

### D1 — `tire-app-template` is a reference, not the base

GOLD starts fresh. No code from `tire-app-template` is **migrated, forked, or bundled in**:
not moved here and continued, not copied into a second codebase that then diverges from the
first, and not checked into this tree as frozen source that GOLD imports but never maintains.

(That third practice is normally called *vendoring*. This file avoids the word, because
**vendor** here always means a third-party service provider — see the Vendors section.)

Whether **Pneu3L itself eventually onboards as a GOLD tenant** is a separate question from
where its code lives, and is deferred to M4. That would be migrating a business, which
happens through configuration — not migrating a codebase, which is what this decision
refuses. Until then Pneu3L runs on `tire-app-template`.

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

### D13 — pnpm workspaces, no build orchestrator

`pnpm` is pinned through `packageManager`. The workspace glob is `apps/*` and nothing else.
The root `check` is `pnpm -r --stream check`; each package owns its own gate. There is
exactly one `pnpm-workspace.yaml`, at the root — `create-next-app` writes a second one inside
`apps/web`, and a workspace file inside a package makes that directory its own workspace root
and silently detaches it from the monorepo.

**Rejected: npm.** `tire-app-template` is not evidence for npm so much as evidence that the
question never arose there: it has no root `package.json`, no root lockfile, and no workspace
file at all. `apps/web/package.json` is the entire project, and `apps/` is a tidy folder
rather than a glob. That is a coherent choice for one application, and it cannot express D3,
which needs `apps/*` and `services/*` to mean different things.

**Rejected: Turbo.** `saas-agent-platform` runs `turbo@^2` over `apps/*`, `services/*`, and
`packages/*` — a task graph with caching and topological `dependsOn` ordering. Its
`packages/` directory contains exactly one package. A dependency graph with one node does not
need a scheduler, and the rule against workspace packages with one consumer keeps this graph
flat by design.

**The two prior repos disagree and pnpm wins**, not on package-manager merits but because
D3's layout needs a workspace glob doing real work, and npm's is weaker where it matters.

**Consequence:** `pnpm --filter @gold/web check` is a filter over a real workspace, so it goes
on working unchanged when `apps/desktop` arrives. A Python service under `services/` stays
outside the glob entirely — stricter than `saas-agent-platform`, whose glob includes
`services/*` and then relies on `services/api` having no `package.json` for pnpm to skip it.

**Trigger to revisit:** the first genuine second workspace package — M7's `packages/ui`. At
that point `pnpm -r` rebuilds what did not change, and Turbo's caching starts earning its
configuration.

### D14 — Next.js App Router, `@supabase/ssr`, one caller-JWT client per request

Exactly one place constructs a client for a web request — `apps/web/src/lib/db/server.ts` —
using `createServerClient` with the anon key. `src/proxy.ts` (Next 16's rename of
`middleware`) rotates the refresh token on every request through `lib/db/session.ts`, because
a Server Component cannot write cookies once the response has begun streaming. `.env.local`
holds the anon key and nothing else.

**Rejected: a service-role client in the application, with tenant scoping by query filter.**
It is the shortest path and it deletes D4. One forgotten `where` is a cross-tenant leak, and
the connection doing the work has already bypassed the RLS that D4 names as the boundary. The
leak is invisible in review because every query still looks correctly written.

**Rejected: `getSession()` in the proxy.** It trusts whatever the cookie asserts. `getUser()`
revalidates against the auth server, and that call *is* the refresh — it must never be pruned
as an unused result.

**Consequence:** `Db` is by construction bound to a caller. An operation that genuinely needs
privilege gets a narrow `SECURITY DEFINER` function in a migration — `create_organization`,
`create_customer`, `create_role`, `assign_role` — never a privileged client in TypeScript.
That keeps the privileged surface enumerable in one directory instead of diffuse across the
application.

**Trigger to revisit:** the first writer with no human caller — a scheduled job, or M6's
Python plane handling an inbound webhook. That caller gets its own Postgres role and its own
policies. It does not get service-role.

### D15 — Raw SQL migrations, and generated database types checked in

Migrations are hand-written SQL under `infra/supabase/migrations/`, applied by the Supabase
CLI, commented for *why*. The TypeScript view of that schema is **generated, not written**:
`pnpm db:types` writes `apps/web/src/lib/db/database.types.ts` from the live local schema, the
file is checked in, and `Db` is `SupabaseClient<Database>`.

**Rejected: an ORM.** The load-bearing artifacts here are not tables. They are RLS policies,
`SECURITY DEFINER` functions with a pinned empty `search_path`, composite foreign keys,
expression unique indexes such as `customers_org_email_unique on (organization_id,
lower(email))`, and the exclusion constraint I7 will need. No ORM schema language expresses
that set, so an ORM would own the boring half and leave the half that enforces the invariants
in raw SQL — two partial sources of truth, against the rule that migrations *are* the source
of truth for the data model.

**Rejected: leaving the client untyped.** This was the state until this decision, and it is
the state of all three prior attempts — `tire-app-template` has no generated types, and
`saas-agent-platform`'s own ADR 0004 records that "no generated Supabase types exist yet
anywhere in the codebase". The cost is visible rather than theoretical: the domain layer had
accumulated a dozen casts of the form `row.id as string` and `row.email as string | null`,
each one hand-copying a column type out of a migration, and each one silencing exactly the
error generation catches. Every one of them is deleted by this decision.

**Rejected: generating at build time instead of checking the file in.** It would make the
typecheck step require Docker and a running database, and it would leave nothing in review to
read when a migration changes a column's type.

**Consequence, and the boundary of the tool:** generated types are authoritative for tables,
columns, and their nullability. They are **not** authoritative for function arguments —
Postgres records no nullability for parameters, so `p_email text`, which accepts null by
design, is emitted as `string`. Two casts in `customers.ts` bridge that gap and say so. A
stale generated file is worse than none, because `tsc` will validate every query against a
schema that no longer exists and pass — so `schema-conformance.test.ts` compares the
checked-in file against `pg_attribute` and fails naming the column that drifted.

**Trigger to revisit:** none plausible for the ORM half; adopting one after live policies
exist is a rewrite. For the types half: if `supabase gen types` starts emitting argument
nullability, the two casts go.

### D16 — vitest against a real local Postgres, and the gate is typecheck, lint, test, build

`vitest` in `environment: 'node'`, `fileParallelism: false`, credentials read from the
gitignored `infra/.env.test`. Two client kinds: `@supabase/supabase-js` bound to genuinely
signed-in users for behaviour, and raw `pg` for catalog assertions. Service-role appears once,
to mint test users — never to exercise a policy.

The gate is `pnpm --filter @gold/web check` = `typecheck && lint && test && build`, in that
order, and nothing is finished until it passes end to end.

**Rejected: `node --test` with type stripping.** `tire-app-template` runs
`node --experimental-strip-types --import ./tests/register.mjs --test`, which adds no
dependency and is genuinely attractive. The cost is visible in that repo: node's type
stripping does not resolve `tsconfig` path aliases, so although its `tsconfig.json` defines
`@/*`, every test imports the domain layer as `../src/lib/domain/scheduling/blocks.ts` —
relative, with an explicit `.ts` extension, in a different import style from the application
it is testing. Our tests import `@/lib/domain/...`, the same way the application does.

**Rejected: mocked or in-memory database tests.** A fake cannot prove a policy, and a policy
is what M1 claims.

**`build` is in the gate on purpose.** `saas-agent-platform`'s `repo:check` runs format, lint,
typecheck, audit, and test — and not build. A Next application can typecheck cleanly and
still fail to build.

**Consequence:** the suite requires Docker and `pnpm db:start`; there is no offline mode, and
CI must stand up Supabase. `fileParallelism: false` because every test file shares one
database.

**Trigger to revisit:** the gate becomes slow enough that people stop running it before
committing. The answer then is a schema or template database per test file — never a fake.

### D17 — Tenant identity reaches Postgres as the caller's own JWT

End to end: Supabase Auth issues a session; `@supabase/ssr` carries it in cookies; the proxy
rotates it; every `Db` handle is bound to that access token; Postgres sees `auth.uid()`;
`app.current_tenant_ids()` maps it to a set of organization ids; every policy calls that
function and nothing else. `app.has_capability(organization_id, capability)` extends the same
path from "which tenants" to "may this actor, here".

Three properties carry the weight:

- **It returns `setof uuid`, never a single id.** That is what makes Standard and Private the
  same code — Private is a database where the set has one element, not a branch.
- **It is `SECURITY DEFINER` with `search_path = ''`.** A policy on `memberships` that selects
  from `memberships` recurses; this function is the designated break in that cycle, and the
  pinned empty search path means nothing inside it can be shadowed by a caller's.
- **No tenant id is ever supplied by the application.** RLS is the boundary; an application
  filter is an optimisation.

**Rejected: the application setting a tenant GUC** — `set_config('app.tenant_id', ...)` on a
shared or service-role connection. This is the common pattern and it inverts D4: the
application becomes the boundary, one missed `set` on one code path is a cross-tenant leak,
and it discards `auth.uid()`, which I11 needs for attribution.

**Rejected: resolving the tenant from a subdomain or path segment.** Routing convenience,
never an authorization input. `/organizations/[organizationId]` is a route parameter precisely
because RLS re-derives the answer regardless of what the URL claims.

**Rejected: an active organization on the session.** Session state RLS would then have to
trust, and no second caller needs one.

**Consequence:** I3 is a database fact rather than a convention, and "which tenant" is never
an argument to a domain function. A direct PostgREST call is refused exactly as a form is,
which is what I16 exists to keep true.

**Trigger to revisit:** M6's Python plane needing to write with no human JWT. Per D2 it
proposes and TypeScript executes, so this may never arrive — but if it does, it gets its own
Postgres role and its own policies, not a service-role bypass.

### D18 — Custom fields land with the registry that governs them, inside M1

D7 says per-tenant custom fields land "in the kernel, not a later phase". The rule above says
no column without a caller in the same change. Read as instructions to a single slice, these
contradict each other: a `custom jsonb` column on a table whose `field_definitions` registry
does not exist yet is a column nothing reads.

They are not instructions to a slice. The kernel is M1, and M1 is several slices. D7 binds the
milestone: no entity table ships a `custom` column before the registry that governs it exists,
and the registry ships before M1 closes. Between those two points the ordering is free, and
the tenancy, customer, and roles slices were right to omit both.

**Rejected: adding `custom jsonb not null default '{}'` to every kernel table pre-emptively**
so that nothing has to be retrofitted. That is a column nothing reads on every table in the
schema, plus a GIN index over empty objects — the exact speculative abstraction this file
names — and it does not even buy the thing it is for: the expensive half of the retrofit is
the registry and its policies, not the column.

**Rejected: deferring custom fields to M3 with the rest of configuration.** That is the "later
phase" D7 refuses. M4 onboards a real business, and from that point the entities hold
production data.

**Consequence:** `roadmap.md` M1's acceptance criteria name field definitions explicitly, so
the milestone cannot be declared done while D7 is outstanding. That is what gives D7 teeth —
without it, "lands in the kernel" is a sentence nothing checks.

**One part of D7 is deliberately not built yet, and this is where that is recorded.** D7
describes the `custom` column "with a GIN index for querying". There is no GIN index, because
nothing queries by custom value: an index with no query is the same speculative abstraction as
a column with no reader, and a GIN index over a column that is `{}` on every row is worse than
useless. The asymmetry is what makes this safe to split — adding the index later is
`create index concurrently` against a table whose shape does not change, while adding the
column and the registry later is precisely the migration D7 exists to avoid. The expensive
half shipped. Reverse this the moment a screen filters on a custom value.

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
