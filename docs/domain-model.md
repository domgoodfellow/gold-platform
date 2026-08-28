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
| I2 | Every unique index and every exclusion constraint on a tenant-owned table leads with `tenant_id`. | `memberships_org_user_unique (organization_id, user_id)`; `tenancy.test.ts` "lets one user hold memberships in two organizations"; `field-definitions.test.ts` "lets two tenants define the same field key on the same entity"; `work_item_types_org_name_unique` and `work_item_statuses_org_type_name_unique`, with `work-item-types.test.ts` "lets two tenants define the same type" and "lets two types in one tenant share a status name" — the second of which is scoping rather than tenancy, and passes only because the tenant id still leads; `schema-conformance.test.ts` asserts from `pg_index` and `pg_constraint` that every non-primary unique index and every exclusion constraint on a table carrying `organization_id` leads with it. **One index is exempt and it is the opposite constraint rather than a lapse**: `external_actors_one_tenant_per_user` is on `user_id` alone, because it enforces that one *actor* can never span two tenants (D22) — leading it with `organization_id` would permit exactly the row it forbids. The conformance test names that index explicitly, so a second exemption cannot arrive by matching a loosened rule. |
| I3 | Tenant identity resolves through exactly one function; nothing assumes how many tenants a database holds. | `app.current_tenant_ids()` — returns a *set*, is the only tenant lookup, and every RLS policy calls it; `tenancy.test.ts` "shows each user only their own organizations". |
| I4 | There is exactly one price calculation. | `priceWorkItem` in `lib/domain/pricing/prices.ts` — the only place an amount is derived, called by the work item screen and by nothing that recomputes. No component reduces an array of lines, no route handler sums one, and no `subtotal` column exists to become a second opinion. What keeps it single is that a line **copies** its catalogue row rather than joining to it: `add_work_item_priced_line` writes the description, unit, amount and currency down at the moment the line is added, and `work_item_priced_lines` holds **no foreign key to `price_book_items` at all** — `prices.test.ts` "holds no reference back to the catalogue at all" asserts that from `pg_constraint`, because a copy that is merely not currently joined becomes a join the first time a key makes one look safe. "copies the catalogue onto the line rather than joining to it" raises a price and finds the existing quote unmoved and the next one at the new figure. The total is always a number in a named currency because `work_item_priced_lines_one_currency`, a gist exclusion over `(organization_id with =, work_item_id with =, currency with <>)`, refuses a second currency on one job in the database rather than in a check before the insert that would race identically (I6) — asserted through the domain *and* as a raw insert expecting `23P01`. Quantity is an integer and nothing rounds, so the arithmetic is exact; when a fractional quantity earns its way in, how a half-cent rounds is a pricing decision that belongs in that same function, which is why there must not be a second. **Verified non-vacuous:** dropping the exclusion constraint fails the currency test, and adding any foreign key to `price_book_items` fails the structural one. `jobEconomics` is the first thing to consume a price rather than render one, and it **calls** that function rather than reshaping its answer — its `revenue` field carries `Price` itself, because restating what a price is would be the second declaration that diverges the first time a pricing rule adds to it. `economics.test.ts` "takes its revenue from the one price calculation, not from its own sum" holds the two together on a case with a quantity in it. |
| I5 | There is exactly one availability calculation. | `freeWindows` in `lib/domain/scheduling/availability.ts`, and `listSchedule` above it — the only answers to what is free, called by the schedule view and by nothing that recomputes. `scheduleWorkItem` deliberately does **not** call it, so there is no second opinion to drift from the first. What keeps the single answer honest is that it and the exclusion constraint agree in both directions: `availability.test.ts` "agrees with the constraint: a window it calls free can be committed" and "…a window it does not call free cannot be". `listSchedule`'s filters are that constraint's partial predicate written as a query — `status_releases_resource = false`, and an overlap against `occupies` rather than the appointment — and the correspondence is the invariant rather than a coincidence: a clause added to one and not the other turns a free window into an unbookable one, or worse the reverse. `work-item-editing.test.ts` "frees the resource once the tenant says that status releases it" asserts both halves in one test, reading the window as free and then committing against it, and `buffer.test.ts` "subtracts the buffer from availability, and still agrees with the constraint (I5)" does the same for a tenant that has configured a gap between jobs. Operating hours are subtracted first, from `operating_hours` — and **nothing anywhere knows what a working week is**: no Monday-to-Friday, no weekend, no seeded rows, and no default. A business that has configured nothing is treated as always open, because that is what "it has said nothing" means; inventing a closing time for it would be the hardcoded business hours `constraints.md` forbids. `operating-hours.test.ts` "seeds no hours at all for a new business" is the assertion that keeps the rest honest. |
| I6 | Availability shown to a client is advisory; it is re-asserted server-side before work is committed. | The re-assertion is `work_items_resource_not_double_booked` refusing the commit in the transaction that would have written it — not a re-check before the insert, which would race identically. `availability.test.ts` "is advisory: a free answer can be taken before it is acted on" reads availability, lets a second caller take the slot, then commits against the stale answer and expects `23P01`. The schedule view labels the figure advisory rather than implying a hold. **Booking is where this stopped being an internal claim.** `booking.test.ts` "is advisory, and the constraint is the re-assertion (I6)" reads slots as a member of the public, lets a second visitor take one, and commits against the stale answer — refused by the constraint inside `create_booking`, which checks nothing first on purpose. The public page says so in words rather than implying a hold: "not held until you book". |
| I7 | Two work items can never occupy the same resource and window. | `work_items_resource_not_double_booked`, a gist exclusion constraint over `(organization_id with =, resource_id with =, scheduled_during with &&)` — `organization_id` leads it (I2) and it is **partial**, `where (resource_id is not null and scheduled_during is not null and not status_releases_resource)`, so unassigned or untimed work shares no key rather than being coalesced to a zero uuid as `tire-app-template` did. The third clause is what makes cancelling free the van: `roadmap.md` claimed cancellation needed no new code, and it was wrong, because this predicate knew nothing about status and a cancelled job went on holding its resource forever. `work_item_statuses.releases_resource` is the tenant's answer about their own word — deliberately not `is_terminal`, which would be the platform deciding what a status *means* — mirrored onto `work_items.status_releases_resource` because an exclusion predicate must be IMMUTABLE and cannot join. That mirror is maintained by two triggers, is in no column grant, and `work-item-editing.test.ts` "never lets a caller assert the mirror directly" holds it there. Precisely: with a non-null `resource_id` the leading `organization_id` is redundant for *correctness*, because a resource uuid belongs to exactly one organization and two tenants can never share an exclusion key — it is there for I2, for index selectivity, and because the redundancy stops holding the moment a null resource is coalesced, which is the failure being avoided. What actually keeps unassigned work from colliding across tenants is the partial predicate. The range it compares is **`occupies`**, not `scheduled_during`: the appointment is what the customer was told, and the occupied window is that plus this tenant's `buffer_minutes` — time the resource stays busy after work ends. `constraints.md` lists buffers in the never-hardcode set, so the platform holds no gap between jobs and invents none; zero is what a business that has said nothing means, and at zero `occupies` *is* the appointment. It is enforced rather than displayed on purpose: padding only the availability calculation would leave `freeWindows` refusing a slot the database accepts, which breaks I5 in the direction nobody notices and stops the constraint being the re-assertion I6 depends on. Both are half-open, held by `work_items_window_is_bounded_half_open`, which is what lets back-to-back work not collide. No overlap check exists in the domain layer and none may be added. `work-item-editing.test.ts` "still holds the resource when a status says nothing", "frees the resource once the tenant says that status releases it" and "refuses to un-release a status when that would double-book (I7)" — the last of which is the constraint refusing to let a board become something the schedule cannot draw. `scheduling.test.ts` "refuses an overlapping booking on the same resource", "refuses the overlap as a raw update too, with 23P01", "allows back-to-back work", "lets the other tenant book the identical window on an identically named resource", "does not let unassigned work block unassigned work", "keeps one tenant unassigned booking from blocking another tenant" and "does not let an assigned but untimed work item block anything". **Verified non-vacuous:** `infra/supabase/snippets/i7-vacuity-control.sql` swaps in the `tire-app-template` shape — no leading tenant, null resource coalesced to the zero uuid — against a database rebuilt from scratch, at which point exactly those two unassigned tests fail with `23P01` and the rest still pass. |
| I8 | Editing today's configuration never changes yesterday's committed work. | Two snapshots, each protecting an edit path that now exists. `work_item_costs.currency` is written by `record_work_item_cost` from the organization rather than joined at render, so `update_organization` changing what a business trades in cannot reinterpret last year's costs — `editing.test.ts` "does not reinterpret a recorded cost when the currency changes" records in one currency, changes it, and finds the old row unmoved. A type's checklist template is **copied** onto each work item by `create_work_item`, with no foreign key back, so editing a template cannot rewrite what somebody already agreed to do or untick what they already did — `checklist-templates.test.ts` "does not reach a job that already exists when the template gains a step" and "does not untick work when a template step is removed". A field definition's `kind` and `key` are refused to **every** caller by a column grant — `grant update (label, required, position)` is the whole of what may change — because a kind change would reinterpret every value already stored under that key and a key rename would orphan them, each surfacing later as `app.check_custom_fields` refusing an unrelated write to a row that was valid when it was made; `field-forms.test.ts` "will not change a field kind, even as a raw update", "will not rename a key, even as a raw update" and "does not touch a value already stored when the form is rearranged". **Verified non-vacuous:** granting `update (kind, key)` to `authenticated` fails all three, the third because the rename genuinely breaks the stored value rather than merely being permitted. Pricing landed in M3 and snapshots the same way: a priced line copies its catalogue row and holds no foreign key back to it (I4). **Where this invariant stops, stated because one column deliberately sits the other side of the line.** `work_item_statuses.releases_resource` is configuration and it *does* reach work already committed — marking "Cancelled" as releasing frees the van on every job already sitting in it, and `work-item-editing.test.ts` "reaches work already in that status, because it is a cache and not a snapshot" asserts exactly that. It is not a violation because I8 protects **amounts and terms somebody agreed to**: what a job was quoted, what it cost, which steps were promised, what a stored value means. Whether a cancelled job still occupies a van is none of those — it is a live operational question, and a snapshot would answer it wrongly for every job cancelled before the tenant got around to configuring the status. Snapshotting it would look like enforcing this invariant and would silently break cancellation. |
| I9 | Every scheduled item is an absolute instant, rendered in the tenant's timezone. | `tstzrange` over `timestamptz` makes the instant absolute by construction; `organizations.timezone` holds the tenant's IANA zone, checked against `pg_timezone_names` by `organizations_timezone_known` so an unknown zone cannot be stored; `formatWindow` is the only place an instant becomes a time a person reads, and it takes that zone rather than the server's or the reader's. `scheduling.test.ts` "stores an absolute instant and renders it in each tenant's zone" reads one instant as 11:00 in Amsterdam and 05:00 in New York, "refuses a timezone Postgres does not recognise", and "holds no timestamp without a zone anywhere in the schema" asserts the general form from `pg_attribute`, so a naive `timestamp` column added later fails. The one bare `time` column is `operating_hours`, and it is right there and only there: "we open at nine" is a recurring local reading rather than an instant, and storing it as an instant would drift an hour twice a year — `zonedTimeToInstant` resolves it against the tenant's zone at the moment a day is calculated, and `operating-hours.test.ts` "holds a bare `time` column only where a recurring local reading belongs" pins that from `pg_attribute` too. |
| I10 | Money is integer minor units, and currency is per-tenant configuration. | `work_item_costs.amount_minor bigint` — integer minor units, `bigint` because 2^31 minor units is about twenty-one million euro; `work_item_costs_amount_not_zero`; `organizations.currency`, required at founding with **no platform default** because there is no neutral currency, and snapshotted onto each amount rather than joined. `formatMoney` is the only place a minor unit is divided, and it takes the fraction digits from the currency rather than assuming two. `consumption.test.ts` "records a cost in integer minor units, in the tenant's own currency", "uses each tenant's own currency, not a platform default", "refuses a non-integer or zero amount" (through the domain *and* as a direct insert), "divides by the minor unit exactly once" including a JPY case, and "refuses to found an organization with no currency". **Costs now have exactly one totaller too** — `totalCost` — and it groups per currency rather than summing across them, because a snapshotted currency per row means a business that changed what it trades in has a job with costs in two. `jobEconomics` therefore returns `null` for margin rather than converting: a rate has a date, and a date makes this the accounting system `vision.md` refuses to be. `economics.test.ts` "refuses a margin across currencies, and reports both totals instead" and "refuses a margin when nothing is priced, and does not call it zero" — the second because zero claims the job broke even, which is a far stronger statement than "we cannot say". |
| I11 | Consequential writes are attributable to an actor. | `events.actor_id not null references auth.users`; policy `events_insert` pins `actor_id = auth.uid()`; `tenancy.test.ts` "refuses to attribute an event to someone else" and "keeps events append-only". **The table now has a reader**, which is what M1 shipped it early for: `listCustomerTimeline` renders one customer's history out of rows thirty-odd writers left with nothing looking, and `timeline.test.ts` "reads a history nobody wrote for it" is the assertion that none of it could have been reconstructed later. Attribution resolves to what *this tenant* calls that person, not to an account: identity is global and this repository owns no users table (D19), so somebody who has left has an actor id and no name — `timeline.test.ts` "attributes every entry to what this tenant calls that person". Reading also found the hazard of a polymorphic subject: `location.linked` names the *location* and carries the customer in its payload, so a reader filtering on `entity_id` misses it entirely — "finds an event written against the other side of the relationship" pins that, and pins that it belongs to the customer it names rather than to everyone at that address. **An anonymous booker satisfies this unchanged**, which is why D22 chose anonymous sign-in: they are a genuine `auth.users` row, so `actor_id not null references auth.users` needed no second shape for a writer with no account. `booking.test.ts` "leaves the booking attributable (I11)". |
| I12 | Hiding UI is not authorization; every sensitive operation is checked server-side. | `requireActor()` server-side on every protected route *in addition to* the proxy redirect, which is convenience only; capability checks live in the RLS policies themselves via `app.has_capability`, so a direct RPC call is refused exactly as a form is; `roles.test.ts` "enforces the capability in the database, not just the domain". |
| I13 | A work item's status transition is valid according to that tenant's configured transitions. | `app.check_status_transition`, a trigger on `work_items`, refusing any `status_id` change with no matching row in `work_item_transitions` for that organization, type and pair — so a type with no configured transitions is frozen rather than unconstrained; `work_items_update` carries `work_item.transition` and `grant update (status_id)` keeps that capability from reaching any other column, because a policy sees the old row or the new one but never both; `change_work_item_status` checks `returning` so a policy-denied update — which affects zero rows and raises nothing — cannot write a timeline entry for a move that never happened; the domain re-checks for the message rather than the guarantee. `work-item-transitions.test.ts` "freezes a type with no configured transitions", "still refuses the move that was not configured", "is directional" and "does not let one tenant's transitions authorize another tenant's move", each asserted through the domain *and* as a raw PostgREST update. |
| I14 | An AI agent reaches business state only through domain tools that validate and check permissions. | *not yet enforced* |
| I15 | No domain module imports a vendor SDK directly. | *not yet enforced* |
| I16 | Every capability the platform declares is enforced by a database policy, not by application code alone. | `customers_insert`, `roles_insert`, `field_definitions_insert` and `memberships_update` each call `app.has_capability`; `schema-conformance.test.ts` reads `pg_policy` and fails if any entry in `CAPABILITIES` appears in no policy. |
| I17 | Only a field declared in that tenant's registry may appear in an entity's `custom`, and it holds the kind the registry says. | `app.check_custom_fields`, a trigger on `customers`, `locations`, `resources`, `work_items` and `assets` — one function taking the entity type as an argument — refusing undeclared keys, absent required fields and mistyped values — scoped by `organization_id`, so another tenant's definition authorises nothing; `parseCustom` re-checks in the domain for the message rather than the guarantee; `field-definitions.test.ts` "refuses an undeclared key in the database, not just the domain" and "does not let one tenant's definition authorize another tenant's row"; `locations.test.ts` "scopes a field definition to its entity type" and `resources.test.ts` "will not accept a field defined for a different entity". |
| I18 | A row referencing two tenant-owned entities can only reference entities in its own tenant. | Composite foreign keys carrying `organization_id` — `memberships_role_same_org`, the two on `customer_locations`, the five on `work_items` (type, status, customer, location, resource, asset — the status one carrying `type_id` as a third column, see I20), `work_item_statuses_type_same_org`, the two on `assets`, and the four on `documents` — so a cross-tenant row cannot be written down at all; `schema-conformance.test.ts` asserts from `pg_constraint` that every reference between two tables carrying `organization_id` includes it, with a negative control; `locations.test.ts` "cannot link across tenants, even by writing the row directly" and `work-items.test.ts` "cannot borrow another tenant's customer/location/resource/status", each verified by swapping the composite key for a plain one, at which point the insert succeeds and RLS raises no objection. `schema-conformance.test.ts` also forbids a polymorphic `(entity_type, entity_id)` attachment outside `events`, because a reference with no foreign key satisfies the first assertion trivially. |
| I19 | A private file is never reachable without a short-lived signature minted after the same permission check the rest of the operation gets. | The `documents` bucket is private, so there is no durable URL to leak; storage policies on `storage.objects` pin an object key's first path segment to an organization the caller belongs to, enforced under the caller's own JWT rather than by any application code; `getDocumentUrl` reads the metadata row under RLS *first* — that read is the permission check — and signs for 60 seconds; the download route mints per click, so nothing durable is ever rendered into a page. `documents.test.ts` "does not serve the same object without a signature", "refuses to write bytes into another tenant's prefix" and "cannot sign a URL for another tenant's object", the middle one verified by loosening the storage policy, at which point the cross-tenant write succeeds. **D22 asked how this holds with no capability to check, and booking answered it**: on the external axis the read under RLS *is* the permission check, `app.has_capability` is never consulted because there is no role, and every policy permits a named thing rather than refusing an unnamed one. What scopes an outsider to their own rows is `created_by`, which is NOT NULL and which no policy or column grant on that axis can move. |
| I20 | A work item's status belongs to that work item's own type. | `work_items_status_same_org_and_type`, a three-column reference `(organization_id, type_id, status_id)` to `work_item_statuses (organization_id, type_id, id)` — so the mismatch cannot be written down at all. This is *not* a tenancy question and nothing in I18's machinery catches it: both rows belong to the same organization, so RLS is satisfied and every composite reference passes. `create_work_item` sidesteps it by deriving the type from the status rather than accepting both, so `work-item-types.test.ts` "cannot put a work item in another type's status" inserts the mismatch directly. |

