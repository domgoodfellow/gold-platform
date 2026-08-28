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

- **Never build a module before two independent pieces of evidence want it, at least one of
  them from a system that shipped.** A prior product counts — `tire-app-template`,
  `saas-agent-platform` and `nextfund-portal` are evidence, and D12 already reasons from one
  of them. A discovery call that produced signed intent counts. A hypothesis does not, and
  neither does a second call site in this repository, which is grounds for extracting a
  function and nothing more. The point was never the invoice; it is that a single source
  cannot tell you which parts of itself were general, so a module extracted from one is that
  source's implementation wearing a costume.
- **How you start, because this rule is read as a block and is not one.** Write it concrete,
  in the domain layer, for the business in front of you, named for what it does rather than
  for the category it might one day belong to. Nothing waits on a second anything. The rule
  forbids *claiming* generality, not writing code — and the asymmetry is what makes it cheap:
  extracting a proven function later is an afternoon, while a directory named `pricing` with
  a `README` describing future intent is the speculative abstraction this file exists to
  refuse, and it will be defended for a year because it looks like architecture.
- **Do not confuse that with extracting a rule, which has a far lower bar.** A second
  *caller* — another route, server action, or AI tool in this repository — is enough, and can
  arrive in week one inside a single business. See *Never duplicate a rule across callers*
  below. The two rules pull in opposite directions on purpose: extracting a function stops
  two copies drifting apart, while naming a module claims a generality that one source
  cannot possibly evidence.
- **Never create a workspace package with one consumer.** It buys a build step and a
  `dist/` for no isolation. `saas-agent-platform` collapsed `ui`, `shared`, `config`, and
  `assistant-core` for exactly this reason. Code used only by `apps/web` lives in
  `apps/web/src`.
- **Never add a column, table, enum value, or abstraction without a caller in the same
  change.** A field nothing reads is a speculative abstraction that will be maintained,
  migrated, and eventually misinterpreted as meaningful.
- **What counts as a caller, because this is where the rule above is misread.** A caller is
  whatever uses the thing *in the same change* — a screen, a route, a domain function, an
  operator who needs it on Monday. It is not "a second existing call site"; that is the bar
  for *extracting a rule*, three bullets up, and naming a module at the top of this section
  is harder still. A business that has gone live wanting to see a customer's history is a
  caller. A business that might one day want a dashboard is not.
- **This section's own failure mode, stated so that it stays checkable.** It has removed
  module enablement, dashboard configuration, business rules and terminology overrides — four
  things, from M3 alone. Three of them return in M4 and M5 with shapes that the removal is
  what gave them, which is this section working as designed. It is **over-tuned the first
  time something is removed and does not come back**, and the honest response then is to
  weaken these rules rather than defer the same feature a third time. Removals are recorded
  in `CHANGELOG.md` on the commit that made them (D9), which is what makes that a count
  rather than a feeling.
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

**Resolved at M4, and the answer is fresh.** Pneu3L onboards as a GOLD tenant and its rows do
not come with it. The data there is largely mock, and what was worth keeping was never the
rows: what crosses over is configuration — the service catalogue as price book items, the
service area, the operating hours, the work item types and their statuses — plus the visual
reasoning recorded in D23. That is the milestone's point rather than a shortcut around it. A
business arriving through an import script would prove the opposite of what M4 claims.

**Rejected:** moving the repo in and retrofitting tenancy. It is genuinely the cheapest
moment to do so — pre-V1, seed data only — but it couples the platform's first months to
finishing one business's admin screens, and a fork would mean building the tenancy migration
twice.

**Consequence:** we lose the free head start and must re-derive the domain layer. We keep
the ability to make the kernel tenancy-correct from the first migration rather than the
fifteenth. Harvest deliberately and cite the source: the invariants form, the migration
commenting style, the pricing and scheduling engines' structure, the constraint that pricing
never leaks the schedule.

### D2 — Python is the second runtime; TypeScript owns the transactional domain

