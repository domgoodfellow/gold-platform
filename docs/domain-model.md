# Domain model

The authoritative description of the entities, the module that owns each rule, and the
invariants that must hold. If the code and this document disagree, one of them is a bug —
decide which, then fix it. Do not resolve the contradiction by softening the wording here
until it stops saying anything.

Everything described here lives under `apps/web/src/lib/domain/`. Routes, components, server
actions, and AI tools are thin callers.

## Invariants

The claims the system must always satisfy. **The `Enforced by` column is the point of this
table.** An invariant with nothing in that column is an intention, not a guarantee — and the
set of empty cells is the build backlog.

Use `/verify <n>` to audit one. "The code appears to do the right thing" is not enforcement.

| # | Invariant | Enforced by |
|---|---|---|
| I1 | Every tenant-owned row carries `tenant_id`, and RLS keyed to it is enabled on its table. | `20260825000001_tenancy.sql` — RLS enabled *and* forced; `tenancy.test.ts` "hides the other tenant even when its id is known"; `schema-conformance.test.ts` asserts it from `pg_class` for **every** table in `public`, so a table added later cannot ship without it. |
| I2 | Every unique index and every exclusion constraint on a tenant-owned table leads with `tenant_id`. | `memberships_org_user_unique (organization_id, user_id)`; `tenancy.test.ts` "lets one user hold memberships in two organizations"; `field-definitions.test.ts` "lets two tenants define the same field key on the same entity"; `schema-conformance.test.ts` asserts from `pg_index` and `pg_constraint` that every non-primary unique index and every exclusion constraint on a table carrying `organization_id` leads with it. |
| I3 | Tenant identity resolves through exactly one function; nothing assumes how many tenants a database holds. | `app.current_tenant_ids()` — returns a *set*, is the only tenant lookup, and every RLS policy calls it; `tenancy.test.ts` "shows each user only their own organizations". |
| I4 | There is exactly one price calculation. | *not yet enforced* |
| I5 | There is exactly one availability calculation. | *not yet enforced* |
| I6 | Availability shown to a client is advisory; it is re-asserted server-side before work is committed. | *not yet enforced* |
| I7 | Two work items can never occupy the same resource and window. | *not yet enforced* — must be a database exclusion constraint, not an application check |
| I8 | Editing today's configuration never changes yesterday's committed work. | *not yet enforced* — snapshot columns frozen at insert |
| I9 | Every scheduled item is an absolute instant, rendered in the tenant's timezone. | *not yet enforced* |
| I10 | Money is integer minor units, and currency is per-tenant configuration. | *not yet enforced* |
| I11 | Consequential writes are attributable to an actor. | `events.actor_id not null references auth.users`; policy `events_insert` pins `actor_id = auth.uid()`; `tenancy.test.ts` "refuses to attribute an event to someone else" and "keeps events append-only". |
| I12 | Hiding UI is not authorization; every sensitive operation is checked server-side. | `requireActor()` server-side on every protected route *in addition to* the proxy redirect, which is convenience only; capability checks live in the RLS policies themselves via `app.has_capability`, so a direct RPC call is refused exactly as a form is; `roles.test.ts` "enforces the capability in the database, not just the domain". |
| I13 | A work item's status transition is valid according to that tenant's configured transitions. | *not yet enforced* |
| I14 | An AI agent reaches business state only through domain tools that validate and check permissions. | *not yet enforced* |
| I15 | No domain module imports a vendor SDK directly. | *not yet enforced* |
| I16 | Every capability the platform declares is enforced by a database policy, not by application code alone. | `customers_insert`, `roles_insert`, `field_definitions_insert` and `memberships_update` each call `app.has_capability`; `schema-conformance.test.ts` reads `pg_policy` and fails if any entry in `CAPABILITIES` appears in no policy. |
| I17 | Only a field declared in that tenant's registry may appear in an entity's `custom`, and it holds the kind the registry says. | `app.check_custom_fields`, a trigger on `customers`, `locations`, `resources` and `work_items` — one function taking the entity type as an argument — refusing undeclared keys, absent required fields and mistyped values — scoped by `organization_id`, so another tenant's definition authorises nothing; `parseCustom` re-checks in the domain for the message rather than the guarantee; `field-definitions.test.ts` "refuses an undeclared key in the database, not just the domain" and "does not let one tenant's definition authorize another tenant's row"; `locations.test.ts` "scopes a field definition to its entity type" and `resources.test.ts` "will not accept a field defined for a different entity". |
| I18 | A row referencing two tenant-owned entities can only reference entities in its own tenant. | Composite foreign keys carrying `organization_id` — `memberships_role_same_org`, the two on `customer_locations`, and the four on `work_items` (status, customer, location, resource) — so a cross-tenant row cannot be written down at all; `schema-conformance.test.ts` asserts from `pg_constraint` that every reference between two tables carrying `organization_id` includes it, with a negative control; `locations.test.ts` "cannot link across tenants, even by writing the row directly" and `work-items.test.ts` "cannot borrow another tenant's customer/location/resource/status", each verified by swapping the composite key for a plain one, at which point the insert succeeds and RLS raises no objection. |

