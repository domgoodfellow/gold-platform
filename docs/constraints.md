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

- **Never build an engine before two independent pieces of evidence want it, at least one of
  them from a system that shipped.** An *engine* is code that owns entities and rules; it is
  not a **module**, which is a capability a tenant switches on and is billed for and is
  governed by nothing in this section. D25 pins the two words apart, and the reason it had to
  is that this bullet was once read as the bar for the second one. A prior product counts — `tire-app-template`,
  `saas-agent-platform` and `nextfund-portal` are evidence, and D12 already reasons from one
  of them. A discovery call that produced signed intent counts. A hypothesis does not, and
  neither does a second call site in this repository, which is grounds for extracting a
  function and nothing more. The point was never the invoice; it is that a single source
  cannot tell you which parts of itself were general, so an engine extracted from one is that
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
  two copies drifting apart, while naming an engine claims a generality that one source
  cannot possibly evidence.
- **Never create a workspace package with one consumer.** It buys a build step and a
  `dist/` for no isolation. `saas-agent-platform` collapsed `ui`, `shared`, `config`, and
  `assistant-core` for exactly this reason. Code used only by `apps/web` lives in
  `apps/web`.
- **Never add a column, table, enum value, or abstraction without a caller in the same
  change.** A field nothing reads is a speculative abstraction that will be maintained,
  migrated, and eventually misinterpreted as meaningful.
- **What counts as a caller, because this is where the rule above is misread.** A caller is
  whatever uses the thing *in the same change* — a screen, a route, a domain function, an
  operator who needs it on Monday. It is not "a second existing call site"; that is the bar
  for *extracting a rule*, three bullets up, and naming an engine at the top of this section
  is harder still. A business that has gone live wanting to see a customer's history is a
  caller. A business that might one day want a dashboard is not.
- **This section's own failure mode, stated so that it stays checkable.** It has removed
  module enablement, dashboard configuration, business rules and terminology overrides — four
  things, from M3 alone. Three of them return in M4 and M6 with shapes that the removal is
  what gave them, which is this section working as designed. It is **over-tuned the first
  time something is removed and does not come back**, and the honest response then is to
  weaken these rules rather than defer the same feature a third time. Removals are recorded
  in `CHANGELOG.md` on the commit that made them (D9), which is what makes that a count
  rather than a feeling.
- **One of those four was removed wrongly, and the tell was a word rather than a judgement.**
  Module enablement was cut by applying the engine bar at the top of this section to a
  question that is not about code at all — see D25 and `roadmap.md` M3. That is a second
  failure mode and it is cheaper to catch than the first: **before applying any rule here,
  name the noun it governs and check that it is the noun in front of you.** This section
  refuses speculative *code*. It has never had anything to say about what a tenant turns on.
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
- **Never scatter provider logic through the domain layer.** If a domain file imports a
  vendor SDK, the adapter is missing.

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
refuses. Until then Pneu3L ran on `tire-app-template`.

**Resolved at M4, and the answer is fresh.** Pneu3L is GOLD's first tenant organization — one
row in `organizations` reached the same way any other business reaches it — and its rows did
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
the first of these is needed at M6.

- **Automation execution** — the scheduled evaluation that asks *what is due, what changed,
  what crossed a threshold*. First needed, and the reason `apps/api/` arrives at M6 rather
  than alongside voice.
- **Webhook ingress** — a vendor calling in with no human session behind it. Stripe at M4 is
  the first, and it is the writer D14 and D17 both name as their trigger to revisit. **This is
  what brings `apps/api/` forward to M4** rather than M6; see D26, which also records why the
  handler writes no table of its own.
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

### D11 — Weather is an integration and a trigger, not an engine

`docs/starting_conversation.txt` lists Weather among the modules and gives it a worked
business configuration (§21). **That listing is right and this decision does not contradict
it** — it was originally written as "not a module", before D25 separated the two senses of the
word, and it was always an argument about code. Weather is a perfectly good *module*: a
weather-dependent business turns it on, sees it, and is billed for it. What it is not is an
engine.

An engine owns entities and rules. Weather owns neither. It is a provider behind an adapter
answering *what are conditions at this place and time*, plus automation rules a tenant writes
against that answer — *when the forecast at a work item's location crosses this threshold,
flag the item and notify the dispatcher*. Both halves must exist for other reasons already.

**Rejected:** a `weather` engine with its own tables. It needs a Work Item, a Location, and a
Resource before it can say anything, which makes it a rule set over the kernel — which is
exactly what a module is allowed to be.

**Consequence:** weather-driven rescheduling is the sharpest available test of the automation
runtime and of I6 — availability shown to a client is advisory and re-asserted server-side
before work is committed — precisely because the external world changes between the two. Use
it as a test case, not as a directory.

**Built in M6, and the record held exactly.** There is no `weather` table, no weather entity and
no directory named after it. What shipped is `external_readings` — a place, a number, a unit and
the hour it is about — a `conditions` adapter in `apps/api` naming a capability rather than a
provider, and four columns on `automation_rules` where a business writes which metric, which way,
what number and in which unit. Every one of those four is the tenant's; the platform names the
metrics and nothing else.

**One thing the record did not anticipate: units do not convert, they refuse.** A rule written in
kilometres per hour takes no notice of a reading in miles per hour — it does not fire at all.
That is the same refusal `jobEconomics` makes about currency and for the same reason: converting
has a date, and a date makes this a different kind of software. `automations.test.ts` asserts it
by feeding the same number in the wrong unit first.

**And the module needed something the module list did not have.** Weather is configured on the
Automations screen, because a weather rule *is* an automation rule — which is a link a second
switch can break, the dead end D31 forbids. The honest answer was not to move the link but to say
the true thing: `Module.requires` declares the dependency, and the settings screen tells a
business the requirement is missing rather than handing them a link that goes nowhere.

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

**Trigger to revisit:** the first genuine second workspace package — M10's `packages/ui`. At
that point `pnpm -r` rebuilds what did not change, and Turbo's caching starts earning its
configuration.

### D14 — Next.js App Router, `@supabase/ssr`, one caller-JWT client per request