TypeScript owns the transactional domain: entities, pricing, scheduling, work items,
invoicing. It runs under the caller's own JWT with RLS as the authorization boundary, and
that property is what every paragraph below exists to protect.

**Python owns four things, not one.** This record used to say "the intelligence and realtime
plane", which was too narrow: it made `apps/api/` read as an accessory to be built last, when
the first of these is needed at M5.

- **Automation execution** — the scheduled evaluation that asks *what is due, what changed,
  what crossed a threshold*. First needed, and the reason `apps/api/` arrives at M5 rather
  than alongside voice.
- **Webhook ingress** — a vendor calling in with no human session behind it. Stripe at M4 is
  the first, and it is the writer D14 and D17 both name as their trigger to revisit.
- **Intelligence** — embeddings, retrieval, batch analysis, the AI tool loop.
- **Realtime** — media streams, streaming speech-to-text, the live rebuttal loop. This one
  does not run on Vercel; see D24.

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

**Trigger to revisit:** if either plane ever needs to *write* transactional state
synchronously and the proposal round-trip becomes the bottleneck.

### D3 — Python lives in `apps/api/`, and the workspace glob is explicit

`docs/starting_conversation.txt` §5 recommends `apps/api/`. This record used to diverge and
no longer does.

The original argument was real: `apps/*` was the pnpm workspace glob, so a Python service
placed there is a package manager being asked to manage something it cannot, and
`saas-agent-platform` hit exactly that — *"the Python API isn't a pnpm workspace package."*
But the glob is one line in `pnpm-workspace.yaml`, not a law, and naming its members costs
one line per deployable:

```yaml
packages:
  - "apps/web"
```

**Reversed because the layout was carrying an argument it should not have.** `apps/` versus
`services/` was made to mean "pnpm package" versus "own runtime", which is a fact about a
tool rather than about this system, and it put the second runtime somewhere the prescribed
layout does not have a directory for. `apps/` now means what that layout means by it: **a
deployable this repository ships.** `apps/web`, `apps/api` and eventually `apps/desktop` are
all that, and `services/` is gone.

**Consequence:** every new deployable adds itself to the glob by name. That is the trade —
a directory under `apps/` that pnpm should not manage is now silently ignored rather than a
build error, so the glob is the first place to look when a workspace package appears not to
exist.

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

**Consequence:** transition validity is enforced against configuration, not by the type
system. That check needs a test from the first slice.

**Where "against configuration" turned out to live, and why it is not only the domain layer.**
This entry originally said the check runs *in the domain layer*. That is where the message
lives, and it is not where the guarantee can live: I12 requires a direct PostgREST update to
be refused exactly as a form is, and TypeScript is not on that path at all. The check is
`app.check_status_transition`, a trigger reading `work_item_transitions` — still
configuration rather than the type system, so the clause actually doing the work in this
decision is intact. The domain layer re-checks the same rows to produce the sentence a person
reads, which is the division of labour `parseCustom` already has with the custom-fields
trigger for I17. A trigger that *refuses* an illegal step is not the database owning a
workflow; one that *performs* a step would be.

**A second thing this decision did not settle, now settled.** A type with no configured
transitions is **frozen**, not unconstrained. The forgiving reading — unconfigured means
anything goes — makes I13 hold vacuously for every tenant who has not yet opened the
transitions screen, which is every tenant on their first day, and it does so silently.

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

### D12 — E-commerce operations is a target vertical

**Reversed.** This record previously refused it. The argument was that field service, asset
maintenance and sales floors all reduce to *a unit of work needs a time, a resource and a
place*, while fulfilment does not: work is triggered by an order, batched against stock, and
shipped.