Invariants are added when a rule becomes load-bearing, not in anticipation. Each new one
arrives with the slice that enforces it.

## Core entities

The kernel. Every module consumes these rather than defining its own.

**Organization** — the tenant. Owns settings, operating hours, currency, timezone, enabled
modules, terminology, and business rules. A Private deployment is a database with one row
here.

**User / Membership** — identity is global; membership binds a user to an organization with
a role and capabilities. Roles are per-tenant data.

**Customer** — individual or company, with contacts, locations, communication history,
documents, and financial history. The CRM timeline hangs off this.

**Location** — an address with access instructions, associated customers, assets, and work.
Distinct from Customer because one customer can have many sites and one site can serve many
customers.

**Asset** — anything the business owns, services, rents, sells, or tracks. Machines,
vehicles, equipment, properties, customer-owned equipment.

**Work Item** — the universal operational object, with a per-tenant `type` and configurable
statuses. A job, service call, inspection, delivery, installation, booking, or appointment
is a Work Item with different configuration, not a different table.

**Resource** — a person, vehicle, or piece of equipment that a Work Item consumes for a
window of time. Scheduling and dispatch both operate on Resources; this is what keeps them
one engine rather than two.

**Document** — a file attached to any entity, with metadata in Postgres and bytes in object
storage under a tenant-scoped path.

**Event** — append-only. Every consequential state change writes one. This single table
serves the customer timeline, automation triggers, reporting, and AI context. It is the
highest-leverage thing in the kernel and cannot be backfilled — it ships in the first slice
that writes state.

**Field Definition** — the per-tenant, per-entity registry governing what may appear in each
entity's `custom` JSONB column. See `constraints.md` D7.

## Module ownership

| Module | Owns |
|---|---|
| *(none yet)* | Tenancy is kernel, not a module. The first module appears when a second *business* needs the same capability — not when a second caller needs a rule, which is grounds for extracting a function and nothing more. |

Filled in as modules are extracted. A module appears here when a second **business** needs
it — never in anticipation, and never on the strength of one business's requirements.

## Not yet modules

Named by the vision, deliberately absent. Create each **when a second business needs it** —
a second paying company, not a second call site. A second caller inside one business is
grounds for extracting a function into the domain layer, which is a cheaper and different
thing (`constraints.md`, Scope and abstraction).

`scheduling` · `dispatch` · `pricing` · `inventory` · `maintenance` · `bookings` ·
`communications` · `finance` · `automations` · `reporting`

Their eventual existence is not permission to stub them now. An empty directory with a
`README` describing future intent is a speculative abstraction with extra steps.

## The scheduling engine is one engine

`constraints.md` does not repeat this, so it is recorded here.

Scheduling, Dispatch, Booking, and Maintenance are frequently described as four engines.
They are one engine with four policies. All four reduce to the same statement:

> A unit of work needs a time, a resource, and a place, subject to constraints.

Built as separate modules, they become four calendars, four availability models, and four
conflict-resolution bugs. Build one scheduling core over Work Item and Resource; Booking,
Dispatch, and Maintenance are rule sets and screens above it.

The same collapse applies to automations and workflows: one trigger-condition-action runtime,
two authoring interfaces.
