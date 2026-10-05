# Field / Scheduling current-state audit

A record of what the Field and scheduling code, schema and tests do on `main` at commit
`8bc748d`, taken from source and migrations rather than from comments. The contract it supports is
in `domain-model.md` ("Field and scheduling contract", I5–I9). Nothing here is a plan; the two
slices it prepares for are named at the end.

## 1. Ownership matrix

| Concept | Owner | Persistence | Readers | Writers | Surface | Hard invariants | Gaps |
|---|---|---|---|---|---|---|---|
| Work Item | `lib/domain/work-items/work-items.ts` | `work_items` | `listWorkItems`, Schedule, reports, Home | `create_work_item`, `update_work_item`, `create_booking` | `/work`, `/work/[id]` | I13, I18, I20 | none found |
| Work Type | `work-items/types.ts` | `work_item_types` | `listBookableTypes`, forms | `setTypeBookable`, type CRUD (`field.manage`) | `/work/configuration` | D6 (no branching on a name; a search of `lib`, `features` and `app` found none) | no schedulable declaration |
| Work Status | `work-items/statuses.ts`, `transitions.ts` | `work_item_statuses`, `work_item_transitions` | everywhere | `field.manage`; `change_work_item_status` | `/work/configuration` | I13; `releases_resource` mirrored to `work_items.status_releases_resource` | none |
| Schedule window | `scheduling/schedule.ts` | `work_items.scheduled_during` (`tstzrange`), `occupies` | `listSchedule`, `listScheduleDays`, `resource_commitments` | `schedule_work_item`, `unschedule_work_item`, `create_booking` | work page form; Schedule is read-only | I6, I7, I9; window bounded and half-open | one window and one resource per item |
| Availability | `scheduling/availability.ts` (`freeWindows`) | derived, none | Schedule, `bookableSlots`, Field Home | none | Schedule, `/book/[slug]` | I5, I6 | predicate written four times (§4) |
| Operating hours | `scheduling/operating-hours.ts` | `operating_hours` | `openWindows` (organization) | `field.manage` | `/schedule/configuration` | no seeded week; empty means open | organization-wide; a resource's own hours and time off are Resource Working Hours (I82) |
| Resource | `resources/resources.ts` | `resources` (+ optional `membership_id`, `resource_class`; capabilities in `resource_capabilities` / `resource_capability_assignments`) | `listResources`, Schedule | `create_resource`, `set_resource_membership` | `/resources` | I18; one Resource per Membership | working hours and time off resolved by Work Order 6 (`resource_working_schedules`, `resource_working_hours`, `resource_availability_exceptions`, I82); organization hours stay advisory for a resource that inherits |
| Assignment | none of its own | `work_items.resource_id` | as above | `schedule_work_item`, `create_work_item` | "Assign to" select | exclusion constraint | single resource only |
| Location | `locations/locations.ts` | `locations`, `customer_locations`, `work_items.location_id` | Work, map | `create_location` | `/locations` | I18 | no service areas; coordinates optional |
| Asset | `assets/assets.ts` | `assets`, `work_items.asset_id` | Work, readings | `asset.create` | `/assets` (module `assets`) | I18 | none against Resource; the two are kept apart |
| Booking | `booking/booking.ts` | `work_item_types.booking_*`, `external_actors` | `bookableSlots`, `resource_commitments`, `bookable_resources` | `create_booking` (definer) | `/book/[slug]` | I6, D22, one booking per visitor | the server picks a deterministic complete combination at booking time (I85); no choice of resource by the visitor |
| Price | `pricing/prices.ts` (`priceWorkItem`) | `work_item_priced_lines` | Work, invoices | `add_work_item_priced_line` | Work, booking page | I4, I8 | none |
| Buffer | `organizations.buffer_minutes` | derived `occupies` | `listSchedule` | `updateOrganization` | organization settings | I7 | one value for every resource and type |
| Calendar | `features/scheduling/calendar/*` | derived, none | — | none | `/schedule` (Day, Week, Month) | I5 | draws only resource-assigned work |
| Event / audit | `events` table | `events` | timeline | the RPCs above | timeline | I11 | §6 |