That distinction is real and it was overstated. Reading `docs/starting_conversation.txt` §6
against the tree closes most of the gap. `price_book_items` is already a per-tenant catalogue
of what a business sells. `work_item_costs` already records a material consumed against a job,
which is a stock movement without a stock level. `locations` is already a place stock could
sit. And the fulfilment lifecycle — Ordered → Picked → Packed → Shipped → Returned — is
`work_item_statuses` and `work_item_transitions`, which are per-tenant rows that already
refuse to be hardcoded, so it needs no new mechanism at all.

**What it costs, stated rather than hidden:** inventory is a real engine — eight operations,
reorder points, lead times, suppliers, warehouses — and it is the third one after scheduling
and pricing. Admitting the vertical is a scope decision and not a free one. What it does *not*
cost is a new kernel primitive, which is what the previous version of this record claimed and
could not support.

**Consequence:** parts and materials consumption still lands as a work-item concern, exactly as
before, and I8 still governs the price it consumed that stock at. Inventory extends that rather
than replacing it. `mamouandco` is the reference for the catalogue and the storefront settings;
D23 records the one column that does not come across.

**Trigger to revisit:** none — this is a decision, not a deferral. *When* the vertical is built
is a sequencing question and lives in `roadmap.md`.

### D13 — pnpm workspaces, no build orchestrator

`pnpm` is pinned through `packageManager`. The workspace glob is `apps/*` and nothing else.
The root `check` is `pnpm -r --stream check`; each package owns its own gate. There is
exactly one `pnpm-workspace.yaml`, at the root — `create-next-app` writes a second one inside
`apps/web`, and a workspace file inside a package makes that directory its own workspace root
and silently detaches it from the monorepo.

**Rejected: npm.** `tire-app-template` is not evidence for npm so much as evidence that the
question never arose there: it has no root `package.json`, no root lockfile, and no workspace
file at all. `apps/web/package.json` is the entire project, and `apps/` is a tidy folder
rather than a glob. That is a coherent choice for one application, and it cannot express a
workspace whose members are named one at a time (D3) alongside a deployable pnpm must ignore.

**Rejected: Turbo.** `saas-agent-platform` runs `turbo@^2` over `apps/*`, `services/*`, and
`packages/*` — a task graph with caching and topological `dependsOn` ordering. Its
`packages/` directory contains exactly one package. A dependency graph with one node does not
need a scheduler, and the rule against workspace packages with one consumer keeps this graph
flat by design.

**The two prior repos disagree and pnpm wins**, not on package-manager merits but because
D3's layout needs a workspace glob doing real work, and npm's is weaker where it matters.

**Consequence:** `pnpm --filter @gold/web check` is a filter over a real workspace, so it goes
on working unchanged when `apps/desktop` arrives. `apps/api` is outside the glob because the
glob names its members (D3) — stricter than `saas-agent-platform`, whose glob includes
`services/*` and then relies on `services/api` having no `package.json` for pnpm to skip it.

**Trigger to revisit:** the first genuine second workspace package — M9's `packages/ui`. At
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

**Trigger to revisit:** the first writer with no human caller — M4's Stripe webhook, then M5's
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
design, is emitted as `string`. Every `create_*` RPC with an optional argument therefore
carries a cast at the boundary, each one naming this decision; they are the only casts of
that shape in the domain layer, and a reviewer seeing one elsewhere should ask why. A stale
generated file is worse than none, because `tsc` will validate every query against a schema
that no longer exists and pass — so `schema-conformance.test.ts` compares the checked-in file
against `pg_attribute` and fails naming the column that drifted.

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

**Trigger to revisit:** M5's Python plane needing to write with no human JWT. Per D2 it
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

### D19 — We do not own a users table, and a person-Resource is not a User

Identity lives in `auth.users` and nowhere else. There is no `public.users`, no `profiles`,
and nothing in `public` mirrors an account. `created_by`, `actor_id` and
`memberships.user_id` reference `auth.users (id)` directly.

**Rejected: a `profiles` table mirroring `auth.users`.** It is the near-universal Supabase
pattern and it is a second answer to "who is this". Two answers drift: a row that exists in
one and not the other is either a ghost account or an invisible one, and the trigger that
keeps them in step is a business step performed by the database, which the Business logic
section forbids. `starting_conversation.txt` lists *Users* among the things every business
gets, which is true of the *concept* and not of a table we write.