Invariants are added when a rule becomes load-bearing, not in anticipation. Each new one
arrives with the slice that enforces it.

## Core entities

The kernel. Every module consumes these rather than defining its own.

**Organization** — the tenant. Owns settings, operating hours, currency, timezone, enabled
modules, terminology, and business rules. A Private deployment is a database with one row
here.

**User / Membership** — identity is global and lives in `auth.users`; this repository owns
no users table and no profile mirror (`constraints.md` D19). Membership binds a user to an
organization with a role, capabilities, and the name *that organization* uses for them.
Roles are per-tenant data, and so is the name: the same account can be "Sam" to one tenant
and "S. Okafor, Contractor" to another.

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

### Named in the conversation, answered here

`docs/starting_conversation.txt` lists entities every business gets. Two are absent above
and their absence is a decision rather than an omission.

**Task** is a Work Item. A task is a unit of work with a state and usually an assignee, which
is what a Work Item is; a tenant that wants one configures a type whose statuses are *To do*
and *Done*. A separate table would be a second thing needing assignment, status, timeline and
permissions — and the moment a task needed scheduling there would be two schedulers.

**Team** is not yet anything. It is a grouping of memberships, and grouping earns a table
when something filters, assigns, or reports by it. Nothing does: a role already carries what
a member may do, and dispatch does not exist. When work is assigned to a team rather than a
person, that is the change that adds it — and see `constraints.md` D19, because a Team is
about identity and this repository deliberately owns very little of that.