No competing calendar or appointment authority exists: no `calendars`, `appointments`, `services`
or `service_types` table, and no `infield` directory.

## 2. Control flow

**Staff scheduling.** Work page form (`work-operations-forms.tsx`) → server action
(`work/actions.ts`) → `scheduleWorkItem` (`scheduling/schedule.ts`; validates the window, never
checks availability) → RPC `schedule_work_item` → one `UPDATE work_items` →
`work_items_capability_for_changed_columns` trigger (`work_item.schedule`) →
`work_items_mirror_occupies` trigger (adds the buffer) → `work_items_resource_not_double_booked`
(`23P01`, mapped to `scheduling.double_booked`) → `events` row `work_item.scheduled` → page
re-read through `listScheduleDays`.

**Availability read.** `/schedule` → `listScheduleDays` → three reads under RLS (`resources`,
`work_items` where `resource_id is not null and not status_releases_resource and occupies && range`,
`operating_hours`) → `openWindows` → `resourceSchedulesFor` → `freeWindows` over each resource's
`occupied` windows → `ScheduleWorkspace` draws it.

**Public booking.** `/book/[slug]` → `resolveBookingSlug` (`booking_organization`, requires the
`booking` module and a published type) → `beginBooking` (anonymous sign-in, one `external_actors`
row) → `listBookableTypes` → `bookableSlots` (`bookable_resources` ids, `resource_commitments`,
`operating_hours`, then the same `freeWindows`) → `bookSlot` → RPC `create_booking` (checks scope
and module, one booking per visitor, finds or creates the customer, inserts the Work Item with the
type's status and duration, copies the price line, writes `work_item.booked`) → exclusion
constraint refuses a taken slot (`23P01` → `booking.slot_taken`) → the job appears on Schedule
like any other.

## 3. Scheduling invariants

Existing IDs are used; no new ones are minted.

| Rule | Id | Enforced by | Verified by | Gap |
|---|---|---|---|---|
| One availability calculation | I5 | `freeWindows` | `availability.test.ts`, `buffer.test.ts`, `work-item-editing.test.ts` | the public view's agreement was unproven until `booking-availability-agreement.test.ts` |
| Availability is advisory | I6 | the constraint, not a pre-check | `availability.test.ts` (stale read then `23P01`), `booking.test.ts` | none |
| No double-booking | I7 | `work_items_resource_not_double_booked` (gist, partial, tenant-leading) | `scheduling.test.ts`, `snippets/i7-vacuity-control.sql` | none |
| No cross-tenant resource | I18 | composite FK `(organization_id, resource_id)` | `scheduling.test.ts` | none |
| Absolute instants, tenant zone | I9 | `tstzrange`, `organizations.timezone`, `formatWindow` | `scheduling.test.ts`, `availability.test.ts` (DST) | none |
| Released work frees capacity | I7 | `releases_resource` mirrored by two triggers | `work-item-editing.test.ts`; public side now `booking-availability-agreement.test.ts` | none |
| Buffers occupy | I7 | `occupies` | `buffer.test.ts`; public side now `booking-availability-agreement.test.ts` | one buffer for all |
| Calendar is derived | constraints.md | no calendar table | `availability.test.ts` (day read from rows, "no calendar table"); `scheduling-workspace.test.ts` reads the calendar sources | none |
| Booking uses internal truth | I5, I6 | `bookableSlots` reuses `freeWindows`; `create_booking` inserts a `work_items` row | `booking.test.ts` | none |

Concurrency protection for a stale answer is proved against the real database in
`availability.test.ts` and `booking.test.ts`, not mocked.

## 4. Where the predicate is written

The commitment predicate (resource set, `occupies`, not released) exists as: the constraint;
`listSchedule`/`listScheduleDays`; `time_committed`; and the `resource_commitments` view. Only the
last had no agreement test. Added: `booking-availability-agreement.test.ts`. Confirmed non-vacuous
by redefining the view without `not status_releases_resource` on the local database — the release
case failed — then restoring it. The buffer case was not mutation-checked on its own.

Not duplicates: `work_at_risk`, `the_week_ahead` and the assistant's schedule tool return what is
booked, never what is free (I5, D30). `propose_reschedule` shifts by an offset and lets the
constraint decide.

## 5. Single-resource limitation — resolved

Work Order 4 (`20261116000001`, `20261116000002`) replaced `work_items.resource_id` with
`work_item_resource_assignments`, the only answer to which resources are on a work item, and moved
the double-booking constraint onto it (I7). Every dependency this audit inventoried — the column and
its exclusion constraint, `schedule_work_item`/`unschedule_work_item`/`create_work_item`/
`create_booking`, `resource_commitments`, the reports, automation conditions, `work_at_risk`,
`schedule_ahead`, the Work, Schedule, Home and Resource pages, the demo builder and event
payloads — was migrated in the same slice; none reads the old column, which no longer exists.
Scheduled work with nobody assigned is now drawn on Schedule as *Unassigned*.

Work types now declare what resources they need (Work Order 5, `20261117000001`, I81): class, quantity
and capabilities per requirement, with eligibility and job coverage derived. Resource working hours and time off
are resolved (Work Order 6, `20261118000001`, I82): `app.resource_open_windows` is organization hours ∩
resource hours − exceptions, read by Schedule and booking, with commitments still subtracted by
`freeWindows`, and an appointment outside an assigned resource's open time is refused at the database.
Multi-resource feasibility is resolved (Work Order 7, `20261120000001`, I85): one engine finds a distinct eligible, open and free resource for every required slot, explains an infeasible interval with structured reasons, and public booking now commits every resource a type needs (the one-resource limit is gone). Remaining: booking notice, horizon and cadence rules, organization closures and holidays, travel time, routing, service areas, traffic, dispatch, weather, and an event that distinguishes a first scheduling from a reschedule.

## 6. Events

Scheduling writes `work_item.scheduled` (resource, start, end), `work_item.unscheduled` (empty
payload) and `work_item.booked`; assignment at creation is inside `work_item.created`. Missing for
later notification and automation slices: nothing distinguishes a first scheduling from a
reschedule or a reassignment, and `unscheduled` does not record what was released. `work_item.updated`
omits the resource because `update_work_item` cannot change it. Not changed here.

## 7. Schedulable versus bookable

**Resolved by Work Order 2 (`20261112000001`, I80).** At the time of this audit: no Work Type
declared schedulability, Schedule, Resources and Locations were shown to every business, and
`booking_*` was the only scheduling-shaped declaration a type had. A type now carries
`schedulable`; bookable implies it; `hasSchedulableWork` drives Schedule, Resources, Locations,
Field Home, Home and setup. Still true: work with a window and no Resource occupies nothing and is
not drawn on Schedule.

## 8. Contradictions found

| Item | Class | Resolved |
|---|---|---|
| I5 text said three expressions of the predicate; there are four | documentation stale | yes, `domain-model.md` I5 |
| The public view's agreement with the constraint had no test | missing evidence | yes, new test |
| Work scheduled with a time and no Resource blocks nothing and was not drawn on Schedule | code bug (invisible) | resolved: Schedule's Unassigned lane |
| No Work Type declared whether it is scheduled | unimplemented intended concept | resolved: I80 |
| `20260827000009` header comments describe the original constraint (no `occupies`, no release clause) | obsolete plan, history only | left; migrations are not edited |
| Field's `featureKeys` lists `weather_aware_dispatch` and `assignment`; no dispatch exists | unimplemented intended concept | left |
| `maplibre-gl` imported directly under `features/locations/map` | acceptable rendering dependency; geocoding is behind `lib/adapters/geocoding` | none |

## 9. Not verified

- No browser review of Field Home, Work, Schedule, Resources, Locations, Assets or `/book`. The
  demo builder refuses a database that already holds organizations and `demo:fresh` resets it; that
  was not done to the existing local database without being asked. Nothing above is a statement
  about how any screen looks.
- Capability checks were read in migrations (`work_item.schedule`, `resource.create`,
  `resource.update`, `field.manage`); the existing suites that exercise them were run, not
  re-derived.

## 10. Entry state for Work Order 2

Work Order 2 shipped: see I80 in `domain-model.md`. The single-resource dependency map in section 5
is unchanged and is the starting inventory for multi-resource assignment.