**Consequence, stated plainly because it is a real cost:** there is nowhere to put a display
name for an actor. An event can say who did something but not what to call them, so a
timeline renders a uuid. That is the price until something needs the name, and the shape of
what fixes it is not yet knowable — it may be a column on `memberships` (what this tenant
calls this person, which is per-tenant and therefore correct here) rather than a global
profile.

**Trigger to revisit:** the first screen that must render an actor's name. The answer is
most likely a per-tenant display name on `memberships`, not a global mirror.

**That trigger has fired, and this is what it produced.** The people list that arrived with
the M1 membership slice is the screen, and the answer was the predicted one:
`memberships.display_name`, set when someone is added and when an organization is founded.
It is what *this* organization calls that person — the same account is "Sam" in one and
"Contractor" in another, and neither tenant learns anything about the other. `auth.users` is
still not mirrored, and there is still no `profiles` table. What remains missing is an edit
path, which waits for a caller like everything else.

---

**A person-Resource is not a User.** `resources` has no `user_id` and must not gain one
before something reads it.

A Resource is capacity — "there is a technician called Sam who work can be assigned to". A
User is an account that can sign in. A business schedules against people who have never
logged in, and grants accounts to office staff who are never scheduled. The overlap is
real but partial, and modelling it as identity would make every resource an account.

**Rejected: `resources.user_id` now.** Nothing reads it. The moment it exists, three
questions arrive that have no answer yet — whether a resource may exist without an account,
whether an account may hold two resources, and what happens to the schedule when a person
leaves — and each would be answered by guesswork rather than by a caller.

**Trigger to revisit:** a technician must sign in and see the work assigned to them. That
slice adds the link, chooses the cardinality with a screen in front of it, and gets to make
the leaver question concrete instead of hypothetical.

**Consequence for the M1 membership slice:** adding a second person to an organization is a
`memberships` row against an existing `auth.users` id. It is not an invitation system, not a
profile, and not a resource link. What it needs beyond that — an email invite for someone
with no account yet — is a separate question, and if the slice cannot answer it without
inventing one of the three things above, it should ship the narrower thing.

### D20 — Admin is the only surface until the configuration engine exists

`vision.md` names four surfaces on `apps/web`: marketing, booking, admin, and customer
portal. Only admin is built, only admin appears in `roadmap.md`, and that asymmetry is a
decision rather than an oversight.

The four are not four equal piles of screens. Admin is the surface that *operates* the
business, and it is the only one whose shape is decided by the domain alone. The other three
are outward-facing, and each is shaped by configuration or by an authorization model that
does not exist yet. Built now, each would harden a guess into a surface customers can see.

**Booking is blocked on invariants, not on effort.** A booking surface answers *what can I
book, when, and for how much*, which is I5 (one availability calculation), I6 (availability
shown to a client is advisory and re-asserted server-side before work is committed) and I4
(one price calculation). None of the three is enforced; I5 and I6 are M2, I4 is M3. A booking
page written before them necessarily carries its own notion of availability and its own idea
of price — which is precisely the second implementation I4 and I5 exist to forbid, sitting on
the surface where being wrong is most expensive. I6 is worse than that: it describes a public
booking flow *specifically*, and building the flow before the invariant is enforceable means
shipping the double-booking it exists to prevent.

**The customer portal is not more screens; it is a second identity model.** Every permission
today runs `membership → role → capability`, and `app.current_tenant_ids()` answers "which
tenants is the caller in". A customer is not a member and must never become one: a membership
row would put them inside that function's result and hand them the tenant. So a portal needs
a way for someone outside the organization to see exactly the rows that concern them — their
work, their documents, their history — which is a new authorization axis rather than more
policies on the existing one. It also lands directly on I19: a customer downloading their own
contract needs a signed URL minted after a permission check that has no `has_capability` to
call. That model deserves its own decision record and its own slice, made once, not
discovered while building a page.

