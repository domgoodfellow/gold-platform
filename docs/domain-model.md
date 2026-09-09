# Domain model

The authoritative description of the entities, the engine that owns each rule, and the
invariants that must hold. If the code and this document disagree, one of them is a bug —
decide which, then fix it. Do not resolve the contradiction by softening the wording here
until it stops saying anything.

Everything described here lives under `apps/web/lib/domain/`. Routes, components, server
actions, and AI tools are thin callers.

## Invariants

The claims the system must always satisfy. **The `Enforced by` column is the point of this
table.** An invariant with nothing in that column is an intention, not a guarantee — and the
set of empty cells is the build backlog.

Use `/verify <n>` to audit one. "The code appears to do the right thing" is not enforcement.

| # | Invariant | Enforced by |
| --- | --- | --- |
| I1 | Every tenant-owned row carries `tenant_id`, and RLS keyed to it is enabled on its table. | `20260825000001_tenancy.sql` — RLS enabled *and* forced; `tenancy.test.ts` hides the other tenant even when its id is known; `schema-conformance.test.ts` asserts it from `pg_class` for every table in `public`, so a table added later can't ship without it. |
| I2 | Every unique index and every exclusion constraint on a tenant-owned table leads with `tenant_id`. | `memberships_org_user_unique`, `work_item_types_org_name_unique`, `work_item_statuses_org_type_name_unique`; `schema-conformance.test.ts` asserts from `pg_index`/`pg_constraint` that every non-primary unique index and exclusion constraint on a table carrying `organization_id` leads with it. Two named exemptions, not lapses: `external_actors_one_tenant_per_user` is on `user_id` alone, since it enforces that one *actor* can never span two tenants (D22) — leading with `organization_id` would permit exactly the row it forbids. `customer_portal_invites (token)` is the same shape: an identifier the outside world presents must be resolvable without already knowing its tenant. `invoices_org_number_unique (organization_id, number)` is the rule at its most visible — a global sequence would refuse two businesses their own invoice #1 and reveal how many invoices GOLD has ever issued. |
| I3 | Tenant identity resolves through exactly one function; nothing assumes how many tenants a database holds. | `app.current_tenant_ids()` — returns a *set*, is the only tenant lookup, and every RLS policy calls it; `tenancy.test.ts` shows each user only their own organizations. |
| I4 | There is exactly one price calculation. | `priceWorkItem` in `lib/domain/pricing/prices.ts` is the only place an amount is derived. A line copies its catalogue row rather than joining to it (`add_work_item_priced_line`); `work_item_priced_lines` holds no foreign key to `price_book_items` at all (`prices.test.ts`, from `pg_constraint`). `work_item_priced_lines_one_currency`, a gist exclusion, refuses a second currency on one job in the database rather than in a pre-insert check that would race identically (I6). Quantity is an integer, so nothing rounds. `jobEconomics` calls `priceWorkItem` rather than reshaping its answer (`economics.test.ts`). An invoice carries no `total_minor` column either — `invoiceStanding` calls `priceWorkItem` over the invoice's own snapshotted lines (`invoices.test.ts`). **Expressed a second time and pinned, not duplicated** (D35): `public.invoiced_and_incurred` totals lines in SQL for reports and AI tools, held honest by a correspondence test (`reporting.test.ts`) that fails on any disagreement — repaired by teaching the aggregate, never by relaxing the test, the same mechanism I5 uses for availability. |
| I5 | There is exactly one availability calculation. | `freeWindows` in `lib/domain/scheduling/availability.ts`, with `listSchedule` above it, is the only availability calculation — `scheduleWorkItem` never calls it, so there's no second opinion to drift. `listSchedule`'s filters are the exclusion constraint's own partial predicate written as a query (`status_releases_resource = false`, overlap against `occupies`); `availability.test.ts`, `work-item-editing.test.ts` and `buffer.test.ts` assert both directions agree. Operating hours are subtracted first from `operating_hours`, and nothing anywhere seeds a default working week — a business with none configured is always open (`operating-hours.test.ts`). |
| I6 | Availability shown to a client is advisory; it is re-asserted server-side before work is committed. | The re-assertion is `work_items_resource_not_double_booked` refusing the commit inside the transaction that would have written it, never a pre-insert check, which would race identically. `availability.test.ts` reads a free slot, lets a second caller take it, then commits against the stale answer and expects `23P01`. `booking.test.ts` proves the same on the public axis — nothing is checked first, on purpose — and the booking page says "not held until you book" rather than implying one. |
| I7 | Two work items can never occupy the same resource and window. | `work_items_resource_not_double_booked`, a gist exclusion over `(organization_id, resource_id, scheduled_during)` — partial, `where (resource_id is not null and scheduled_during is not null and not status_releases_resource)`, so unassigned or untimed work shares no key. The third clause is what makes cancelling free the resource: `work_item_statuses.releases_resource` is the tenant's own answer about their own word, deliberately not a platform `is_terminal`, mirrored onto `work_items.status_releases_resource` by two triggers (an exclusion predicate must be IMMUTABLE) and in no column grant. The range compared is `occupies`, not `scheduled_during` — the appointment plus the tenant's `buffer_minutes`, which defaults to zero rather than any hardcoded gap. Both are half-open (`work_items_window_is_bounded_half_open`), so back-to-back work doesn't collide. No overlap check exists in the domain layer. **Verified non-vacuous**: `supabase/snippets/i7-vacuity-control.sql` swaps in the naive shape (no leading tenant, null resource coalesced to a zero uuid) against a rebuilt database, and exactly the unassigned-work tests fail. |
| I8 | Editing today's configuration never changes yesterday's committed work. | Three snapshots protect three edit paths. `work_item_costs.currency` is written by `record_work_item_cost` from the organization, not joined at render, so a currency change can't reinterpret old costs. A checklist template is copied onto each work item at creation with no foreign key back, so editing a template can't rewrite what was already agreed or done. A field definition's `kind` and `key` are refused to every caller by column grant (`grant update (label, required, position, options)` is the whole of what may change) — `options` is inside that grant because adding a choice doesn't reinterpret stored values, but changing a kind does; removing a choice is permitted because it reaches nothing already written (`field-choices.test.ts`). **Verified non-vacuous**: granting `update (kind, key)` to `authenticated` fails all three tests. An invoice line is a fourth snapshot, one level up — it copies a priced line, which copies a catalogue row, and `invoice_lines` holds no foreign key back for the same reason (`invoices.test.ts`, from `pg_constraint`). **Where this invariant deliberately stops**: `work_item_statuses.releases_resource` is a maintained cache, not a snapshot, and does reach committed work — marking "Cancelled" as releasing frees every job already in it. Not a violation, because I8 protects amounts and terms someone agreed to; whether a cancelled job still occupies a resource is a live operational question, and snapshotting it would answer wrongly for every job cancelled before the status was configured. |
| I9 | Every scheduled item is an absolute instant, rendered in the tenant's timezone. | `tstzrange` over `timestamptz` makes the instant absolute; `organizations.timezone` holds the tenant's IANA zone, checked against `pg_timezone_names`; `formatWindow` is the only place an instant becomes a rendered time, using that zone rather than the server's or the reader's. `scheduling.test.ts` reads one instant as 11:00 in Amsterdam and 05:00 in New York, and asserts no naive `timestamp` column exists anywhere (`pg_attribute`). The one bare `time` column is `operating_hours` — a recurring local reading, not an instant — resolved against the tenant's zone at the moment a day is calculated (`zonedTimeToInstant`). |
| I10 | Money is integer minor units, and currency is per-tenant configuration. | `work_item_costs.amount_minor bigint`; `organizations.currency`, nullable with no platform default, snapshotted onto each amount rather than joined. **Nullable as of `20260904000001`, and that strengthens this rather than relaxing it** — it was `not null default 'EUR'`, silently recording every business with no chosen currency as trading in euro. Null now means *has not said*; `create_price_book_item` and `record_work_item_cost` both refuse the first amount until a currency is set, at the moment it's actually needed. `formatMoney` takes fraction digits from the currency rather than assuming two (`consumption.test.ts`, including a JPY case). `totalCost` groups per currency rather than summing across them, so `jobEconomics` returns null for margin across currencies rather than converting (`economics.test.ts`). `payments.amount_minor` is signed; only zero is refused — a wrong payment is corrected by its reverse, since the table has no update policy. `record_payment` writes the invoice's own currency and takes none as an argument; `record_provider_payment` derives organization, invoice, and currency from the `payment_requests` row, so a vendor payload can't assert any of the three. `invoiced_and_incurred` makes currency part of the group key, so a business that changed currency mid-year gets two rows for one customer rather than a converted figure (`reporting.test.ts`). |
| I11 | Consequential writes are attributable to an actor. | `events.actor_id not null references auth.users`; policy `events_insert` pins `actor_id = auth.uid()` (`tenancy.test.ts`). A machine write is attributable too — the payment integration is a real `auth.users` row with no email or password, so a webhook satisfies the same not-null constraint without a sentinel (`adapters.test.ts`, D26). `listCustomerTimeline` is the table's reader (`timeline.test.ts`): attribution resolves to what *this tenant* calls that person, not to a global account, so someone who's left has an id and no name. Reading also surfaced a polymorphic-subject hazard — `location.linked` names the location and carries the customer only in its payload, which a reader filtering on `entity_id` would miss; the timeline reads it anyway. An anonymous booker satisfies this unchanged, since anonymous sign-in still produces a genuine `auth.users` row (D22). |
| I12 | Hiding UI is not authorization; every sensitive operation is checked server-side. | `requireActor()` runs server-side on every protected route in addition to the proxy redirect, which is convenience only; capability checks live in RLS policies via `app.has_capability`, so a direct RPC call is refused exactly as a form is. The Stripe webhook reaches Postgres as `payment_webhook`, a role holding no grant on any table and exactly one `execute` (`adapters.test.ts`, from `information_schema`) — proof that D14's refusal of service-role actually holds. `create_organization` needed a second look: it gated on `auth.uid() is not null`, which an anonymous booking session also satisfies. `20260830000001` checks `auth.users.is_anonymous` directly instead of trusting the JWT claim, since converting to a permanent user flips that column without reissuing the token. |
| I13 | A work item's status transition is valid according to that tenant's configured transitions. | `app.check_status_transition`, a trigger on `work_items`, refuses any `status_id` change with no matching row in `work_item_transitions` for that organization/type/pair — a type with no configured transitions is frozen, not unconstrained. `work_items_update`'s `grant update (status_id)` keeps that capability from touching any other column, since a policy sees the old row or the new one but never both. `change_work_item_status` checks `returning`, so a policy-denied update (zero rows, no error) can't write a timeline entry for a move that never happened. `work-item-transitions.test.ts` asserts all of this through the domain and as a raw PostgREST update. |
| I14 | An AI agent reaches business state only through domain tools that validate and check permissions. | **Enforced by an absence rather than a check.** `lib/adapters/drafting/` holds no database handle and no domain writer — `proposals.test.ts` reads the directory and fails the gate on any import of `@/lib/db` or `@supabase/*`. What it produces is a row in `configuration_proposals`, written by the person who asked, under their own session and capability. Applying one is `configureBusiness` called by that person, so every write lands on the policy it would have hit if typed by hand (`proposals.test.ts` demotes a member and shows the refusal comes from `price_book_items`'s own policy). **The tool half is the same shape twice over.** A tool is a `stable`, `security invoker` Postgres function called through PostgREST under the asking person's own token (D34) — it cannot write, because Postgres refuses a write inside a non-volatile function at execution (`ai-tools.test.ts` reads `provolatile` for every registered name), and it cannot read a row its caller couldn't, because RLS reads the caller's own JWT regardless of what argument a model supplies. This axis holds **no Postgres role at all** — `apps/api` forwards the token and mints nothing. Writes stay outside the loop entirely: an answer may carry one intended action, recorded as pending and performed by nobody until a person presses a button, mapped through a whitelist in `apps/web`; a name the loop invents that the whitelist doesn't know is recorded as a refusal, not dispatched, and `agent_runs_update` freezes a decided action. See D32, D34. |
| I15 | No domain code imports a vendor SDK directly. | `lib/adapters/payments/` — the contract in `index.ts` names a capability, never a provider; `registry.ts` is the one file outside an implementation allowed to say `stripe`. `adapters.test.ts` reads every file under `lib/domain/` and fails on an import reaching past the capability *and* on a vendor's name appearing anywhere, comments stripped — the second assertion exists because the first draft broke I15 without an import (`settleProviderPayment` tested whether a reference started with `cs_`, which is domain code knowing what a Stripe id looks like). The same three-file shape now covers `lib/adapters/geocoding/` (*where is this address*) and `lib/adapters/telephony/` (*place a call*), and the test's vendor and contract lists grew with each rather than after. |
| I16 | Every capability the platform declares is enforced by a database policy, not by application code alone. | `customers_insert`, `roles_insert`, `field_definitions_insert`, `memberships_update` each call `app.has_capability`; `schema-conformance.test.ts` reads `pg_policy` **and** `pg_proc` and fails if any entry in `CAPABILITIES` appears in neither — so a function that raises on the check counts as enforcing it, even with no policy of its own (`add_member_by_email` has enforced `role.manage` this way since M1, since `auth.users` isn't readable by `authenticated`). `report.read` gates `invoiced_and_incurred` itself rather than the rows underneath it, since an aggregate has no rows to put a policy on and the invoices/costs it reads must stay visible to every member for the job screen to work — what's gated is the summing. The search matches only function bodies that actually mention `has_capability`, so a comment naming a capability can't satisfy it. |
| I17 | Only a field declared in that tenant's registry may appear in an entity's `custom`, and it holds the kind the registry says. | `app.check_custom_fields`, a trigger on `customers`, `locations`, `resources`, `work_items` and `assets`, refuses undeclared keys, absent required fields, and mistyped values, scoped by `organization_id` so another tenant's definition authorises nothing; `parseCustom` re-checks in the domain for the message. `field-choices.test.ts` bypasses `parseCustom` entirely to assert the database refuses an undeclared choice, an undeclared list, and another tenant's real option written straight to the table. |
| I18 | A row referencing two tenant-owned entities can only reference entities in its own tenant. | Composite foreign keys carrying `organization_id` on every cross-entity reference — `memberships_role_same_org`, `customer_locations`, the five on `work_items`, `work_item_statuses_type_same_org`, `assets`, `documents` — so a cross-tenant row can't be written at all; `schema-conformance.test.ts` asserts every reference between two `organization_id`-carrying tables includes it, and separately forbids a polymorphic `(entity_type, entity_id)` attachment outside `events`. Verified by swapping a composite key for a plain one, at which point the cross-tenant insert succeeds and RLS raises nothing. `report_definitions`'s three typed filter columns (D36) are the newest case — a single JSONB filter would have accepted another business's customer id and produced an empty report nobody could explain; they're `on delete set null` rather than `cascade`, so deleting a customer widens a report rather than deleting it. Reception (`customers_stage_same_org`, `calls_outcome_same_org`) and the conference (`call_participants_call_same_org`, `call_events_call_same_org`) both followed the same pattern. |
| I19 | A private file is never reachable without a short-lived signature minted after the same permission check the rest of the operation gets. | The `documents` bucket is private; storage policies on `storage.objects` pin an object key's first path segment to the caller's organization, enforced under the caller's own JWT. `getDocumentUrl` reads the metadata row under RLS first — that read *is* the permission check — and signs for 60 seconds; the download route mints per click. `documents.test.ts` verifies by loosening the storage policy, at which point a cross-tenant write succeeds. On the external axis, the read under RLS is still the check (`app.has_capability` doesn't exist there): `created_by` scopes booking, `app.current_external_customer()` scopes the portal, and neither is writable by the caller. |
| I20 | A work item's status belongs to that work item's own type. | `work_items_status_same_org_and_type`, a three-column reference `(organization_id, type_id, status_id)` to `work_item_statuses (organization_id, type_id, id)` — so the mismatch cannot be written down at all. Not a tenancy question and nothing in I18's machinery catches it: both rows belong to the same organization, so RLS is satisfied and every composite reference passes. `create_work_item` sidesteps it by deriving the type from the status rather than accepting both; `work-item-types.test.ts` inserts the mismatch directly. |
| I21 | A platform-staff path may read across every tenant, may bring a new tenant into existence, and may write nothing belonging to a tenant that already exists. | The `platform_staff` Postgres role (`20260830000002_platform_staff.sql`) holds `select` on `organizations`, `memberships`, `organization_modules`, `events` and `platform_staff`, and **no `insert`, `update` or `delete` grant on any table at all** — the half that survives a permissive policy added later, since a granted write would still hit a missing privilege. `platform-staff.test.ts` asserts a `permission denied` message specifically, since the difference between a policy declining and a privilege not existing *is* the invariant. The console reads `platform_tenants`, asserted `security_invoker` from `pg_class.reloptions`. I2 doesn't govern this role — it carries no `organization_id` and never will, since not being scoped to a tenant is the point. The one write granted is a single `execute` on `provision_organization` and no table privilege (the `create_booking` shape, D22) — chosen over a table grant because that would equally let staff rename a live business. `provisioning.test.ts` provisions a business, then fails to rename or join it, in one test, since either half alone proves nothing. |
| I22 | An automation performs only writes the platform already permits a person to make, and computes nothing the domain layer owns. | A rule's write goes through every trigger a person's would — `app.check_status_transition` refuses an illegal move (I13), `work_items_resource_not_double_booked` refuses a colliding reschedule (I7), each recorded as a failed run rather than swallowed. `automation_actions_action_kind_check` lists four action kinds, none of which prices anything or searches for a free slot — either would be a second `priceWorkItem` or `freeWindows` in a second runtime (I4, I5); `milestone-m6.test.ts` reads that constraint from `pg_constraint` rather than trusting the TypeScript list. |
| I23 | A message is sent at most once per recipient per reason. | `message_deliveries_once_per_reason`, a unique index on `(organization_id, rule_id, subject_type, subject_id, recipient)` — the insert is attempted and the violation swallowed rather than checked for first, the same reasoning I6 and I7 carry. `automations.test.ts` writes to the same person twice about two jobs, and never twice about one — asserting both directions matters, since an index that blocked the first case too would be as wrong as one that allowed a duplicate. |
| I24 | Nothing this platform sends on a business's behalf says anything that business did not write. | `app.resolve_message_template` substitutes five named values into text a tenant typed and adds nothing; an unknown placeholder is left as written. The finished words are snapshotted onto `message_deliveries` when queued, so editing a template can't reach an inbox or the record of what was sent (I8). Every layer after is a pipe — `apps/api/app/integrations/resend/email.py` and `.../twilio/sms.py` send `body` verbatim. Asserted whole, not by fragment: `automations.test.ts` and `milestone-m6.test.ts` compare entire bodies, since a footer added by any layer is exactly what `toContain` would miss. |
| I25 | Every automation run records an outcome; a failure is a row, not a log line. | `automation_runs.outcome` is `not null` and checked, with `automation_runs_detail_matches_outcome` forcing a failed run to carry the database's own words. Each rule runs inside its own plpgsql `exception` block (`app.fire_event_automations`, `public.run_due_automations`), so a failing rule rolls back its own work without touching the write that tripped it. `platform_failures` (`security_invoker`) is the reader; `platform-staff.test.ts` asserts staff see it across tenants while a member sees only their own, and neither can write it. |
| I26 | A public write on the external axis may name its own target organization to nobody — the caller supplies no organization id, and no policy grants a way to read what was written. | `request_workflow_review` takes no `p_organization_id` parameter at all (`workflow-review.test.ts` reads `pg_proc.proargnames` from the catalogue rather than trusting the source); the target comes from `platform_settings`, a table with RLS forced and no grant to any role, set only by `supabase/snippets/workflow-review-target.sql` (D22, D42). Unlike `create_booking`, no `external_actors` binding is written, so `workflow-review.test.ts` proves the caller can read back no customer, event, organization or membership even while its anonymous session is still live — the absence of a grant, not a policy that happens to decline (I21's shape, one axis over). |
| I27 | An organization cannot transition SETUP → LIVE while a blocker exists, regardless of which caller invokes the transition. | `public.organization_launch_blockers(id)` is the one definition of what blocks the move — a switched-on `booking` module with no public address or nothing published to it, or a switched-on `card_payments` module with no connected account. `computeReadiness` calls it for presentation; `app.check_launch_readiness`, a `before update of operational_state` trigger, calls the same function for enforcement, so the two can never disagree (I13's shape, one table over). **Verified non-vacuous**: the first version of `launch_organization` checked only `organization.manage` and not this function at all, so any caller holding that capability could invoke it directly through PostgREST and skip `computeReadiness` entirely — `lifecycle.test.ts` asserts a direct RPC call is refused while a blocker is open. |

Invariants are added when a rule becomes load-bearing, not in anticipation. Each new one
arrives with the slice that enforces it.

## Core entities

The kernel. Every engine consumes these rather than defining its own, and every module is
sold on top of them.

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

## Engine ownership

**An engine is code that owns entities and rules. It is not a module** — a module is what a
tenant switches on and is billed for, it is a row rather than a directory, and nothing in this
section governs it. `constraints.md` D25 pins the two words apart and explains what the
collision cost.

| Engine | Owns |
|---|---|
| Pricing | `priceWorkItem` — the price book, quoted lines, invoices, payments, job economics (I4). |
| Scheduling | `freeWindows` and `listSchedule` — the calendar, availability, resource assignment, operating hours, double-booking (I5, I7). |

**Stale until this line, this table said `*(none yet)*`.** `constraints.md`'s own Engines table
has listed both of these as **Built** since M2/M3 — this table simply hadn't been updated to
agree with it. The definition above still holds: an engine appears here on two independent
pieces of evidence, and each of these has them — the prior repositories `vision.md` names, plus
the invariant machinery (I4, I5, I7) that would break if either calculation moved.

Filled in as engines are extracted. An engine appears here on two independent pieces of
evidence, at least one from a system that shipped — never in anticipation, and never on the
strength of one source's requirements. A direct instruction is evidence in its own right, since
the bar exists to stop speculative building, not to require a second customer before the owner's
own request counts.

**A module needs no entry here at all.** CRM is a module with no engine: the timeline is a
projection of `events` and the intelligence is arithmetic over work items, prices and payments.
Weather is another (D11). That is the normal case, and an engine with no module is the
suspicious one.

## Not yet engines

Named by the vision, deliberately absent. Create each **on two independent pieces of
evidence, at least one from a system that shipped** — not on a second call site. A second
caller inside one business is grounds for extracting a function into the domain layer, which
is a cheaper and different thing (`constraints.md`, Scope and abstraction). Several of the
names below are also *module* names, and that is not a contradiction: `bookings` may be a
module a tenant enables long before any code is extracted under that name.

`scheduling` · `dispatch` · `pricing` · `inventory` · `maintenance` · `bookings` ·
`communications` · `finance` · `automations` · `reporting`

Their eventual existence is not permission to stub them now. An empty directory with a
`README` describing future intent is a speculative abstraction with extra steps.

## The scheduling engine is one engine

`constraints.md` does not repeat this, so it is recorded here.

Scheduling, Dispatch, Booking, and Maintenance are frequently described as four engines.
They are one engine with four policies. All four reduce to the same statement:

> A unit of work needs a time, a resource, and a place, subject to constraints.

Built as separate engines, they become four calendars, four availability models, and four
conflict-resolution bugs. Build one scheduling core over Work Item and Resource; Booking,
Dispatch, and Maintenance are rule sets and screens above it. **They are still four modules** —
a tenant enables Bookings without enabling Dispatch — which is the clearest illustration of why
D25 separates the words: one engine, four things a business can buy.

The same collapse applies to automations and workflows: one trigger-condition-action runtime,
two authoring interfaces.