**Calendar** is a view, not an entity. It is Work Items organised by time and resource, which
is the scheduling core reading its own rows back. A `calendar` table would be a second place a
scheduled thing could live, and the two would disagree the first time one was written without
the other.

**Activity** is an Event. The append-only table already serves the customer timeline,
automation triggers, reporting, and AI context; a parallel activity log would be the same rows
written twice with no rule about which is authoritative.

*Notes* and *Notifications* appear in that list too and are deliberately **not** answered
here. Neither reduces cleanly to something that exists — a note is editable and `events` is
not, and a notification needs delivery and per-recipient read state that nothing models. They
get a decision when something needs them, not before.

## Module ownership

| Module | Owns |
|---|---|
| *(none yet)* | Tenancy is kernel, not a module. The first module appears when two independent pieces of evidence want the same capability — not when a second caller needs a rule, which is grounds for extracting a function and nothing more. |

Filled in as modules are extracted. A module appears here on two independent pieces of
evidence, at least one from a system that shipped — never in anticipation, and never on the
strength of one source's requirements.

## Not yet modules

Named by the vision, deliberately absent. Create each **on two independent pieces of
evidence, at least one from a system that shipped** — not on a second call site. A second
caller inside one business is grounds for extracting a function into the domain layer, which
is a cheaper and different thing (`constraints.md`, Scope and abstraction).

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