**Marketing is blocked on configuration and proves nothing.** Every word on a public page a
business shows the world is a claim that business makes about itself, and this file already
forbids hardcoding one. A per-tenant marketing surface is therefore an M3 artefact by
definition — it is configuration with a renderer. It is also the cheapest surface to build
and the least informative: it exercises no domain rule, enforces no invariant, and would be
the only part of `apps/web` with nothing behind it.

**Rejected: building a thin booking or portal page early "to have something to show".** It is
the most tempting version of this and the most expensive. A booking flow built for one
business hardcodes that business's flow — service, slot, deposit — which is the per-client
app studio `vision.md` refuses in its second sentence. Showing something is not the same as
proving something, and the admin surface already shows the whole kernel working.

**Consequence:** `apps/web` is an admin application until M3 at the earliest. Booking is not
started before I5 and I6 are enforced; the portal is not started before its authorization
model is written down as its own decision; marketing is not started before terminology and
copy are configuration. `CLAUDE.md`'s layout table lists all four because it describes what
the directory is *for*, not what is in it.

**Trigger to revisit:** a paying tenant needs to take a booking before M3 lands. That is a
real possibility rather than a hypothetical, and the answer is not to relax this — it is to
build the availability calculation the booking needs, which is M2 work brought forward, and
to say so.

### D21 — Partial adoption is a supported shape, not a fork

A tenant may enable one module, keep their own system of record for everything else, and still
be a full tenant of this platform. A business whose website already owns its customer list,
buying customer-service chat and the admin surface behind it, is the shape this decision exists
for — and it is not the per-client app studio `vision.md` refuses in its second sentence.

The distinction is *what differs between tenants*. An app studio ships different code per
client. A partial adopter runs identical code with fewer modules enabled, which is M3's module
enablement and needs no new mechanism at all. Nothing forks, no migration is client-specific,
and every invariant in `domain-model.md` holds for them exactly as written.

**What is genuinely new is the direction data flows.** The *Sources of truth* section above was
written assuming GOLD holds the whole business, and one of its rules — never make an external
calendar canonical, sync flows internal → external — generalises by accident into *nothing
outside may be authoritative for anything*. For a tenant whose website goes on creating
customers after onboarding, that is false.

**Source of truth is therefore per entity and per tenant, and it is declared.** GOLD is
authoritative for every row it creates and for every entity whose module the tenant has enabled.
For an entity the tenant owns elsewhere, GOLD holds a projection with a named origin, and that
projection is never edited in GOLD. Exactly one system may write any given entity — the rule
that keeps this from becoming the drift D19 rejects a `profiles` mirror for, applied across a
process boundary instead of across two tables.

The calendar rule survives unchanged. A work item's window is something GOLD *computes*, and I5
and I7 make it the only answer; importing a customer record is not that.

**Rejected: forking the codebase for a partial adopter.** It is the reflex when a client says
"we only want this part," and it buys nothing they asked for — they want fewer modules, not
different ones. The cost is that I1, I2, I18 and I19 stop being facts about one database and
become N sets of facts, `schema-conformance.test.ts` runs against N schemas, and every security
fix is applied N times by someone who must first remember that N is not one.

**Rejected: bidirectional sync.** Two writers and no rule about which wins means the first
conflict is settled by whoever wrote last, and nobody can say afterwards which value was
correct. This is D19's argument about a mirror; the second writer being across an API rather
than across a trigger makes it worse rather than better.

**Rejected: importing once at onboarding and declaring GOLD authoritative thereafter.** Clean,
cheap, and a lie about a live business — their website takes an enquiry the morning after the
import, and the two lists diverge immediately with nothing that notices.