Exactly one place constructs a client for a web request — `apps/web/lib/db/server.ts` —
using `createServerClient` with the anon key. `proxy.ts` (Next 16's rename of
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

**Trigger to revisit:** the first writer with no human caller — M4's Stripe webhook, then M6's
Python plane handling an inbound webhook. That caller gets its own Postgres role and its own
policies. It does not get service-role.

### D15 — Raw SQL migrations, and generated database types checked in

Migrations are hand-written SQL under `infra/supabase/migrations/`, applied by the Supabase
CLI, commented for *why*. The TypeScript view of that schema is **generated, not written**:
`pnpm db:types` writes `apps/web/lib/db/database.types.ts` from the live local schema, the
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
copy are configuration.

**Amended by booking (M4): the last clause was unenforceable as written, because booking *is*
a public page.** This record defers marketing on the grounds that "every word on a public page
a business shows the world is a claim that business makes about itself" — and then permits
booking, which is a page a business puts on the side of a van. The booking surface duly shipped
saying "Book a time" and "This business is not taking bookings online at the moment", which is
the platform speaking in a tenant's voice, and is the Never this file states in *Business
logic*.

The two are one problem and the second arrived first. What M4 built is **not** the marketing
surface — no pages, no sections, no blocks, no editor and deliberately no colour (D23 rejects a
per-tenant theme by name and that stands). It is one row of copy per tenant, rendered at the top
of any public surface: display name, tagline, intro, contact, address. The line it draws is the
one this file already carves out — **a business's own voice for anything it claims, the
platform's words only where they describe application state.** "Nothing free on this day" is
state; "we come to you across Montréal" is a row.

A business that has configured nothing renders **its own name and stops**, which is the same
reading of silence operating hours and the buffer take. `public-profile.test.ts` reads the
public routes' own source and fails on a hardcoded sentence, so the rule survives a careless
author rather than only a careful one.

**Still deferred:** the marketing surface proper — a per-tenant site with pages and editable
blocks. Its trigger is unchanged, and this slice is evidence toward it rather than a substitute
for it. `CLAUDE.md`'s layout table lists all four because it describes what
the directory is *for*, not what is in it.

**Amended again at M5: "marketing" was one word for two surfaces, and only one of them was
ever blocked.** Everything above defers marketing on the grounds that *every word on a public
page a business shows the world is a claim that business makes about itself*. That argument is
about a **tenant's** site and it is correct about one. It says nothing whatever about **GOLD's
own public site** — the product's front door, its pricing, its contact page — because there the
business making the claim is GOLD, there is no tenant whose voice could be borrowed, and no
amount of configuration would make it per-tenant.

The confusion was not hypothetical: `apps/web/app/page.tsx` has rendered GOLD's own words
since M1 and nobody called it marketing, so the only reading of this record available to the
next contributor was that the page they were looking at was forbidden. The two now have
different homes — `(marketing)` is GOLD speaking for itself and `(public)` is a tenant's own
customers — and `public-profile.test.ts` scans the second and deliberately not the first.

**Unchanged:** the per-tenant marketing surface stays deferred, with the trigger above intact.
Splitting the word does not unblock it; it stops the block applying to something it never
governed.

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
client. A partial adopter runs identical code with fewer modules enabled, which needs no new
mechanism beyond module enablement itself. **That mechanism was M3's and M3 removed it** for
reasons D25 shows were about the wrong noun; it lands in M4, and until it does, this decision
is a promise with nothing behind it. Nothing forks, no migration is client-specific,
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

**Consequence:** no *sync* machinery is built now — no column, no origin field, no sync table,
under the same rule as everything else here — and none is until a tenant actually holds an
entity elsewhere. Module enablement is the one piece that is built, in M4, because partial
adoption is not a shape at all without it.

**On price, said plainly, because the sentence that used to sit here was too compressed to be
useful.** When a business wants only one part of the platform, the reflex is to treat them as a
small deal and discount them into a lesser class of customer. Do not. They are a full tenant:
same code, same invariants, same isolation, same support — they have simply switched fewer
modules on. Charge the real price of what they enabled. The thing being refused is pricing the
part they actually bought as though it were a sample of something bigger they declined.

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

### Amended by booking (M4). The four answers.

Booking went first and paid for the model. What follows is settled; the portal and any embedded
surface inherit it rather than deciding again.

- **What it is bound to: a row in `external_actors`, binding one `auth.users` id to exactly one
  organization.** Not a customer row — at the moment somebody opens a booking page there is no
  customer yet, and there must not be one until they commit to something. The binding is
  *immutable*: it has select and insert grants and nothing else. The first draft carried a
  `customer_id` that `create_booking` wrote, and that was the leak — an outsider who can write a
  customer id onto their own binding can write somebody else's, and the composite foreign key
  does not object because another customer of the same tenant satisfies it perfectly. What
  identifies an outsider's own rows instead is `created_by`, which nothing can move.
- **It reaches Postgres as a JWT: Supabase anonymous sign-in**, which this record already named
  as the option costing I11 and D17 the least. It produces a genuine `auth.uid()`, so
  `events.actor_id not null references auth.users` needed no second shape, and RLS is still the
  boundary rather than a second one in application code. `config.toml` enables it, and its
  anonymous rate limit is the abuse control for a page anyone on the internet can load.
- **Scope is exactly one tenant, through `app.current_external_tenant()`** — a *different
  function* from `app.current_tenant_ids()`, returning at most one uuid rather than a set, and
  sharing neither its name nor its signature so that one cannot be reached for in place of the
  other. What makes "never a set" structural is a unique index on `external_actors (user_id)`
  **alone**. That deliberately does not lead with `organization_id`: I2 exists so one tenant's
  uniqueness cannot block another's, and this is the opposite constraint — one actor may never
  span two tenants — so leading with the tenant would permit exactly the row it forbids.
  `schema-conformance.test.ts` names it as its one exception, with that reasoning.
- **I19 is satisfied by the read being the permission check**, exactly as `getDocumentUrl`
  already works. `app.has_capability` is never consulted on this axis, because there is no role
  to ask about.

**What changed against the plan, and it is the useful part of the record.** The intent was that
every write be an RLS *permit* policy, so that RLS was the boundary in both directions. Four
were written — customers, work items, events, priced lines — and they worked. They broke on a
returning customer: `customers_org_email_unique` refuses a second row for one address, and a
read policy narrow enough to be safe cannot see the customer already there to attach to. Widening
the read to fix that would have handed a stranger the customer list.

So the write side became **one `SECURITY DEFINER` function with the scope check as its first
act** — the shape D14 already sanctions and `create_organization` already uses, privileged for
the same reason: there is no tenant to be a member of yet, and here no customer to be one yet.
The surface got *smaller* rather than larger: an external actor holds insert permission on
exactly one table — their own binding — and on nothing else, and there is one shape of write they
can perform about the business. Reads stayed entirely on RLS, which is where a leak would
actually live.

**That sentence read "no insert permission on any table at all" for the whole life of this axis,
and it was never true.** `beginBooking` has always written the binding directly under the
visitor's own session, because there is nothing to scope against until the binding exists — the
same chicken-and-egg this record names two paragraphs above, arriving in a place nobody went back
to re-read. The claim was a description of the intent, and because it was believed, two real
holes sat behind it until `20260902000002`:

- **The binding named any organization.** `external_actors_insert` checked `user_id = auth.uid()`
  and nothing else, so any authenticated caller could bind to any tenant. What was actually
  holding the line is *the shape of the one caller that had been written* — `beginBooking` passes
  what `booking_organization` resolved — and a policy has to hold against a client that never
  goes near it. It now calls `app.publishes_bookings`, extracted from `booking_organization` so
  the slug and the binding cannot answer differently.
- **`customer_id` was insertable.** `20260829000007` added the column and recorded that it is "in
  no column grant" — but `20260829000003` had already granted `insert` on the *whole table*, and
  a column added later inherits a table-wide grant. There was no column grant to be left out of.
  This is the exact attack this record's third bullet says was designed away: an outsider naming
  somebody else's customer id *was* that customer for reading, because
  `app.current_external_customer()` is all `invoices_select_external` and
  `payments_select_external` narrow on.

**The general lesson, which is worth more than either fix: a table-wide grant is not a column
grant, and a column added later joins it.** Both migrations were internally coherent and each
assumed the other had it covered. Any `grant insert on <table>` in this schema is a standing
promise about every column it will ever have — and a sweep for the same pattern found
`work_items.scheduled_during`, which was a capability bypass rather than a documentation error.
See `20260902000003`.

**A third thing was wrong and is worth keeping.** The surface shipped at
`/book/{organizationId}`, which published a tenant id — and made a *path segment* decide which
tenant an anonymous visitor was bound to. D17 says a segment is "routing convenience, never an
authorization input", and `/organizations/[organizationId]` is safe precisely because RLS
re-derives membership whatever the URL claims; out here there is no membership to re-derive
against, so the segment was the whole of it. A business now chooses a `slug`, resolved by
`public.booking_organization`, which answers **only for a business that has published something
bookable** — so the public directory is opt-in and a tenant that has not opted in is not
addressable from outside at all.

**Consequence for the other two surfaces.** The portal will need to bind an outsider to a
customer the *business* created, which `created_by` cannot express — that is a real gap and it
gets its column when it has a caller, not before. It will also need a public address of its own,
and `organizations.slug` is where that already is. Nothing else about this model is expected to
move.

### The portal inherited it, and that prediction held.

The second surface added **one column** — `external_actors.customer_id`, exactly the gap named
above — and changed nothing else about the axis. It is written by `claim_portal_invite` on
presentation of a token and by nothing else: no column grant, no update policy, so the attack
that removed the column from the first draft is still impossible.

**The two surfaces scope differently, and the difference is the reason a column was needed.**
Booking scopes an outsider to rows *they made*, because a booking visitor creates their own
customer row and `created_by` identifies it exactly. A customer of ten years made nothing — the
business did — so the portal scopes them to rows *about them*. Every external policy now reads
**"rows I made, or rows about me"**, and `app.current_external_customer()` is the companion to
`app.current_external_tenant()`: same shape, same guarantee, neither returns a set.

**I19's second shape landed here**, as D20 predicted it would: "a customer downloading their own
contract needs a signed URL minted after a permission check that has no `has_capability` to
call." The permission check is the read of the `documents` row under the external policy, and
the object is signed afterwards — the same path a member takes.

**What a link means is stated rather than implied.** Anyone holding it is that customer. That is
the security model of a link to a shared document, it is the business's to revoke, and it is the
honest cost of not having a channel to prove control of an address — which is M6's. The token is
stored rather than hashed, deliberately: a business that has lost the link it sent must be able
to send the same one again, and hashing would only mean issuing a second while protecting
nothing.

**A second index is now exempt from I2, under one rule rather than two exceptions.** An
identifier the outside world *presents* must be resolvable without already knowing which tenant
it belongs to; an identifier the inside world *uses* is scoped by the tenant that owns it.
`external_actors (user_id)` and `customer_portal_invites (token)` are both the former, and
`schema-conformance.test.ts` names each so a third has to argue for itself.

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
  does.** One set of areas — `apps/web/lib/navigation.ts` already holds them, and already
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

**Built in M6, and the shape this record predicted is the shape it took.** `/tasks/automation-tick`
is a scheduled invocation holding nothing between runs: what is due is a *query*
(`app.due_scheduled_automations` and `app.due_reading_automations`), and the only queue is a
table. Running twice is running once, and nothing bookkeeps that — a rule that moves a job to the
status it is in does nothing, a message already queued hits its unique index, and a rule with a
run against a job is no longer due. Each of those was true for its own reason before the
scheduler existed, which is why it needed no state of its own.

---

### D26 — `apps/api` arrives at M4, and webhook ingress is what brings it

`roadmap.md` said `apps/api/` arrives at M6 for automation execution. D2 said Python owns
webhook ingress and named Stripe at M4 as the first one. Both could not hold, and M4 could not
start C3 without settling it. **D2 wins and the roadmap moves: `apps/api/` stands up at M4.**

**What decided it was the layout, not the endpoint.** `docs/starting_conversation.txt` §2 lays
out `apps/web` and `apps/api` as the two deployables, and D3 already adopts that — "`apps/`
means a deployable this repository ships". A Next route handler under `apps/web/app/api/`
would have put a second thing called *api* in the tree, in the app that is explicitly not the
API, and every future webhook would have had to argue its way out of the same place. The
directory that already means "the second runtime" is the one a second runtime's work goes in.

**An earlier draft of this record argued the opposite** — that ingress is a runtime-neutral
concern and the handler belongs beside the tables it writes — and it was overruled. The
argument was not wrong about the authorization half, which is why that half survives below
unchanged; it was wrong to treat one endpoint's convenience as more decisive than where the
repository has said its Python lives.

**The two Stripe touchpoints split along D2's own line.** Creating a checkout session is an
operator pressing a button inside a transactional flow, and D2's first sentence gives the
transactional domain — invoicing included — to TypeScript, so it stays in
`apps/web/lib/adapters/payments/`. Being *called* by Stripe with no session behind it is
webhook ingress, and it is `apps/api/app/integrations/stripe/`. **The cost is that the vendor is
named in two runtimes**, and it is stated here rather than discovered later. What is *not*
duplicated is the part that would matter: there is exactly one HMAC implementation in this
repository, because only one side verifies.

**Python writes no table, which keeps D2's contract intact.** That decision says the Python
plane "writes to its own tables and *proposes* actions". The handler verifies a signature and
calls `record_provider_payment`, one `SECURITY DEFINER` function that derives the organization,
the invoice and the currency from a `payment_requests` row this platform wrote first. The
caller names a provider, a reference and an amount, and nothing that decides where the money
lands.

**The writer with no human caller** is D14's and D17's named trigger, and it is answered the
same way in either language. It gets **its own Postgres role** — `payment_webhook`, holding no
grant on any table and exactly one `execute`, which `adapters.test.ts` asserts from
`information_schema` — and emphatically not service-role, which D14 rejects outright. Identity
still arrives as a JWT (D17); it simply is not a person's.

**How I11 survives a machine.** `events.actor_id` is `not null references auth.users`, and a
webhook has no human behind it. Rather than give the invariant a second shape — a nullable
actor, or a sentinel outside `auth.users` — the integration gets **a real `auth.users` row it
can never sign in as**, and the timeline reads honestly. Only `id` is required on that table, so
the row costs one insert in a migration. A second shape for I11 would have been a much larger
decision than it looked, taken to avoid one row.

**Rejected: a Next route handler under `apps/web/app/api/`.** Cheaper today, and it puts
`api` inside `web` — see above.

**Rejected: `apps/api/api/`, and the same reasoning caught it one level down.** Vercel
discovers Python functions in a top-level `api/`, so following the vendor's default would have
produced a directory called `api` at the root of the app that *is* the API. The source tree
nests routes under `app/`; the routes are at `apps/api/app/api/` and a three-line `vercel.json`
configures the default away. A vendor's convention is worth following until it makes the tree
lie about itself.

**Not a candidate at all: `apps/web/hooks/`.** Recorded because the word invites it. A
*webhook* is an inbound HTTP request from a vendor; React *hooks* are `useSomething()`
functions that run inside a component. Next serves routes from `app/` only, so a file under
`hooks/` has no URL — it is not a worse endpoint, it is not an endpoint.

**Rejected: moving the checkout call to Python as well**, so that Stripe is named once. It
would make an operator's button depend on a second deployment and a contract between them, and
D2 explicitly rejects a full FastAPI domain layer. The duplication that remains is a provider's
*name* in two places, not a rule in two places.

**Rejected: service-role for the webhook, "because there is no user".** It is the reflex, it is
one line, and it turns the one writer with no session into the one writer with no limits.

**What `apps/api` is not, at M4.** Automation execution is still M6 and nothing here
anticipates it: no scheduler, no `domains/`, no `workers/`. **That sentence stopped being true in
M6 and is kept rather than deleted, because it is a record of when it changed**: `app/api/`
gained `automation_tick.py`, `app/channels/` and `app/conditions/` hold two more capability
contracts, and `vercel.json` gained a `crons` entry. There is still no `domains/` and no
`workers/` — the second of those is what D24 forbids outright. `pnpm-workspace.yaml` still does not
name it (D3) — pnpm must not manage a Python package. **Its tests do not run in
`pnpm --filter @gold/web check`**, which is a real gap: that gate is the web app's, and until
there is a repository-level one, `python -m pytest apps/api/tests` is run alongside it. Named
in `apps/api/README.md` so nobody finds it by shipping through it.

### D25 — A module is what a tenant enables; an engine is what owns rules

Two different objects were called *module* throughout these documents, and the collision cost a
shipped requirement. `docs/starting_conversation.txt` uses the word in its §3 and §20 sense — an
installable capability a business turns on, which appears in their navigation and on their
invoice. This file's *Scope and abstraction* section used it in the opposite sense — a body of
code that owns entities and rules, which must not be created before two independent pieces of
evidence want it. M3 applied the second bar to the first question, concluded there were no
modules to enable, and removed tenant-facing module enablement on the strength of an argument
about directory structure. See `roadmap.md` M3, which records it rather than quietly fixing it.

From here the two words are pinned:

- **Module** — a capability a tenant enables, is billed for, and sees in their navigation.
  Per-tenant configuration; a row, not a directory. *CRM, Bookings, Scheduling, Dispatch,
  Inventory, Maintenance, Reporting, Weather, Communications* are modules, exactly as the
  source lists them, and the tenant is the one who decides which are on.
- **Engine** — code that owns entities and rules. `roadmap.md` already uses the word this way
  in M2 and M3, and `domain-model.md` uses it for the scheduling core. The
  two-pieces-of-evidence rule governs engines and nothing else, and the ownership table in
  `domain-model.md` lists engines.

**They are deliberately not one-to-one, and that is the reason to separate them rather than a
side effect.** One engine serves several modules: Scheduling, Dispatch, Bookings and
Maintenance are four modules over the one scheduling engine `domain-model.md` insists on. Some
modules have no engine at all — CRM is a projection of `events` plus arithmetic, and Weather is
an adapter plus rules a tenant writes (D11). **A module with no engine is normal. An engine
with no module is code nobody asked for.**

**Rejected: keeping one word and relying on context.** It survived four documents and then
deleted a requirement in the milestone whose entire purpose was configuration. A word that
expensive gets two words.

**Rejected: renaming the tenant-facing one instead** — *capability*, *feature*, *package*.
*Capability* is taken and load-bearing: `app.has_capability` is a permission check inside one
tenant, and overloading it onto what a tenant bought would put a billing question inside an
authorization function. The source's word is *module* and the sales conversation's word is
*module*; the sense that should move is the one only this repository ever used.

**Consequence:** the two-pieces-of-evidence bar is unchanged and still binding — it just says
*engine* now, which is what it always meant. Module enablement is unblocked and lands in M4,
because it has callers today: `navigation.ts` shows every area to every tenant, D21 prices
partial adoption against a mechanism that does not exist, and `vision.md` bills
`platform fee + modules + usage` against the same.

**Amended: there is a third object, and leaving it unnamed made the shipped feature inert.**
This record separated *module* from *engine* and stopped there, which left open what a module
is separate **from** on the tenant-facing side. M4 answered it wrongly: the first `MODULES`
list held `work`, `scheduling`, `customers` and `billing` marked `required: true`, every area
belonged to one of them, and the navigation filter could therefore never remove anything. The
switch shipped, passed its tests, and changed nothing a business could see.

- **Kernel** — what every tenant has because there is no product without it: work, the
  schedule, customers, locations, resources, fields, roles, settings. Not sold separately, not
  switchable, and **not in `MODULES`**. `Area.module` is optional and its absence means this.

A **required module is a contradiction**, because a module is by definition the part a business
chooses; the phrase is only ever the kernel misfiled. The test for which one a thing is: if no
business could run here without it, it is kernel, and offering the switch is offering to break
something. If a real business would decline it — a clinic that services no machines, a firm
that invoices in Xero — it is a module.

**Consequence:** every entry in `MODULES` can be switched off, so `setModuleEnabled` has no
refusal left to make. `navigation.test.ts` asserts that at least one area belongs to an
optional module, which is the claim that would have caught this and which none of its original
assertions made — they all checked that the two lists agreed, and two lists agree perfectly
when the filter between them is dead.

### D27 — A tenant connects their own processor; GOLD never holds their keys and never holds their money

`registry.ts` deferred per-tenant payment configuration on the grounds that it means "secrets at
rest, a rotation story and a vault". That reasoning was right about the *shape it assumed* — a
settings form where a business pastes a live secret key — and the deferral is what bought the
time to notice there is a shape with no secret in it at all.

**A tenant authorizes GOLD from their own Stripe account, and what GOLD stores is an account
id.** An `acct_…` is not a credential: it grants nothing on its own, it is useless without the
platform's own key, and the business can revoke it from their dashboard without telling us. It
is per-tenant configuration like a currency or a timezone, and it belongs in a row.

**Standard accounts and direct charges, and both halves matter.**

- **Standard** means the tenant holds a full Stripe account they onboarded themselves, and they
  are the merchant of record — disputes, refunds and compliance are theirs, with their name on
  the customer's statement. Express and Custom move progressively more of that onto the
  platform, which is buying liability to control an onboarding screen.
- **Direct charges** means the charge is created *on* the connected account and the money is
  never in GOLD's balance. A platform fee still comes off it, which is revenue with no funds
  flow attached.

**This is what keeps GOLD out of being a money transmitter, and it is a legal position rather
than an architectural preference.** Connect is not the same as a marketplace: destination
charges and separate charges-and-transfers put customer funds in the platform's balance, which
is the thing that attracts licensing in most jurisdictions. Using Connect does not commit us to
that; the charge type does, and the charge type is a line of code.

**Rejected: a settings form that takes a secret key.** It is the obvious reading of "per-tenant
configuration" and it is the expensive one — it obliges GOLD to encrypt, rotate, audit and
eventually leak somebody else's live processor credentials. *Secrets and OAuth tokens stay
server-side, encrypted at rest* is a rule this repository already holds; the better move is to
have nothing that rule applies to.

**Rejected: keeping the platform's own key in the environment forever.** It is correct today,
in test mode, with one business. The moment Pneu3L takes a real card, that variable is a
customer's live secret key sitting in GOLD's deployment — it works, and it is a dead end at two
tenants and a liability at one.

**Rejected: GOLD collecting and paying out.** It is the version that sounds like a platform and
it is the version that needs a licence.

**What this costs when it lands**, which is small because the correlation-token design already
absorbed most of it: an authorization route and its callback, a column holding `acct_…`, and one
header on the outbound call. **The webhook does not change** — it routes on `payment_requests`,
whose row already carries the organization, so a connected-account event lands correctly without
the handler reading `event.account` at all. The signature stays the platform endpoint's.

**Consequence:** nothing is built now, and no column changes hands until there is a caller —
the same rule as everything else here. `STRIPE_SECRET_KEY` stays in the environment for test
mode. What this record buys is that nobody builds the vault.

**Trigger:** the first real charge, not the second tenant. `registry.ts` says "when a second
business asks to take cards", and that is the wrong trigger — it would leave one business's live
key in an environment variable in the meantime.

**Caveat worth carrying:** Stripe's onboarding wording and the mechanics of the Standard
authorization flow move. The account types and charge types have been stable for years and are
what this decision turns on; confirm the current flow against Stripe's documentation rather than
against this paragraph.

### D28 — Platform staff are a Postgres role, not a membership and not a service key

There is a fourth kind of caller and this repository had no shape for it. Three exist: a
**member**, scoped by `app.current_tenant_ids()` reading `memberships`; an **external actor**,
scoped by `app.current_external_tenant()` and bound to exactly one tenant (D22); and a
**machine writer**, the `payment_webhook` role, which holds no table grant at all and exactly
one `execute` (D26). Every one of them is scoped *narrowly by construction*. The people who run
GOLD need the opposite — read across every tenant — and are members of none.

**The staff axis is its own Postgres role with its own policies.** `platform_staff`, declared
the way `payment_webhook` already is, granted to `authenticator`, with read policies that key
on the role rather than on membership. This is the shape the *Decided, not yet built* entry
predicted when it said the console "is an authorization decision before it is a screen".

**It reads. It does not write tenant data.** The invariant lands with the slice, per the rule
that an invariant with an empty `Enforced by` cell is an intention: a platform-staff path may
read what it needs and may write nothing that belongs to a tenant. Support that edits a
customer's row is a different decision with a different audit story, and nobody has asked for
it.

**Rejected: a service-role client.** It is what most platforms do and D14 already refuses it
for the general case; the argument is unchanged and gets worse here. A service-role key
bypasses RLS entirely, so one mistake in one staff route exposes every tenant at once, and the
blast radius of the console is the whole database rather than the rows it was meant to show.

**Rejected: giving staff a membership in every tenant.** Cheapest by far — it needs no new
mechanism, because `current_tenant_ids()` would simply return everything. It also writes our
employees into each customer's own list of who works at their business, makes "who has access
here" untrue on a screen the customer reads, and puts platform staff inside the same function
that answers a tenant's authorization questions. A support engineer leaving the company would
then be a write to every tenant.

**Rejected: a separate reporting service with its own connection.** It is a real option and it
is bigger than the problem: a second deployable, a second set of credentials and a second copy
of what a tenant is, to render a list of tenants.

**Naming, which D20 asked someone to settle:** *admin* already means the tenant operator
surface, so this one is **platform** — `/platform`, `(platform)`, `platform_staff`. The word is
already how this repository talks about the non-tenant side ("platform noun", "the platform's
own words").

**Consequence:** the console cannot be built by writing screens first, and M5 exists so it is
not. **Trigger to revisit:** the first thing platform staff must *write* — a support action, a
tenant suspended, a module enabled on somebody's behalf. That is a new decision and this record
does not grant it.

**That trigger has fired once, and what it granted is narrower than the trigger anticipated.**
D29's operator door is a staff write, and it landed as one `execute` on
`provision_organization` — no table privilege, on the `create_booking` shape (D22). The
alternative considered and rejected was a write grant on `organizations` and `memberships`,
which is the obvious reading of "let staff provision" and would equally have let staff rename a
live business and add themselves to any of it. **The line the grant draws is the one I21 now
states**: staff may bring a tenant into existence and may not reach into one that exists, which
holds because nothing on this axis takes an organization id. The three writes this record
actually named — a support action, a suspension, a module enabled on somebody's behalf — are all
still ungranted, and each remains its own decision. A second `execute` is cheap to add and that
is exactly why the count is worth watching.

### D29 — One creation path, two doors, and a door opens where somebody can do the configuring

`/sign-up` is in `PUBLIC_PATHS`, so any stranger can register and found an organization. That
was never decided; it is what the first identity slice happened to leave open, and one line in
`proxy.ts` has been the entire product's onboarding policy ever since.

**This record was first written as "a tenant is provisioned, not self-served", and that
phrasing was wrong in a way worth leaving visible rather than quietly editing out.** It named
the wrong axis. Provisioned and self-served are not two kinds of tenant and never were — they
are two doors onto one `createOrganization`, and a business that came through either is the
same row under the same policies. What separates them is **who does the configuring**, which is
a fact about the far side of the door and not about the tenant at all.

**A new organization here is empty, and the emptiness is the product.** No statuses, no types,
no hours, no prices, because the platform inventing them is what this file forbids in its
never-hardcode list. That is the whole reason a door needs somebody behind it: an empty
organization handed to somebody with nothing to fill it is not a poor onboarding experience, it
is not a product.

**So the rule is about the far side, and it governs both doors identically.** A door may be
open where somebody is doing the configuring, and stays shut where nobody is.

- **The operator door.** GOLD creates the organization and configures it with the business. The
  somebody is a person, and this is what actually happens on a sales call — it is what
  `vision.md` already prices: *implementation is a real line item, not a loss leader; the
  discovery-and-configuration step is the product working as designed*. **M5 builds this door.**
- **The self-serve door.** A business signs itself up, describes itself in prose, and receives a
  proposed configuration that a human reviews and applies. The somebody is the AI onboarding
  flow, already M8's second criterion. **M8 opens this door**, and it opens by calling the same
  `createOrganization`. There is no second creation path and there must never be one.

**Self-serve is not the lesser product and is not being deferred as one.** It is the door with
the larger business behind it, and the AI flow is what makes it the *better*-configured of the
two rather than the emptier one: a proposal drafted from a description of the business and
reviewed by the person who runs it beats a form filled in by somebody guessing what a status
is. It waits on that flow and on nothing else.

**What M5 closes is the unattended door** — `/sign-up` as it stands today, where a stranger
founds an organization and nobody is on the far side of it: no implementer, no proposal, no
review. Closing it is not a position on self-serve. It is the sentence above applied to the one
door that currently has nobody behind it.

**Rejected: leaving the unattended door open because closing it is trivial.** It is trivial,
which is why leaving it open by accident is embarrassing rather than expensive — but a stranger
founding a tenant on a production deployment is a row in `organizations` we did not agree to
hold, and D4 sells a *Private* deployment tier on exactly the claim that we know whose data is
where.

**Rejected: an invitation code as the operator door.** A shared secret is one forward from being
no secret, and it would be a third onboarding path to maintain for a volume of tenants
currently small enough to name individually.

**Consequence:** M5 gives GOLD a way to create a tenant and its first membership
(`provision_organization`, 20260830000004) and revokes every grant on `create_organization`
(20260830000005). **That provisioning path is a staff *write*, which is exactly D28's trigger to
revisit**; what it granted is one `execute` and no table privilege.

**Amended by building it: "closes `/sign-up`" was the wrong target.** Provisioning names an
owner who must already have an `auth.users` row, and creating one needs the admin API that
`apps/web` may not hold (D14) — so closing registration would leave provisioning nobody to hand
a business to. **An account is not a tenant.** Registration stays open, exactly as `addMember`
has always required an address to have an account behind it; what closes is *founding*, and it
closes in the database rather than by removing a form, because a missing button is not a
boundary (I12).

**Two things that fell out of building it, both worth keeping.** The function is not dropped:
it carries 20260830000001's guard against an anonymous session founding a business, which was
found the expensive way, so the guard is asserted at the open door instead and the revoked grant
is asserted at the shut one. And **creating a business and configuring one had to come apart**:
`configureBusiness` used to do both, which cannot work once creation is staff's and
configuration is not — staff are a member of nothing, so every call after the first fails on
I21. That separation is this record's own axis arriving in the code, and it is the shape the
self-serve door will need too.

**Trigger to revisit:** M8's onboarding criterion landing, at which point the self-serve door
gets a gate rather than a new function, and what is left is a product decision about pricing and
support rather than an architectural one.

**Revisited early, and the trigger was not the one predicted.** Somebody signed up and landed on
a page saying they belonged to no business, with nothing to press and no way forward — because
the only other way in is a person at GOLD provisioning them, which is not reachable from a
screen. That is a door with nothing behind it, which is the exact failure D31 was written about
one day earlier, and it was sitting in the front of the product the whole time.

**What was wrong was the reading, not the record.** This record's own words are *one creation
path, two doors*, and it says plainly that "provisioned, not self-served" named the wrong axis.
What it deferred was the **quality** of the self-serve door — a business founded there is emptier
than one M8's onboarding will produce — and that was read as deferring its **existence**. Those
are not the same, and the difference is a person who cannot use the product at all.

**So `20260901000001` grants `create_organization` to `authenticated` and both doors are open.**
Three things did not change: `anon` is still not granted, so an anonymous visitor from the
booking flow cannot found a business and the guard inside the function refuses one anyway; both
doors still write one `organization.created` event and differ only in the payload; and
`provisionOrganization` is still the only way to name an owner who is somebody else, which is the
one thing self-serve cannot express. `provisioning.test.ts` walks through both doors again and
compares what came out, which is what it did before this was closed.

**What is still owed is what was actually deferred**: a business founded self-serve is empty, and
M8's onboarding is what fills it. That was always the real work.

### D30 — Postgres is the seam between the two runtimes

D2 gives the clock, the outside world and automation execution to Python; D24 forbids a daemon;
D26 forbids an `api/` directory inside `apps/web`; I4 and I5 say there is exactly one price
calculation and exactly one availability calculation. Those four together decide where an
automation runs, and this record states the answer before M6 writes a table against it.

**Neither runtime calls the other. The handoff is a row.**

- **`apps/web` (TypeScript)** owns configuration and every write a person makes: the rules a
  business writes, the templates it authors, the thresholds it types, and the domain layer that
  already holds `priceWorkItem` and `freeWindows`.
- **Postgres** holds the rules, the runs and the queued messages, and is the only place an
  action is *performed* — one narrow `security definer` function per action kind, in the class
  `create_booking` (D22) and `record_provider_payment` (D26) already established. The triggers
  that arbitrate a human's write arbitrate an automation's unchanged: `app.check_status_transition`
  for I13, the exclusion constraint for I7.
- **`apps/api` (Python)** asks *what is due*, drains one run at a time, and talks to the outside
  world — sending a message, reading a forecast. It gets its own role, `automation_runner`,
  holding no table grant and a handful of `execute` grants, which is `payment_webhook`'s shape
  and is asserted from `information_schema` for the same reason.

**The consequence to accept deliberately: no action may perform a calculation the domain layer
owns.** An action cannot search for a free slot, because searching *is* `freeWindows` and a
second copy of it in a second runtime is precisely what I5 exists to forbid. So a rescheduling
action shifts a job by an offset the business typed, and the exclusion constraint decides
whether that lands — which is I6 doing the job it was written for, rather than a check that
would race identically. A refusal is a recorded failure a dispatcher sees, never a silent skip.

**Rejected: a callback into `apps/web`.** Its natural home is a route handler under
`apps/web/app/api/`, which D26 forbids by name; putting it elsewhere in that tree disguises it
rather than answering the objection.

**Rejected: the whole runtime in Postgres on `pg_cron`.** It removes Python from the milestone
and puts a scheduler in the database, against D2's first sentence and D24's design, and it
leaves outbound email with nowhere to go.

**Rejected for now: actions in TypeScript, called from Python over HTTP.** This is the one with
a real gain — an action could reuse `freeWindows` and `priceWorkItem` directly, which is the
only way a rule finds a genuinely free slot. It costs an authenticated machine endpoint inside
the operator application, a contract between two deployments, and a second thing that can fail
between them.

**Trigger to revisit:** the first action that must *search* rather than assert. Offsets cover
what M6's own criterion asks for; a business asking for "move it to the next free slot" is the
argument for paying that price.

**Amended by building it: there are two ways in, not one.** This record described a scheduler
asking what is due, which is right about time and readings and wrong about events. A booking
confirmation that arrives on the next sweep is a confirmation nobody trusts, so an
event-triggered rule runs **inside the transaction that tripped it**, in a trigger on `events` —
and a rule tripped by a time or a reading runs from `run_due_automations`, called by the tick.
Both call the same `app.run_automation` and both write the same `automation_runs` row.

What makes the first safe is the thing that had to be got right: **each rule runs in its own
subtransaction**. plpgsql's `exception` block is a savepoint, so a rule a business wrote badly
rolls back its own work, records why, and leaves the customer's booking standing. A rule failing
must never roll back the write that tripped it, and without that this would have been the worst
failure this platform could have.

**Two consequences worth naming.** An automation may not trigger an automation — the trigger
returns immediately when it is already inside one, because chaining is a feature and a cycle is
an outage and the rows cannot tell them apart. And the runtime needed a way to say *this write is
a rule acting*: `app.acting_automation()` reads a transaction-local setting written only by
`app.run_automation`, and `app.check_work_item_update_capability` returns early on it. That is an
explicit third case beside the `pg_trigger_depth()` one already there, rather than an accident of
being called from a trigger — the tick calls `run_automation` at depth zero, and would otherwise
be refused for holding no capability in a business it is a member of nothing in.

**One privilege mistake worth recording, because the test is what found it.** Postgres grants
`execute` on a new function to PUBLIC, and both scheduler functions are `security definer` — so
as first written, `queued_messages` would have handed any signed-in member of any business every
other business's queued messages, addresses and words included. The privilege test caught it
because it asserts the runner's executes by *excluding* everything PUBLIC can already run, so a
function left open to everybody vanishes from the list rather than appearing in it. A test that
listed grants directly would have passed.

---

### D31 — A switch leads to its inputs

A module a business can switch on must name where it is set up, and a business that has switched
one on must be told what is still missing before it does anything.

**This is written from a shipped failure rather than from a principle.** *Card payments* could be
switched on while the section that connects an account was not rendered at all: `paymentProvider()`
answers null on a deployment holding no processor keys, and the whole *Getting paid* section sat
behind that check. The business turned the switch on and its settings page said nothing — which
is indistinguishable, from the operator's side, from having finished. It is the same class of
bug as D25's inert module list: every individual piece did what it said, and the feature did not
exist.

**What it decides.** `Module.configuredAt` is required of every module in `navigation.ts`,
naming an area and optionally a section of that area's page. The settings screen renders that
link the moment a module is on, labelled with the area's own name. `outstandingModuleSetup`
answers, for the modules a business has enabled, what it still has to do — and a module that is
*off* is never asked, because it is not part of that business and there is nobody to tell.

**Two lines this does not cross.** It is not capability gating: a role that may not price still
sees Pricing and is told why the form is not theirs (I12); this hides on a *module*, which D25
holds apart from a role. And the sentences describe **application state only** — "nothing is
priced yet" is a fact about this database in the platform's own voice, not a claim put in a
tenant's mouth, which is the line the public pages hold.

**A deployment that cannot support a module says so.** It does not hide the module, and it does
not pretend the business is at fault. A business with no processor available to it is told there
is nothing to connect and that invoices still record cash.

**Enforced by** `navigation.test.ts` — every module names an area that exists, never one owned
by a *different* module (a link a second switch could break is the same dead end by a longer
route), and a named section must appear as an `id` in that page's source. `modules.test.ts`
walks a newly provisioned business through what it is told.

**Consequence for M6:** every module that milestone adds — automations, weather, maintenance —
arrives with its configuration surface in the same slice. A switch shipped ahead of its inputs
is now a test failure rather than a judgement call.

---

### D32 — The model drafts, a person applies, and the proposal is a row between them

M8's second criterion — describe a business in prose, receive a proposed configuration, review
it, apply it — is the first thing this repository builds that calls a language model. The
questions that had to be answered before a line of it could be written are not about prompting.

**Where the call runs, and why it is not Python.** D2 gives Python four things and the third is
*Intelligence — embeddings, retrieval, batch analysis, the AI tool loop*. This is none of them.
It is one structured call whose output is a `BusinessShape`: a TypeScript type the TypeScript
domain layer must validate and apply. Putting it behind a process boundary would mean
hand-maintaining that type on both sides, which is the exact failure D2's own *Rejected* section
cites from `saas-agent-platform` as its reason not to build a Python domain layer at all. So it
lives in `apps/web`, behind an adapter, like every other vendor (I15).

**That is a carve-out and not a reversal.** M8's *first* criterion is a genuine tool loop over
domain services, and where that runs is a decision this record does not take. The distinction
that matters is that a loop calls domain functions repeatedly and a draft calls none.

**There is no tool loop, and there is no tool.** The model receives a description and returns a
shape and a list of gaps. It holds no database handle, calls no domain function, and has no
permitted write path — which is **I14 satisfied by construction rather than by a check**. A tool
the model may not misuse is a weaker guarantee than a tool that does not exist.

**A proposal is a row, not configuration.** `configuration_proposals` is tenant-owned like
everything else (I1, I2) and holds the prose it was drafted from, the shape, the gaps and an
outcome. It **holds no foreign key to what it produced, and none may be added** — the same
absence `work_item_priced_lines` keeps against the price book and `automation_runs` keeps
against its rule, for the same reason (I8): a key is how somebody eventually writes the join
that makes last month's record report this month's configuration.

**Nothing is written until a person applies, and applying needs no new capability.** Apply calls
`configureBusiness`, whose every step already runs against a policy calling `app.has_capability`.
A member who may not create a role cannot apply a proposal containing one, and the refusal comes
from `roles_insert` rather than from anything in the flow. That is I12 and I16 doing what they
were built for, and it is why this adds one capability — `configuration.propose`, which governs
drafting — rather than a second authorization axis.

**The review is editable, and that is load-bearing.** A review a person cannot change is a rubber
stamp, and D29's whole argument for the self-serve door is that a proposal reviewed by the person
who runs the business beats a form filled in by somebody guessing what a status is. An
accept-or-reject screen would make the model the configuration rather than the proposer of it.

**A failed apply is recorded, not rolled back.** `configureBusiness` is deliberately not atomic
and stays so. Its own comment says making it atomic needs *a caller who cannot tolerate the
partial state*, and this caller looked like one — a person applying a proposal did not write the
shape. It is not, and the reason is what atomicity would cost: one privileged function taking the
shape as JSON, which puts the order of those steps in the database and makes **a second
configuration path**. D29 forbids a second creation path more strongly than it forbids anything
else; this is the same mistake one level down.

So a failure writes the database's own words onto the proposal row and the partial result beside
them — `automation_runs`' shape reused (I25) rather than a new idea. The screen already reads the
business's real configuration in order to render a proposal against it, so *what already exists*
is information it holds rather than information it must be given: the person sees what landed,
edits the remainder, and applies again. **None of this is a fallback for a rare case.** A
partly-configured business is the ordinary state of one being configured by hand, and every
screen already handles it.

**Rejected: a proposal drafted before the organization exists.** It would have no tenant to be
scoped to, which puts it outside I2 for no reason, and it would make the AI flow a third door
onto creation against D29. Founding reopened in `20260901000001`, so the business exists first
and empty and the proposal is a row inside it.

**Rejected: letting the model apply its own proposal.** Every version of that is a version where
I14 is enforced by a permission check rather than by an absence, and where the answer to *what
did it change* is a log rather than a row somebody approved.

**Consequence:** one new dependency (`@anthropic-ai/sdk`) and one new adapter contract
(`lib/adapters/drafting/`), whose provider `adapters.test.ts` already names in its vendor list —
so the boundary is held from the first commit rather than from the one that remembers. Drafting
is a **module** rather than kernel, because a business that declines it configures by hand on
screens that all exist; D31 therefore applies, and a deployment holding no model key must say so
rather than render a form that cannot work.

---

### D33 — A tenant's own integrations are an axis, and the tenant holds the account

**Six integrations ship today and none of them is this.** Stripe, Twilio, Resend, Open-Meteo,
Nominatim and Anthropic are all *GOLD's* — we hold the key, the tenant never sees it, and each
arrived attached to the feature that needed it, behind an adapter naming a capability (I15).
That is why there is no "integrations milestone" and must not be one: an adapter with no caller
is the abstraction this file refuses, and D11 says it outright about weather.

**What has no home is the other kind: a business connecting its own accounts.** Sync my Google
Calendar, push invoices to Xero, import my customer list, read my mailbox. Asked for often enough
that it will arrive as three unrelated features unless the axis is named once — which is the same
mistake D22 was written to prevent on the outsider axis, and it is named here for the same reason
and at the same stage: before the first one is built.

**It is a different mechanism, not a bigger version of the first.** GOLD's integrations need a
key in an environment variable. A tenant's need an authorization grant against somebody else's
account, a token that expires and must be refreshed, a place to put the refresh token that is not
a column anybody can read, a failure surface for the day the grant is revoked, and an answer to
what happens to the data already synced when it is. None of that exists for a key in an env var.

**There is exactly one precedent and it is the shape to follow: D27's `payment_accounts`.** A
business authorizes GOLD from its own processor account and what gets stored is an `acct_` id —
**not a credential**. The money moves on their account and never touches a balance of ours. That
record's reasoning generalises: *the tenant holds the account, GOLD holds a reference to it*, and
wherever a vendor permits that shape it is the one to take.

**Three things this record decides now, so the first build does not have to.**

- **A tenant's credential is never a column the application can select.** `payment_accounts`
  gets away with storing an id because an id is not a secret. A refresh token is, and the first
  integration that needs one needs somewhere to put it that RLS alone does not protect — which
  is a decision about encryption or a vault, and it is the reason this is an axis rather than a
  feature.
- **A failed grant is a row, not a log line.** The same rule M6 settled for automations (I25):
  a token that stopped working is a thing the business must be *told*, and a sync that silently
  stopped is worse than one that never started.
- **Nothing syncs into a tenant's kernel tables without a person seeing it first.** An import
  that writes customers directly is configuration arriving from outside with nobody reviewing it
  — the same argument D32 makes about a drafted configuration, and the same answer: propose, a
  human reviews, then apply.

**Trigger to build:** a customer asking for a named one. Per `market.md`, every *Assumption* row
is answered by a sales call rather than a commit, and this is squarely one of them — the
integration a business names is worth more than the four somebody guessed.

**Consequence:** two things now want a milestone number and have none — this and tenant marketing
and branding (D20). `roadmap.md`'s *Order of work* carries both as unnumbered entries; a third
would mean the numbering has stopped describing the work.

---

### D34 — A tool is a function in Postgres, run under the caller's own token

M8's *first* criterion — asking the system questions and getting answers through the same domain
tools a human uses, under that user's permissions — is the first thing this repository builds
that gives a language model something to call. D32 settled the half with no tool in it, and said
outright that where a loop runs is a decision it does not take. This is that decision.

**Where the loop runs: `apps/api`, and `apps/web` calls it.** D2's third bullet gives Python
*intelligence — embeddings, retrieval, batch analysis, the AI tool loop*, and this is the one it
named. Two things settled it beyond the list. Retrieval, when it arrives, is Python's by every
argument D2 makes, and a loop in one runtime with embeddings in another is the AI plane split for
no gain. And a business must be able to answer with a model on its own hardware — Ollama, a
served checkpoint, anything speaking the same dialect — which is Python's ecosystem and nobody
else's.

**The cost, stated rather than skirted: D30 says neither runtime calls the other.** This makes
`apps/web` call `apps/api`, synchronously, while somebody waits. What D30 rejected was the other
direction — an action runtime calling back into the operator application to *write*, whose
natural home is a route under `apps/web/app/api/` that D26 forbids by name. This is not that, and
three things keep it from becoming it: the call carries the operator's own access token and
nothing else; the far side performs no write at all; and it holds no role, no key and no grant
with which it could do anything the caller could not do in their browser. A row would have been
the D30-shaped answer and it cannot work here — a question waits for its answer, and a handoff
through a table means a person watching a spinner until the next tick.

**A tool is a `stable`, `security invoker` function in this database.** Not a query written in
Python, and this is the load-bearing decision rather than a matter of taste. *At risk of being
late* is a definition; a definition living in the other runtime is business logic in the wrong
place, and the first total computed inside a loop is the second aggregate layer I4 and I5 exist
to prevent one level up. So Postgres holds the tool and Python holds its name, its sentence and
its JSON schema. Three consequences worth keeping:

- **The database refuses a write inside it.** An `insert`, `update` or `delete` in a non-volatile
  function fails when it runs — checked rather than assumed, and the refusal arrives at
  *execution* rather than at `create function`, in `sql` and `plpgsql` alike. So the catalogue is
  where this is caught: `ai-tools.test.ts` reads `provolatile` for every registered tool, and one
  added `volatile` by habit fails the gate. **I14 stops being a promise and becomes a property.**
- **The argument is not what narrows, and this is the failure mode a tool layer invites.** A
  model chooses a tool's arguments. If `p_organization_id` were what kept a caller inside their
  own business, the protection would be a value the model made up. RLS decides, the caller's own
  JWT is what RLS reads (D17), and handing one business's id to another business's session
  returns nothing.

  **And then the model stopped choosing it at all, which is a correction worth recording.** The
  first version of the tool schemas *required* `organization_id` — from a model that had never
  been told one. Driving the whole path found it: a model asked for an id it does not have
  invents a uuid, the tool matches nothing, and every answer comes back empty while every part
  of the system reports success. The loop now fills it in from the request, it appears in no
  schema and no prompt, and an id a model supplies anyway is **dropped rather than merged past**
  — merging alone left two differently-named keys in the record, which read as though two
  businesses had been named. The RLS argument above is unchanged and still load-bearing: it is
  what makes an id a *caller* names harmless.
- **A tool's joins are part of what it discloses**, which was found by testing rather than
  reasoned out in advance. `work_at_risk` joins `work_item_statuses` to report a job's status in
  the tenant's own words, and a portal customer — who may read their own work items and has never
  been able to read the business's internal board vocabulary — therefore gets nothing back at all
  rather than a narrowed list. Each joined table's own policies apply, so a tool built from tables
  a caller can only partly read answers *less*, never wrongly.

**This axis has no Postgres role, and that absence is the whole security model.**
`payment_webhook` and `automation_runner` each hold one because no person is present. Here a
person always is, so the token is forwarded rather than minted, and there is nothing to grant,
nothing to revoke and nothing to assert from `information_schema`. The alternative — an
`assistant` role reading across tenants and filtering by an organization id — is the mistake
above wearing an identity.

**The loop sits above a provider contract, and no vendor's tool-runner is used.** Both SDKs offer
one and taking it would be less code; it would also put iteration inside one vendor's wrapper, so
the day a business runs a local model there are two loops, two dispatch paths and an `agent_runs`
row that means different things depending on who answered. `app/ai/loop.py` owns iteration,
dispatch, the cap and the record; a provider answers *what is the next turn* and stops. The tests
drive a fixed provider through that same seam rather than around it, which is what makes the seam
a fact rather than a plan.

**Two providers ship, and the second is not speculative.** Claude is the default;
`app/integrations/openai_dialect/` serves anything speaking chat completions, which is how a
model on a business's own hardware arrives. Selection is by environment, like drafting and
geocoding — **not per tenant**, because a business supplying its own endpoint and its own key is
a business holding an account with a vendor, which is D33's axis and a different feature.

**Tenant rows now leave the database, and no other feature has done that.** Drafting sends prose
a business typed about itself; a tool result is its customers, its jobs and its schedule. Three
answers: the rows a model sees are exactly the caller's RLS scope and never more; a deployment
that must send nothing anywhere runs a local provider, which is the real reason the provider seam
exists in the first slice rather than the fourth; and asking is its own capability,
`assistant.ask`, backfilled onto `organization.manage` holders — not because a question is
dangerous, but because it spends money and it discloses, and both are decisions a business takes
on purpose.

**That capability is checked in the domain layer as well as in the policy, and it is the one place
in this platform where that is not belt-and-braces.** Everywhere else a domain-side check exists
only to produce a readable refusal while the policy does the guarding. Here `agent_runs_insert`
fires *after* the answering has happened, by which point somebody without the capability has
already spent the deployment's money and sent the business's rows outside. So the guard has to be
in front of the provider too. The policy remains the guarantee.

**A run is readable by the person who asked, and by nobody else in the business.** The one
deliberate departure from *a member sees their business's rows*, and it follows from what the row
holds: an answer contains whatever its asker could see. Reading is membership-scoped everywhere
in this schema and capability-scoped nowhere — but the portal narrows a customer to their own
jobs, and an operator's answer can hold rows that narrowing was hiding. A tenant-wide history
would be a way to read, through yesterday's answer, what today's policies refuse.
`automation_runs` is tenant-wide for the opposite reason: nobody was present, so what it did is
everybody's business.

**What the record holds is what was asked and what was said, never what was read.** Tool calls are
snapshotted as a name, its arguments and a row count. Copying rows in would put tenant data in a
table whose policies are not the ones protecting the original — an invoice's own rules and a
portal customer's narrowing both left behind.

**A tool over a module-owned area must disappear when that module is off, and that rule has no
caller yet.** CLAUDE.md already holds the half above it — *a module that hides an area must hide
what that area does elsewhere*, written from the booking module shipping as half a switch. A tool
is exactly the *elsewhere* that gets forgotten: switching billing off removes Pricing and the
quote from every job screen, and a tool answering questions about invoices would keep answering
them. Neither tool built here touches a module-owned area — work, customers and `events` are all
kernel, which no business chose and none can decline — so there is nothing to enforce and nothing
is enforced. **The first tool over an invoice, an asset or a booking is when this gets built**,
and it belongs in the registry beside the tool rather than on the Ask screen, because the screen
is one module and the tool's subject is another.

**Customer tracking is kernel and a CRM module would sit above it, which is why the second tool
needs no module.** `customers` is kernel by decision — a business cannot decline having
customers — and `customers_not_contacted` reads `events`, which is kernel too, and answers
something an operator can corroborate on the customer's own screen. What would become a CRM
module in D25's sense is the layer M9 brings: a lifecycle a tenant names, a next action, a
customer reduced to a number. When that arrives, this tool plausibly moves under it — and the
rule above is what makes that a line in a registry rather than an excavation.

**Two tools ship — the two questions M8's criterion names — and the second one moved a
definition.** *Which customers have not been contacted* needs to know which events are about a
customer, and that rule already existed inside `listCustomerTimeline`: their own events, their
jobs' events, and the one action that names them only in its payload. A second caller for an
inline rule means extracting it, so `customer_activity` is a `security_invoker` view both read.
What deliberately did not move is the timeline's action list, because *which events are about a
customer* and *which are worth showing on a screen* are two questions and only the first was
duplicated.

**No aggregate-shaped tool exists, and that is a decision rather than a gap.** Revenue by
customer, least profitable service, cost trends: each needs M7's aggregate layer, and without it
the only way to answer is arithmetic inside the loop. The `max(occurred_at)` inside
`customers_not_contacted` is not that layer arriving early, and the line is worth stating: M7 is
about reports a *tenant defines* — entity, fields, filters, grouping, period, chosen and saved by
an operator. A fixed question with one parameter is not one. When a tenant can choose the
grouping, the tool calls M7 rather than growing it. Until M7 the assistant says it cannot
answer, which is true and better than a number nobody can reproduce from a screen. **This is also
why the first criterion no longer waits for M7 in full** — `roadmap.md`'s *Order of work* said it
did, and the dependency was always on the report-shaped half. A query-shaped question needs
nothing that does not exist.

**Four things a real model found that reading the code did not, all fixed here.** They are kept
because each one is invisible until a model is actually asked something, and three of the four
passed every test this repository had.

- **A tool handed a model an instant, and a model is what renders it.** `work_at_risk` returned
  `timestamptz`, PostgREST serialised UTC, and the answer read *17:54 to 18:54* — an hour wrong
  for a business in Amsterdam and nine for one in Cebu. Every test still passed, because every
  test founds a business in UTC. I9 is unchanged and this is I9 being obeyed: the instant stays,
  and the business's own wall clock is rendered beside it **in Postgres**, because the
  alternative is date arithmetic with daylight saving in it, done by a model.
- **A model has no clock.** Asked to move a job to *9am tomorrow*, one answered with a date in
  2024. Today's date in the business's zone now travels beside the question as `context` — after
  the cached prompt prefix, not inside it, since it changes daily and the prompt does not. It is
  application state and never a word a tenant wrote, which is the line for what may reach a
  prompt at all.
- **The schema is the contract, so anything outside it is dropped.** A weaker model invented a
  `status` argument on a tool whose schema declares no properties, and PostgREST answered *could
  not find the function* — a hard failure where ignoring a word nobody offered was the right
  answer. The loop now forwards only declared properties, which is the same filter that drops an
  organization id.
- **A default model name is a trap.** `ASSISTANT_MODEL` defaulted to `llama3.1`, which Ollama
  resolves to `llama3.1:latest` — a tag a machine holding `llama3.1:8b` does not have. The
  deployment looks configured and answers 404 on every question. Both settings are required
  together now, because a missing value meaning *off* is what every other setting here means.

**Half of what a weak model got wrong was an underbuilt foundation, and that half was fixed.**
The first read of the `llama3.1:8b` run was *this model is not good enough*, and three of its four
failures were not about the model at all: it invented an argument because the schema was not
enforced, it produced a date in 2024 because nothing told it the date, and it guessed at a time
because **no tool could tell it what was already booked**. That last one is why
`public.schedule_ahead` exists — the two tools before it answer *what is wrong* and none answered
*what does the week look like*, which is the first thing anybody moving a job wants to know. It
returns rows and not availability, so it is not a second `freeWindows` (I5): a model may propose a
time that looks free and the exclusion constraint still decides (I6).

**The remaining half is the model, and the honest thing is to let it show.** With everything above
in place, `qwen3.5:9b` asked to move a job calls `work_at_risk`, takes the id out of the result,
and produces a suggestion somebody can press. `llama3.1:8b` cannot chain those two steps — it
proposes a move for a job it never looked up, putting a description where the id goes, and firmer
wording only changed *which* wrong thing it put there. That is a ceiling rather than a defect, and
the platform's job is to make it harmless rather than to hide it.

**So a suggestion is judged when it is written, not when somebody presses.** The whitelist's
validators are extracted and run twice — once as the run is recorded and once before the write —
so a suggestion that could only ever fail is stored as `failed` with the reason beside it and
never appears as a control. Showing a *Do it* button whose only outcome is a refusal asks somebody
to discover the problem by causing it. `answered_by` names the model on every row, so a business
that changed models can see why its answers changed, which is the whole reason that column exists.

**Rejected: the loop in `apps/web`.** Tools would be the domain functions themselves, no token
would cross a boundary and no second read path would exist. It leaves M9's voice work building a
second loop in Python, contradicts D2's list rather than carving out of it, and puts a metered,
minutes-long call inside the operator application's request path.

**Rejected: writes inside the loop, and this half is built.** An intended action comes back on
the run as a name and some arguments, and `apps/web` is the authority on what that name means: it
maps it through a whitelist to a domain function, validates the arguments, and calls it **when a
person presses the button**, under that person's own session. D2's contract and D32's flow, one
level down. Four things hold it up:

- **The whitelist is on the executing side, so the two runtimes may disagree and fail closed.** A
  name the loop produces that `apps/web` does not know is recorded as *this platform cannot do
  that* rather than dispatched — which is why the list of actions needs no version shared across
  the seam and no generated contract.
- **An action carries no Postgres function**, unlike a tool, and the loop treats a name from that
  list as a stopping point rather than something to call. There is nothing in the Python plane
  that could perform one. It also stops *before* running the tools in that same turn: a model
  proposing a move in the breath it asks to look has proposed it without looking.
- **Executing adds no capability and checks none.** Moving a job is `work_item.schedule`, refused
  by the policy on `work_items` exactly as it would be for a drag on the schedule. The
  exclusion constraint decides whether the new window lands (I6), and a refusal is recorded on
  the run in the database's own words rather than raised.
- **A decided action is frozen**, in the policy and not only in the flow: `agent_runs_update`
  stops matching the moment the outcome is anything but `pending`. Asking again is a new
  question, because a suggestion acted on twice is a job moved twice.

**The first action is rescheduling, and the list grows one per slice with a screen behind it.**
It is the action D30 already reasoned about: it asserts an instant rather than searching for one,
so no second `freeWindows` exists in a second runtime. It also **cannot reassign** — the model is
given no way to name a resource, because *move this to tomorrow* and *give this to somebody else*
are two decisions. That distinction was found by a test: the first executor omitted the resource,
and `scheduleWorkItem` reads an omitted resource as *nobody assigned*, so moving a job quietly
took the person off it.

---

### D35 — An aggregate is a function in Postgres, and the calculation it agrees with stays in TypeScript

M7 is reporting, and the first question it has to answer is where a total lives. Getting this
wrong produces the second aggregate layer I4 and I5 exist to prevent one level up, and D34
already said so in passing: "the first total computed inside a loop is the second aggregate
layer". This is the decision that sentence was pointing at.

**An aggregate is a `stable`, `security invoker` function in this database**, exactly the shape
D34 gives a tool — because a report *is* a tool as soon as somebody asks the assistant for it,
and a report that exists as TypeScript only would have to be written twice the day it does. It is
narrowed by RLS rather than by its arguments, its joins are part of what it discloses, and the
catalogue is where that is enforced. Everything D34 says about a tool applies here unchanged.

**That is two callers in the same change, and two callers is what licenses it at all.** The
screen and the assistant both read the same function. One caller would have made this the
speculative abstraction *Scope and abstraction* opens by refusing; the rule about extracting a
rule at the second caller is what this satisfies.

#### Why this does not put a second price calculation in the database

It does, in the narrow sense, and the honest answer is that this platform already keeps one rule
in two expressions and has a mechanism for it.

**`priceWorkItem` stays the definition and moves nowhere.** It is pure, synchronous, and takes
lines its caller already read; making it call the database would be a round trip for arithmetic
on data already in hand, and it would invert D2's split. What `invoiceStanding` already
demonstrates is that the rule was never "one query" — that function calls `priceWorkItem` on
*invoice* lines rather than quote lines, so the shape is **one calculation, fed different lines**.
An aggregate selects and groups lines. That part is database work.

**What keeps the two expressions one rule is a correspondence test, and I5 is the precedent
rather than an analogy.** The availability predicate genuinely exists twice — as
`work_items_resource_not_double_booked` and as `listSchedule`'s filters — and I5 is held up not by
deleting one but by `availability.test.ts` asserting they agree in both directions. I4 is now held
the same way: `reporting.test.ts` prices the same jobs through `priceWorkItem` and through the
aggregate and fails on any disagreement. The day a minimum charge, a tax or a rounding rule lands
in `priceWorkItem`, that test fails — which is precisely the event I4 was written to catch, and
the reason it must fail loudly rather than be updated to match.

**A total may not be stored.** No `subtotal`, `revenue` or `margin` column on any table, and no
materialized view in the first build. I4's own record names a stored subtotal as the thing that
becomes a second opinion, and a materialized one is that with a performance excuse attached.
Nothing has measured a slow query yet.

#### The words, because "revenue" is four different facts

Naming these apart is most of the design, and each is dated by a business date a person controls
rather than by when somebody typed it in — an asymmetry closed for costs and invoices in the
commit immediately before this record.

- **Invoiced** — what a business has billed. `invoices.issued_at`, snapshotted lines, a
  snapshotted `billed_to`. **Built.**
- **Incurred** — what a job consumed. `work_item_costs.incurred_at`, with the currency snapshotted
  onto each row. **Built.**
- **Margin** — invoiced minus incurred, within one currency. **Built**, and see below.
- **Received** — what has actually arrived. `payments.received_at`, which has carried a
  caller-supplied date since M4. **Not built**: it is one more column of the same shape, and it
  lands when somebody asks for a cash view rather than because the column exists.
- **Quoted** — what has been priced onto jobs, invoiced or not. **Not built, and the reason is the
  finding.** A priced line's only date is `created_at`, which is when somebody typed it — exactly
  the asymmetry the preceding commit closed everywhere else. Reporting quoted work over a period
  would reintroduce it. **The gap is a business date on a quote**, and it is its own slice with
  its own caller, not a column added here on speculation.

**This matters more than it looks, because it decides who gets a report at all.** A business that
prices here and invoices in another system has nothing invoiced, and under this record sees an
empty report rather than a wrong one. That may turn out to be most of them, and finding out is
the point: an empty report from a real business is the caller that earns *quoted* its date.

#### Three shapes that are decided rather than incidental

- **A group is keyed by an entity and a currency, and never by an entity alone.** Amounts carry
  the currency they were recorded in (I8, I10), so a business that changed what it trades in has
  two rows for one customer and no single figure. This is `totalCost`'s choice one level up.

  **It differs from `jobEconomics` deliberately.** That function returns `null` for margin across
  currencies because a job screen wants one number and there is not one. A report is a table, and
  a row per currency is the honest presentation of the same refusal. Neither converts, which is
  the rule both are obeying.

- **Every grouping key is a snapshot.** Service is `invoice_lines.description`, customer is
  `invoices.billed_to`, and neither joins back to `price_book_items` or reads a customer's name as
  it is today. That absence is the whole of what I8's enforcement consists of, and a report
  grouped by today's catalogue would make last year's figures move when somebody renames a
  service. Where an id is carried too, it is for the screen to link with, never for the grouping.

- **Margin groups three ways and revenue groups four.** A cost sits on a job; a service is a line
  on one. Attributing a job's costs across its lines needs an allocation rule, and this platform
  has no basis to invent one. So grouping by service returns revenue with an absent cost and an
  absent margin, and the screen says why — the same shape `jobEconomics` uses when it cannot
  subtract.

#### Rejected

**The aggregate in TypeScript.** I4 is trivially satisfied and the assistant gets nothing to call,
because D34 says a tool is a Postgres function. M7's stated purpose is unlocking the
report-shaped tools; an aggregate they cannot reach does not do it.

**Moving `priceWorkItem` into Postgres.** It makes I4 single again with no correspondence test
needed, and it costs a round trip for every price on every screen, turns a pure function async,
and moves the transactional domain's arithmetic out of the runtime D2 gives it.

**A report definition in this record.** What a saved report may express, and who may see one, is
the next slice's decision and depends on this one working. Deciding it here would be deciding it
without a caller. **D36 is that decision**, taken once the aggregate above was running.

---

### D36 — A saved report is a row with an audience, and the audience is a policy

M7's criterion is that an operator defines a report, pins it to a dashboard and shares it with a
role, with nothing about that report existing in code. D35 settled where the figures come from.
This settles what a saved one may say and who may see it.

**A definition holds a grouping, a period and up to three filters. There is no query language.**
`starting_conversation.txt` §17 lists *entity, fields, filters, grouping, calculations, time
period*, and for this report set four of those six are already fixed: the entity **is** the
grouping, the fields are invoiced, incurred and margin, and the calculation is the subtraction
D35 owns. What is left is a grouping, a period and an optional entity to narrow to — three
columns and a check constraint, not a builder.

That is a claim about *this* report set rather than about reporting in general, and it is the
reason to write it down: the moment a report set arrives whose fields are not fixed, this record
is where the argument for a builder has to be made rather than assumed. **A filter is a typed
column with a composite foreign key** (I18), never JSON — a filter naming a customer of another
business must be unrepresentable rather than merely unusual.

**A filter narrows jobs, not amounts.** Both halves of the aggregate take their grouping keys and
their filters from the work item, so a job's revenue and its costs are counted together or not at
all. A filter that kept one half would report a margin for work that was only partly counted,
which is the worst kind of wrong: plausible.

**A saved report produces its figures by calling the same aggregate**, with its stored grouping,
period and filters as arguments. This is D35's rule one level up and the thing most likely to be
undone by a well-meaning optimisation: a saved report that grew its own query would be a second
answer to a question that already has one, and `reporting.test.ts` asserts that a saved report and
the ad-hoc screen return identical rows for identical inputs.

#### The audience

**A report names roles, and an RLS policy is what enforces it.** A report a role may not see
returns no row, so no screen can leak it, no direct call can, and a dashboard built on top of it
renders what each viewer can read without anything in code deciding that. A filter in a page
would be a second, weaker copy of this and must not be added.

Three consequences worth keeping:

- **`app.current_role_id` is `security definer`, for the reason `app.current_tenant_ids` is.** A
  policy that read `memberships` under RLS to find the caller's role is how recursion arrives.
  It takes the organization as an argument and is therefore evaluated per row rather than hoisted
  — the same cost `app.has_capability` already carries, and acceptable for a table holding tens of
  rows rather than thousands.
- **The sharing table is readable by any member of the business, and the definition is not.** A
  policy on `report_definitions` that consulted a `report_definition_roles` only its own audience
  could read would be circular. What that discloses is which role ids a report id is shared with;
  what stays hidden is the report — its name, its grouping, its figures. The narrower thing is
  the one that matters and it is the one protected.
- **`report.manage` sees every report in the business**, deliberately. Somebody who can create and
  share reports can create the same report again in ten seconds, so hiding one from them protects
  nothing and would only make a report undeletable by the person meant to manage it.

**Two capabilities rather than one.** `report.read` is reading figures (D35, and
`20260903000003` for why an aggregate is gated where a row is not); `report.manage` is authoring
a definition that other people will see. They are plausibly two people — the second is closer to
`role.manage` than to reading a number — and `report.manage` gets a policy on a real table, so it
satisfies I16 the ordinary way.

#### Rejected

**Filters as JSON.** One column instead of three, and it accepts a customer id belonging to
another business, a key nothing reads, and a shape that drifts from what the aggregate accepts.
D7 gives JSONB to *tenant-declared* custom fields; a filter is platform vocabulary.

**A report private to whoever saved it, shared row by row.** More precise, and it makes *the
executive dashboard* something a person owns rather than something the business has — so it
leaves with them. Roles already express "the people who do this job here", which is what a report
audience actually means.

**`report.read` sees every saved report.** Simplest, and it puts one team's margins in front of
everybody holding the capability, which is exactly what "shares it with a role" was asking not to
happen.

---

## Decided, not yet built

Named so they are not reinvented, and deliberately unbuilt until they have a consumer.

- **Retrieval and embeddings over a business's own prose** — the fourth thing D2 gives Python,
  and the one part of the AI layer M8 deliberately did not build. The reason is not that nobody
  has asked: **this database holds almost no prose to retrieve.** Every free-text column in it is
  a line long — `work_items.title`, `locations.access_notes`, `work_item_time_entries.note`,
  `payments.note`, `work_item_costs.description` — and `documents` stores a storage path, a
  filename and a size, with **no extracted text at all**. Embeddings over five short columns are
  worse than `ilike` over the same five, slower to build and impossible to explain to an operator
  who asks why a row came back.

  So the trigger is a corpus, and exactly two things create one. **Document text extraction** —
  downloading what a business has attached, parsing it, and storing what it says — which is a
  slice of its own with its own failure surface, and the point at which a job's paperwork becomes
  searchable. And **M9's transcripts**, which are the first genuinely long text this platform will
  hold, arriving with the milestone that owns them.

  What is decided now, so the first build does not have to be: an `embeddings` table is
  tenant-owned and carries `organization_id` leading every index like everything else (I2); the
  retrieval tool is one more `stable`, `security invoker` function under the caller's own token,
  exactly like the two that exist (D34); and **nothing embedded may outlive what it describes** —
  a vector of a deleted document is a row that answers questions about something the business
  removed, which is the same objection I8 makes about a snapshot that reaches forwards, inverted.

  **`agent_runs.outcome = 'unanswered'` is the evidence, and it is already being collected.** A
  question the tools could not answer is recorded distinctly from a failure for exactly this
  reason. When that list is mostly questions whose answers are sitting in prose, the case is made
  in a tenant's own words rather than in a guess.

- **Approval workflows** on work items — changes the commitment flow; no caller yet.
- **Recurring work generation** — **built in M6.** The third trigger shape this entry warned
  about is `counter_threshold`: `asset_readings` is the append-only log, `automation_counter_marks`
  holds the reading a rule last acted at, and `create_work_item` is the action. Two things the
  entry did not say, both found by building it — **the first reading sets the mark and raises
  nothing**, because switching a rule on for a machine that has already run nine hundred hours
  must not raise nine services that were done years ago; and **the mark advances by whole steps
  rather than to the reading**, so a counter that jumps three intervals leaves two still owing.
  What is *not* built is recurrence on a calendar — "every first Monday" is a different question
  with no caller. The original entry, kept for its reasoning:
  the trigger model it was waiting on now exists.
  `Mechanic_Maintenance` ships it: an append-only `HourReading` log, an interval and a
  `nextDueHours` on each task, and an index on `(active, nextDueHours)` that is the whole
  "what is due" query. It is worth naming because it is a **third trigger shape**, and M6 is
  designed around the other two. A schedule fires at a time; weather fires on an external
  event; this fires when *an accumulated counter a human or a sensor advances crosses a
  threshold*. A when/if/then runtime built for events does not express that naturally, and
  discovering it after the runtime exists is more expensive than reading it here.
- **Where a message comes from, and where a reply goes.** Asked for as "all of the above", and
  it is three things at three distances that share a word.

  **Drafting from what a business already sends.** Point at a mailbox or at documents already in
  the system, and get template drafts back rather than an empty box. This is the smallest of the
  three and the only one that changes nothing structural: a template is still a row the business
  owns and edits, and what arrives is a first draft of one. It belongs with M8, because reading
  prose and proposing configuration is exactly what that milestone's second criterion already
  describes — and it is the same shape: propose, a human reviews, then apply.

  **Richer templates.** The five placeholders M6 shipped are the ones every business has. The
  obvious additions — the amount, the address, who is coming, a reference, a link to the
  customer's own portal page — are a list rather than a mechanism, and the last is worth more
  than the rest together: a message that links to the live job beats one describing it. The bar
  each must clear is that the platform can fill it in *reliably every time*, because a
  placeholder that is sometimes blank is a sentence that is sometimes nonsense.

  **Two-way email, and this is the large one.** A business's replies currently land in somebody's
  personal inbox and leave the system. Reading a mailbox so a customer's reply attaches to the
  job it is about is a different order of work: an authorization grant against somebody else's
  account, tokens that expire and must be refreshed, a mailbox that is not ours to be careless
  with, and a matching problem — which job is this reply about — that has no perfect answer.
  **It belongs to M9**, which is the milestone about a business running its front desk here, and
  it is the same shape as the dialer: record, understand, assist, automate, delegate. Doing it
  earlier would mean building the hardest third of a communications feature before the milestone
  that owns communications.

  What all three share is the rule M6 already holds: **whatever the source, the words a customer
  reads are the business's** (I24). A draft is a draft until somebody saves it.

- **A lead is a state of a customer, not a second kind of person.** When M9 brings sales in, the
  temptation is a `leads` table beside `customers`, and then a `contacts` table beside both — at
  which point one human being is three rows and every question about them is a union. The entity
  is the person or company; *lead*, *opportunity* and *customer* are stages of the relationship
  with them. So `customers` gains a lifecycle rather than a sibling, exactly as work gained one:
  a stage a tenant configures and names in its own words, because a business with a two-step
  pipeline and one with seven are the same shape.

  **This is written down before it is built, on the same reasoning as D22.** The cost of finding
  out afterwards is a migration that has to decide which of three tables a given human was, and
  by then the CRM timeline hangs off `customers.id`. **Not decided here**: whether a lead is
  visible in the customer list before it converts, and whether `work_items` may reference one —
  both are real questions with no caller yet.

- **Group and proximity discounting** — a discount must never exceed what the business
  provably saved; requires travel cost modelling that does not exist.
- **Terminology overrides** per tenant — a display-layer concern that needs a second vertical
  before its shape is knowable.
- **A platform staff console** — **promoted out of this list. See D28 and `roadmap.md` M5.**
  The entry said it was "an authorization decision before it is a screen" and that it needed
  its own Postgres role and a word other than *admin*; D28 makes all three of those decisions
  and M5 is where it is built. `my-builder`'s `app/dashboard/*` remains the reference shape.
- **Business templates** — a named, cloneable bundle of modules, statuses, fields, and roles,
  so onboarding a field-service business starts from `Field Service` rather than from zero.
  `docs/starting_conversation.txt` calls this the thing that turns four apps into a product,
  and it is — second. A template is an extract of configuration that has already proven
  itself; cloned before two businesses have been configured by hand, it clones a guess. M3's
  test stays the harder one: configure a second business shape with no pull request.