**Consequence:** nothing is built now. Partial adoption today means enabling fewer modules,
which is M3, and no schema changes hands until a tenant actually holds an entity elsewhere — no
column, no origin field, no sync table, under the same rule as everything else here. What this
record buys is that the first such tenant is a configuration question rather than an
architecture one, and that selling one module is priced as a tenant rather than as a discount.

**The invariant this will need, when it has a caller:** exactly one system may write any given
entity. It is deliberately not in `domain-model.md` yet, because nothing imports anything and an
invariant with an empty `Enforced by` cell is the intention that table exists to expose.

**Trigger to revisit:** the first tenant that genuinely needs the same entity written in both
places. The answer is not bidirectional sync — it is to find the field-level seam where each
side owns different columns, and if there is none, to decide which system loses.

### D22 — The external actor is one authorization axis, decided once

Everyone outside the organization reaches tenant data through a single authorization model: the
customer in a portal, the anonymous visitor talking to a chat widget on a tenant's own website
(D21), and the member of the public taking a booking slot. One model, written down before the
first of them is built — not three, discovered while building three pages.

This is the record D20 promised. It says the portal "is not more screens; it is a second
identity model" and defers it to "its own decision record and its own slice, made once." Two
further surfaces have since asked the same question, which is the evidence that it is one axis
rather than a portal concern.

**Why the existing axis cannot stretch.** Every permission today runs membership → role →
capability, and `app.current_tenant_ids()` answers *which tenants is this caller in* (D17, I3).
An outsider is in none of them: for a customer that is deliberate, and for an anonymous visitor
there is no `auth.uid()` at all, so the function returns the empty set and every policy correctly
refuses. The anonymous surface therefore cannot be reached by adding policies to the existing
axis — there is nothing for those policies to key on.

**What the model must answer.** Stated rather than settled, because settling them now is writing
ahead of the evidence:

- **What is an external actor bound to** — a customer row, a token naming one booking, or nothing?
- **Does it reach Postgres as a JWT?** D17 says every other caller does, and the whole value of
  that is that RLS stays the boundary. An external actor that does not is a second boundary.
- **What is its scope?** Always exactly one tenant, never a set — so it cannot reuse
  `app.current_tenant_ids()` however similar the shape looks.
- **How is I19 satisfied with no capability to check?** A customer downloading their own contract
  needs a signed URL minted after a permission check, and `app.has_capability` has nothing to say
  about someone holding no role.
- **What is attributable?** I11 is `actor_id not null references auth.users` and is enforced
  today. An anonymous writer either gets a real `auth.users` row or I11 needs a second shape, and
  those are very different decisions.

Supabase's anonymous sign-in is the option that costs those last two the least, because it
produces a genuine `auth.uid()` and leaves D17 and I11 standing. That is a candidate, not the
decision.

**Rejected: a membership row with a `customer` role.** By far the cheapest — every policy, every
function and every screen already works. It is also the leak. A membership puts an outsider
inside `app.current_tenant_ids()`, at which point every table's policies return rows to them and
the safety of the whole system collapses onto one role's capability list being complete. The
default runs the wrong way: a member sees things unless something refuses, and an outsider must
see nothing unless something permits.

**Rejected: a service-role endpoint that checks permissions in TypeScript and queries on the
customer's behalf.** D14 rejected this shape for the application and the argument is unchanged
here — the connection doing the work has already bypassed the boundary, and the query still looks
correctly written in review.

**Rejected: answering it once per surface, as each is built.** Named because it is what happens
if this record does not exist. Three surfaces produce three notions of who an outsider is, and
the first cross-surface question — can the customer who booked anonymously see that booking in
the portal — then has three answers.

**Consequence:** booking, the customer portal, and any embedded surface are blocked on this
record rather than on effort, which is what D20 already said about two of them. It is one
decision, so blocking three surfaces on it is cheaper than it sounds. Meanwhile nothing adds an
external-facing write path before it exists, and nothing adds a membership row for someone who is
not staff.

**Trigger to revisit:** the first of the three surfaces to be scheduled — and booking is closer
than D20 implies, because I5 and I6 are now enforced. Its remaining blockers are I4 and this
record. Whichever surface goes first pays for the model; the other two inherit it, and this
record is amended in that slice rather than completed speculatively now.

### D23 — The interface has a decided visual language, harvested from `tire-app-template`

M3 rebuilt every screen M1 and M2 produced, because those screens were a `max-w-2xl` stack of
sections with whatever `sm:` breakpoint was typed first. That is once. M4 builds an operator's
daily surface, a booking flow and a customer portal for a business that will use all three
every day, and building them without a decided visual language is the same mistake at four
times the size.

`tire-app-template/docs/ui-spec.md` is the source, harvested the way D1 says to harvest — the
reasoning, cited, never the code, and not all of the reasoning.

**Adopted.**

- **Mobile-first means designed around the action performed on a phone**, not the desktop
  layout shrunk. For an operator that action is *what do I do next*; for a customer it is
  *book this with the least friction*. Those are different enough that one navigation model
  serving both makes both worse.
- **The information architecture does not change across breakpoints; only its rendering
  does.** One set of areas — `apps/web/src/lib/navigation.ts` already holds them, and already
  asserts that every area has a page and every page an area — with three presentations:
  bottom tab bar on a phone, a rail on a tablet, a persistent sidebar on a desktop. The
  sidebar is the desktop rendering of the IA, never its source.
- **Operational navigation is separate from configuration navigation.** `navigation.ts`
  already orders itself this way and says the order "is a claim about what an operator does
  all day, not an alphabetisation". This record is what makes that a decision rather than an
  accident the next contributor is free to tidy away. An operator must never reach today's
  work by going through settings.
- **One primary action per screen**, secondary and tertiary beneath it, destructive
  confirmed when consequential. Not every interaction is a dialog: cards for lists, sheets
  for small forms and quick actions, full screens for complex forms, dialogs for confirmation.
- **One component file, extended — never a parallel set per surface.** M3 already owes shared
  form components "at the point a third screen needs the same control"; four surfaces make
  that point arrive fast, and the failure mode is an admin `Button` and a booking `Button`
  that drift.

**Rejected, and this is the sharp one: the status system.** `ui-spec.md` fixes a nine-value
vocabulary — `REQUESTED · CONFIRMED · EN ROUTE · COMPLETED · NO SHOW` — in a `STATUS_LABELS`
constant and names it the single source. GOLD cannot have that constant. D6 makes statuses
per-tenant rows; `work_item_statuses` holds a `name` the platform never translates and a
`position`, with deliberately no `is_terminal` and no colour. A badge here therefore cannot
be coloured by what a status *means*, because the platform does not know what it means:
"Klaar" and "Awaiting parts" are the same shape of row.

**Consequence:** a status is styled from data the tenant owns, and until a tenant owns
something beyond a name and an ordinal it is styled from neither — one neutral treatment,
legible, the tenant's word rendered as written. A colour is a column a tenant fills, added in
the change where a screen reads it, never a lookup keyed to English. This is the general
shape of harvesting from a single-tenant source: everything it was free to hardcode is
exactly what this platform is not.

**Also rejected:** a design-tokens document, a component-naming convention, and a per-tenant
theme. The first two are what D8's never-write list exists for. The third is a real feature
and is not this one — a tenant choosing its own colours is configuration with a renderer,
which lands with the marketing surface under D20 and needs the same evidence.

**Its shape is known, though, and recording it costs nothing.** `mamouandco`'s
`brand_settings` is that table already written: brand name, tagline, logo, favicon, five
colour roles, a heading and a body font, contact and social links as JSONB, edited from an
admin screen and live across the site immediately. One thing about it does **not** come
across, and it is the whole difference between that product and this one — the table is
declared `id INTEGER PRIMARY KEY ... CONSTRAINT single_row CHECK (id = 1)`, because
`mamouandco` is single-tenant and gets a second store by cloning the repository. Here that
column is `organization_id`, leading every index, under RLS (I2). D1 refuses the clone for
`tire-app-template`; this is the same refusal, and the column list survives it intact.

**Trigger to revisit:** `docs/ui-spec.md` is admissible as a Tier 1 document under D8 once the
second and third surfaces exist. Three surfaces with genuinely different navigation models are
more than one decision record should carry; one surface is not.
### D24 — Web and API both deploy to Vercel, and that forbids a daemon

Both deployables target Vercel. `apps/web` is Next.js; `apps/api` is Python behind serverless
functions, invoked by a request or by a schedule.

**What this decides.** There is no persistent process, so the automation runtime (D2's first
responsibility) is **a scheduled invocation that asks what is due**, never a worker daemon
holding a queue in memory. That is the same shape `Mechanic_Maintenance` uses when it indexes
on `(active, nextDueHours)` and asks the question rather than waiting to be told the answer.
Anything wanting to survive between invocations puts that state in Postgres, which is where it
belonged regardless — a queue that lives in a process is a queue that loses work when the
process restarts.

**What this does not survive.** Live voice does not fit the model: a call is a persistent media
stream for its whole duration. Both prior systems that solved it — `agent-system` and
`infieldos` — host their Python on Render for exactly this reason. D2's realtime
responsibility therefore lands on a second host, and that is a decision for the milestone that
needs it.

**Rejected:** hosting `apps/api` on Render from the start "because voice will need it
eventually". Three of Python's four responsibilities are request- or schedule-shaped and run on
Vercel today. A second host bought in advance for the fourth is infrastructure with no caller,
and it would also split the deployment story for every milestone before the one that needs it.

**Trigger to revisit:** the reception and sales vertical, where a media stream *is* the product.
That milestone adds a host; it does not move `apps/api`.

---

## Decided, not yet built

Named so they are not reinvented, and deliberately unbuilt until they have a consumer.

- **Approval workflows** on work items — changes the commitment flow; no caller yet.
- **Recurring work generation** — the trigger model it was waiting on now exists.
  `Mechanic_Maintenance` ships it: an append-only `HourReading` log, an interval and a
  `nextDueHours` on each task, and an index on `(active, nextDueHours)` that is the whole
  "what is due" query. It is worth naming because it is a **third trigger shape**, and M5 is
  designed around the other two. A schedule fires at a time; weather fires on an external
  event; this fires when *an accumulated counter a human or a sensor advances crosses a
  threshold*. A when/if/then runtime built for events does not express that naturally, and
  discovering it after the runtime exists is more expensive than reading it here.
- **Group and proximity discounting** — a discount must never exceed what the business
  provably saved; requires travel cost modelling that does not exist.
- **Terminology overrides** per tenant — a display-layer concern that needs a second vertical
  before its shape is knowable.
- **A platform staff console** — one surface spanning every tenant, for the people who run
  GOLD rather than a business on it: which tenants exist, what they are using, what is
  failing. `my-builder`'s `app/dashboard/*` is the reference shape. It is deferred because it
  is an **authorization decision before it is a screen**: `app.current_tenant_ids()`
  deliberately answers "which tenants is this caller in", and staff are in none of them. D14
  rejects a service-role client outright, so this needs its own Postgres role with its own
  policies — the same shape D14's trigger-to-revisit anticipates for a writer with no human
  caller. Building the screens first would mean discovering that model while laying out a
  table. Note also that **"admin" already means the tenant operator surface here** (D20); this
  one needs a different word before it needs a route.
- **Business templates** — a named, cloneable bundle of modules, statuses, fields, and roles,
  so onboarding a field-service business starts from `Field Service` rather than from zero.
  `docs/starting_conversation.txt` calls this the thing that turns four apps into a product,
  and it is — second. A template is an extract of configuration that has already proven
  itself; cloned before two businesses have been configured by hand, it clones a guess. M3's
  test stays the harder one: configure a second business shape with no pull request.
