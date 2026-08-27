# Changelog

Shipped work, recorded on merge. Milestone definitions live in `docs/roadmap.md`; task state
lives on the issue board. Nothing here has a checkbox (`constraints.md` D9).

## Unreleased

### M1 — the kernel, demonstrated

`roadmap.md` does not describe M1 as a list of tables. It describes one demonstration, and
calls it "the thing every prior attempt deferred". `apps/web/tests/milestone-m1.test.ts` is
that demonstration.

Two whole businesses are built from **byte-identical input** — the same organization name,
customer email, customer name, site label, technician name, machine, board column, job title,
field key and file name. Not similar: identical. Every one is a natural key a single-tenant
schema would have made globally unique, and every one collides harmlessly.

- **Block** is proved by the collisions succeeding. **Observe** is proved by each tenant
  seeing exactly its own rows — asserted as counts and ids, never as emptiness, because a
  version where both tenants saw nothing would pass for entirely the wrong reason.
- Both tenants have **two users each**, so "each with its own users" is literally true, and
  each person sees their own role rather than a colleague's.
- Holding the other tenant's real ids grants nothing: `getOrganization` returns null and every
  list returns empty, because from there those rows do not exist.
- The composite references are sampled together — a work item borrowing a customer, a junction
  row borrowing a location, an asset borrowing an owner — so the kernel is shown holding the
  line all at once rather than one file at a time.
- **Verified non-vacuous**, and the first attempt at that failed instructively. Applying a
  global `customers_email_unique` to a database that already held both tenants' rows could not
  create the index at all, leaving the table with *no* unique index and the test passing
  trivially. Rebuilt from scratch first, the real control lands: building the *second* business
  dies on the customer email and all nine assertions are skipped — the failure
  `constraints.md` quotes from `tire-app-template` by name.

M1's criteria are met: two organizations, each with its own users, customers, locations and
work items, none able to observe or block the other, all carrying per-tenant custom fields.
**I1, I2, I3, I11, I12, I16, I17 and I18 are enforced.**

Deliberately absent: nothing schedules. Work items have no window, no exclusion constraint, and
no update policy at all — a work item cannot currently change status, because an update policy
without transition rules would let it move anywhere. I5, I6, I7, I9 and I13 are M2.

Per D9 this is where the milestone is recorded. `roadmap.md` keeps the criteria and gains no
checkbox.

Verified against a database rebuilt from scratch with `pnpm db:reset`: 137 tests, gate green.

### Members

A second person can join an organization. Until now `create_organization` was the only thing
that wrote a `memberships` row and the table had no insert policy, so every organization had
exactly one member permanently — M1's "each with its own users" was impossible rather than
untested.

- `infra/supabase/migrations/20260827000006_members.sql` — `memberships.display_name`,
  `add_member_by_email`, and `create_organization` gaining the founder's own name.
- **A real bug, exposed the moment a second member existed.** `listMyOrganizations` and
  `getOrganization` selected memberships with no `user_id` filter — correct only while an
  organization had one member. With two, each person saw the organization twice and could be
  shown a *colleague's* role and capabilities as their own. Every guard still refused the
  actual operations, so it was never privilege escalation; the UI would simply have offered
  what RLS then denied. Fixed, and pinned by a regression test that names it.
- **No new capability.** `role.manage` already governs what roles exist and who holds which;
  who is *in* the organization is the same administrative concern.
- `add_member_by_email` is the only SECURITY DEFINER function here that genuinely needs to
  be — `auth.users` is not readable by `authenticated`, deliberately. That makes its own
  capability check load-bearing rather than decorative: DEFINER bypasses RLS, so nothing else
  stands between a caller and a `memberships` insert. There is still no insert policy,
  because there is no second path to guard.
- **Known disclosure, recorded rather than discovered later:** a caller holding `role.manage`
  can learn whether an address has an account, because "no account for that address" must be
  distinguishable from "added" for the screen to work. Blast radius is one organization's
  administrators; the alternative is the invitation system D19 says this slice may not
  invent.
- **D19's prediction fired and held.** It said the trigger for a display name would be "the
  first screen that must render an actor's name" and that the answer would be a per-tenant
  name on `memberships` rather than a global profile. That screen is the people list, and
  that is what it got. A test asserts the same account is "Sam" in one organization and
  "Contractor" in another.
- `members.test.ts` — thirteen tests, and the first anywhere that deny a capability to a
  genuinely different person rather than to one member reassigning their own role.

Verified against a database rebuilt from scratch with `pnpm db:reset`: 128 tests, gate green.

### Identity, and two entities refused by name

Three documents corrected after reading the kernel back against what it actually
demonstrates.

- **`roadmap.md` M1 now names the membership gap.** `create_organization` is the only thing
  that writes a `memberships` row and the table has no insert policy, so every organization
  has exactly one member permanently. "Each with its own users" was not untested — it was
  impossible, and roles and capabilities have never been exercised in their real form
  because every multi-member scenario in the tests is one member reassigning their own role.
- **New decision D19** — identity lives in `auth.users` and nowhere else. No `profiles`
  mirror, because two answers to "who is this" drift and the trigger keeping them in step is
  a business step performed by the database. The cost is stated rather than hidden: there is
  nowhere to put an actor's display name, so a timeline renders a uuid until a screen needs
  otherwise — and the fix is more likely a per-tenant name on `memberships` than a global
  profile.
- D19 also refuses `resources.user_id`. A Resource is capacity; a User is an account. A
  business schedules people who never log in and grants accounts to people never scheduled.
  Adding the link now would answer three questions — may a resource exist without an account,
  may an account hold two resources, what happens to the schedule when someone leaves — by
  guesswork rather than by a caller.
- **`domain-model.md` answers Task and Team** rather than dropping them. Task is a Work Item
  with a configured type. Team is not yet anything: grouping earns a table when something
  filters, assigns or reports by it, and nothing does.

No code changed. Still four documents, against D8's budget of eight.

### Documents

The last entity M1 names, and the only one with a security surface outside Postgres.

- `infra/supabase/migrations/20260827000005_documents.sql` — `documents`, one private
  `documents` bucket, storage policies on `storage.objects`, and a `document.create`
  capability.
- **The obvious design is wrong, and the migration says why.** A polymorphic
  `(entity_type, entity_id)` pair cannot be a foreign key — it points at a different table
  depending on its own contents — so nothing would stop a document naming another tenant's
  customer, and RLS would not help. I18 is unimplementable polymorphically. The attachment is
  four nullable columns with four composite references and a constraint that exactly one is
  set, which costs a column per attachable entity and buys the guarantee.
- The I18 conformance assertion would **not** have caught the polymorphic version — it checks
  that foreign keys carry `organization_id`, and a design with no foreign key passes
  trivially. `schema-conformance.test.ts` now also forbids an `(entity_type, entity_id)` pair
  outside `events`, which is an append-only log rather than a reference.
- **New invariant I19** — a private file is never reachable without a short-lived signature
  minted after the same permission check the rest of the operation gets. The bucket is
  private, so there is no durable URL to leak. Storage policies pin an object key's first
  path segment to an organization the caller belongs to, under the caller's own JWT.
  `getDocumentUrl` reads the metadata row under RLS *first* — that read is the check — then
  signs for 60 seconds, and the download route mints per click so nothing durable is rendered
  into a page.
- **Verified by loosening the storage policy** to `bucket_id = 'documents'` alone: the
  cross-tenant write then succeeds, the assertion failing with *expected null not to be
  null*. Nothing in TypeScript was ever between that call and the bucket.
- Bytes are written before the metadata row, deliberately. The two writes cannot be one
  transaction, so one failure mode has to be chosen: bytes with no row are unreferenced and
  unreachable — `documents` is the authority on who owns them — while a row with no bytes is
  a broken link an operator sees. A compensating delete makes the first case rare.
- A customer detail page at `/customers/[customerId]` carries the upload form and the
  document list; `getCustomer` arrives with it as its caller.

D15's consequence paragraph is corrected: it claimed two casts in `customers.ts` were "the
whole of that gap", which stopped being true once four more `create_*` functions gained
optional arguments.

Verified against a database rebuilt from scratch with `pnpm db:reset`: 113 tests, gate green.

### Assets

What work is *about*, as opposed to Resource, which is what work is done *with*. The same
physical van is both — a Resource when it carries a technician to a job, an Asset when the
job is servicing the van. Merging them would force one row to answer two unrelated
questions, and the scheduling engine only ever asks the first.

- `infra/supabase/migrations/20260827000004_assets.sql` — `assets` with optional composite
  references to a customer and a location, an `asset.create` capability, and the registry's
  fifth entity type.
- **Customer-owned equipment is the case that shapes the table.** An asset is frequently not
  the tenant's property; it is the customer's machine that the tenant maintains. That makes
  `assets.customer_id` another I18 surface, tested by inserting directly with the other
  tenant's customer.
- `work_items` gains `asset_id`, its fifth composite reference, with the caller in the same
  change: the work item form gains an asset selector and the board renders it. "Service the
  compressor" is work *about* an asset, which is what makes maintenance a rule set over the
  kernel rather than a module of its own.
- `create_work_item` is dropped and recreated rather than replaced, because adding a
  parameter changes the signature and `CREATE OR REPLACE` would leave the old arity behind
  as an overload.
- `OptionalSelect` extracted at its second caller.

No new invariant — I17 gains a fifth table, I18 gains three references.

Verified against a database rebuilt from scratch with `pnpm db:reset`: 99 tests, gate green.

### Work items

The universal operational object, and the first place D6 has teeth. A job, service call,
inspection, delivery or booking is this table with different configuration.

- `infra/supabase/migrations/20260827000003_work_items.sql` — `work_item_statuses` as
  per-tenant rows, `work_items` with four composite references, a `work_item.create`
  capability, and the registry's fourth entity type.
- **D6's first real exercise.** Nothing in the domain layer knows what a status *means*. The
  test builds one tenant whose first status is "Scheduled" and another whose first is
  "Ingepland", and neither is privileged. A Postgres enum here would mean a deploy every time
  a customer renames a column on their board.
- **I18, four times over** — status, customer, location and resource. Confirmed by replacing
  one composite key with the plain `references customers (id)`: the cross-tenant insert then
  succeeds, the assertion failing with *expected undefined to be 23503*, `undefined` meaning
  there was no error at all.
- `on delete set null (customer_id)` names its column deliberately. The bare form would try
  to null `organization_id` too, which is `NOT NULL`, and deletes would fail at runtime
  rather than at migration time. Tested over a direct connection, because `customers` grants
  only select and insert and no API caller can delete one.
- **Three absences, each a roadmap boundary**: no scheduled window and no exclusion
  constraint (I7 is M2, and window columns without the constraint governing them would create
  the very state I7 prevents); no transition validation and therefore no update policy at all
  (I13 is M2 — an update policy now would let a work item move anywhere); and no work item
  *type*, because with one implicit type per tenant a `type` column's only consumer is itself.

No new invariant — I17 gains a fourth table, I18 gains four references.

Verified against a database rebuilt from scratch with `pnpm db:reset`: 87 tests, gate green.

### Resources

The last kernel entity before Work Item, and deliberately the thinnest slice so far. A
resource is a name plus whatever fields the tenant has defined; everything that makes one
interesting — availability, assignment, double-booking — belongs to the thing that consumes
it.

- `infra/supabase/migrations/20260827000002_resources.sql` — `resources`, a
  `resource.create` capability backfilled onto every role holding `customer.create`, and the
  registry's third entity type.
- **Three deliberate absences**, each recorded in the migration because each looks like an
  oversight: no `kind` column (nothing branches on it; a tenant that wants to group
  resources has field definitions), no `active` flag (retiring matters only once something
  can be scheduled), and no unique index on name (two employees called Sam Okafor is
  ordinary).
- `resources_org_id_unique` is written ahead of its foreign key — the one thing here built
  for the next slice. `work_items` needs a composite reference to satisfy I18, that
  reference needs a `unique (organization_id, id)` to point at, and adding one to a
  populated table is the expensive direction.
- Registering a third entity with the registry cost two statements and no new validator,
  because `app.check_custom_fields` takes the entity type as an argument.
  `resources.test.ts` "will not accept a field defined for a different entity" is the
  property that makes the registry per-entity rather than per-tenant.
- **Three extractions at the caller that made them duplicates:** `resolveCustom` pairs
  `listFieldDefinitions` with `parseCustom` for all three entities; `CustomFieldValues`
  replaces a third copy of the same display JSX; the customer and location pages now call it.

No new invariant — I17 gains a third table, I11 and I12 hold as before.

Verified against a database rebuilt from scratch with `pnpm db:reset`: 72 tests, gate green.

### Locations

The first many-to-many in the schema, and the first entity born carrying `custom` rather than
having it retrofitted — which is the payoff D18 was arguing for. One line of migration
attaches the registry to a second entity, because the column shipped with the table.

- `infra/supabase/migrations/20260827000001_locations.sql` — `locations` with label, address,
  access notes and `custom`; `customer_locations` joining them to customers; a new
  `location.create` capability, backfilled onto every role that already holds
  `customer.create`.
- **New invariant I18** — a row referencing two tenant-owned entities can only reference
  entities in its own tenant. `customer_locations` references `customers (organization_id,
  id)` and `locations (organization_id, id)` rather than either table's `id`, which makes a
  cross-tenant row impossible to write down.
- **RLS does not cover this, and that is the finding.** A policy on the junction sees the
  row's own `organization_id`, which genuinely belongs to the caller, and is satisfied —
  while the `location_id` beside it points at another tenant. Verified by replacing the
  composite key with the plain `references locations (id)` anyone would write by reflex: the
  cross-tenant insert then **succeeds**, with no policy objecting. `constraints.md` gains
  the Never and the worked failure next to the exclusion-constraint one it rhymes with.
- `schema-conformance.test.ts` asserts I18 from `pg_constraint` for every reference between
  two tables carrying `organization_id`, so the next junction table cannot ship without it.
  Carries its own negative control — a probe table with a plain foreign key is caught by name.
- `app.check_custom_fields` gains a second table without gaining a second function: the
  entity type was already a trigger argument, which is what that argument was for.
  `locations.test.ts` "scopes a field definition to its entity type" proves the lookup is
  keyed on `(organization_id, entity_type, key)` and not on the key alone.
- `CustomFieldInputs` and `customValuesFromFormData` are extracted at their second caller,
  not in anticipation — the customer form and the location form need the identical mapping
  from field kind to input, and two copies would drift the first time a kind is added.
  `isEntity` and `isCustomFieldEntity` were briefly the same predicate twice; collapsed.
- `/organizations/[organizationId]/locations` lists locations with the customers served from
  each, creates them, and links them. The fields screen now has the entity selector its own
  comment promised "in the change that adds the second one" — and it is driven by
  `CUSTOM_FIELD_ENTITIES`, so a third entity appears there without anyone editing the page.
- `tests/locations.test.ts` — eleven tests, including the direct cross-tenant insert, the
  domain reporting it as absent rather than forbidden, and the other tenant being unable to
  see the link at all.

Verified against a database rebuilt from scratch with `pnpm db:reset`: 64 tests, gate green.

### Field definitions

D7's registry, and the first entity to carry a `custom` column. Every entity M1 still owes —
`Location`, `Asset`, `Work Item`, `Resource` — can now be born with custom fields instead of
having them bolted on afterwards, which is the migration D7 exists to avoid.

- `infra/supabase/migrations/20260826000003_field_definitions.sql` — `field_definitions` per
  tenant and entity type, with `field_definitions_org_entity_key_unique` on
  `(organization_id, entity_type, key)`. Two businesses both wanting a field called
  `vat_number` on their customers is the ordinary case, and that index leading with
  `organization_id` is what makes both succeed.
- `customers.custom jsonb`, and a new `field.manage` capability. `roles_capabilities_known`
  is dropped and rewritten to admit it — a correction as a new migration, never an edit to an
  applied one — and every role already holding `role.manage` is backfilled with it, because
  an organization whose only administrator could not define a field would have no way to
  grant themselves in.
- **New invariant I17** — only a field the tenant declared may appear in `custom`, and it
  holds the kind the registry says. `app.check_custom_fields` is a trigger on `customers`
  that refuses undeclared keys, absent required fields, and mistyped values, scoped by
  `organization_id` so another tenant's definition authorises nothing. `customers` grants
  INSERT to authenticated, so a direct PostgREST call never passes through the domain layer —
  the same reason `public.assign_role` puts its last-manager rule in the database.
- `parseCustom` re-checks the identical rules in the domain layer, for the message rather
  than the guarantee. The same shape as `requireActor` alongside RLS: one produces a usable
  error, the other produces the promise. Verified by negative control — dropping the trigger
  fails exactly the three tests that insert directly and leaves the domain-level ones passing,
  which is what proves the domain check would not have covered them.
- Field kinds are `text`, `number` and `boolean`. Each has a coercion branch in the domain
  and a validation branch in the trigger, so the list is platform vocabulary like
  capabilities: adding one is code plus a migration, never tenant configuration.
- `/organizations/[organizationId]/fields` defines fields; the customer form renders whatever
  this tenant declared. Hiding the form is a courtesy — `field_definitions_insert` requires
  `field.manage`, and `field-definitions.test.ts` asserts a member who has lost that
  capability is refused by RLS while still a member.
- `tests/field-definitions.test.ts` — thirteen tests, including the colliding-key test in
  both tenants, cross-tenant definition leakage, numeric coercion, and a check that defining
  a required field does not retroactively invalidate customers that already exist.

**D7 is not fully built, and D18 now says so.** There is no GIN index on `custom`, because
nothing queries by custom value yet. Adding it later is `create index concurrently` against a
table whose shape does not change; adding the column and the registry later is the expensive
migration. The expensive half shipped.

I8 gains a test but not an entry — its substance is snapshot columns on committed work, and
those do not exist yet.

Verified against a database rebuilt from scratch with `pnpm db:reset`: 53 tests, gate green.

### Generated database types, and the scaffolding decisions written down

M0's acceptance criterion is met. `/scope` was run against the tenancy kernel task and
returned five invariants and five decision records with nothing supplied by the operator.
Its one finding is now D18.

- `pnpm db:types` generates `apps/web/src/lib/db/database.types.ts` from the local schema,
  and the file is checked in. `Db` is `SupabaseClient<Database>` rather than an untyped
  client, which deleted a dozen casts of the form `row.id as string` and
  `row.email as string | null` — each one a column type hand-copied out of a migration, and
  each one silencing exactly the error the generic now catches. `organizations.ts`'s
  hand-written `MembershipRow` survives, but it is now *checked against* the generated embed
  shape rather than asserted over it.
- Generated types are not authoritative for function arguments. Postgres records no
  nullability for parameters, so `p_email text` — which accepts null by design — is emitted
  as `string`. Two casts in `customers.ts` bridge that and say why; they are the whole of
  that gap in this codebase.
- `schema-conformance.test.ts` compares the checked-in file against `pg_attribute` in both
  directions, because a stale generated file is worse than none: `tsc` will validate every
  query against a schema that no longer exists and pass. Verified by negative control both
  ways — an invented column fails as `customers.bogus_column`, a removed one as
  `customers.phone`.
- **D13-D17** record what the tree already did and no document had captured: pnpm without a
  build orchestrator, the App Router with one caller-JWT client per request, raw SQL
  migrations with generated types, vitest against a real Postgres and the four-step gate, and
  how tenant identity reaches Postgres. Each names its rejected alternative and what would
  trigger a revisit, and cites `tire-app-template` or `saas-agent-platform` where the two
  prior repos disagree.
- **D18** resolves the contradiction `/scope` found. D7 puts custom fields in the kernel; the
  no-column-without-a-caller rule forbids a `custom` column whose registry does not exist.
  The kernel is M1 and M1 is several slices, so both hold — and `roadmap.md` M1's acceptance
  criteria now name `field_definitions`, which is what gives D7 something that checks it.
- `CLAUDE.md`'s "Current state" described one vertical slice; four have shipped. Fixed, along
  with a stale invariant count in `roadmap.md` M0.

**No new invariant.** This change enforces nothing in `domain-model.md` that was not already
enforced — it removes a class of runtime error that has no row in that table. The `Enforced
by` column is unchanged on purpose.

Verified: 40 tests, gate green.

### Roles and capabilities

Turns I12 from "is there an actor" into "may this actor", and puts the answer in RLS.

- `infra/supabase/migrations/20260826000002_roles.sql` — `roles` per tenant, holding a name
  the tenant chooses and a `capabilities` array the platform defines. `memberships.role`
  (text nobody read) becomes `memberships.role_id`, backfilled from existing rows.
- A composite foreign key `(organization_id, role_id) → roles (organization_id, id)` makes
  "a membership's role belongs to the same organization" a database guarantee rather than
  something every caller must remember to check.
- `app.has_capability(organization_id, capability)` is the single answer to "may the caller
  do this here", and it is called from `customers_insert`, `roles_insert` and
  `memberships_update`. Creating a customer now requires `customer.create`, not mere
  membership.
- `public.assign_role` refuses to leave an organization with nobody holding `role.manage`.
  That is an invariant spanning rows, so it cannot be a column constraint and must not be a
  domain-only check a direct RPC call would walk past.
- `lib/domain/tenancy/capabilities.ts` declares the capability vocabulary; `roles.ts` owns
  what a well-formed role is. `/organizations/[organizationId]/roles` lists roles and, for
  those who may, creates them.
- **New invariant I16** — every declared capability is backed by a database policy.
  `schema-conformance.test.ts` reads `pg_policy` and fails if one is not. Verified by
  negative control: adding an unenforced capability makes it fail by name.

Verified against a database rebuilt from scratch with `pnpm db:reset`: 39 tests, gate green.

### Customer

The first genuinely tenant-owned entity — `organizations` is the tenant, and `memberships`
and `events` merely reference it.

- `infra/supabase/migrations/20260826000001_customers.sql` — `customers` with
  `organization_id`, RLS enabled and forced, and `customers_org_email_unique` on
  `(organization_id, lower(email))`. That index is the regression test for the failure
  `constraints.md` names: a global `customers_email_unique` meant two tenants could never
  share a customer email address.
- `public.create_customer` is SECURITY **INVOKER**, unlike `create_organization`. The caller
  is already a member, so RLS covers both inserts and the function needs no privilege of its
  own — it is purely a transaction boundary, so a customer can never exist without the
  timeline event that opens its history.
- `lib/domain/customers/customers.ts`, and `/organizations/[organizationId]/customers`. The
  organization is a route parameter rather than session state, so nothing needed an "active
  organization" concept that has no other caller yet.
- `tests/customers.test.ts` — eight tests, including two tenants holding the same customer
  email address, and a rollback check proving a failed creation leaves no orphan event.

`schema-conformance.test.ts` covered the new table with no change, which is what it was for.

### Next 16 `middleware` → `proxy`

`src/middleware.ts` became `src/proxy.ts` and `lib/db/middleware.ts` became
`lib/db/session.ts`, which is what it always did. The build no longer warns.

### Authentication and session

Makes the platform reachable by a person rather than only by its tests.

- `apps/web/src/proxy.ts` and `lib/db/session.ts` — session refresh on every
  request, plus a redirect for anonymous callers. The redirect is convenience: the
  server-side guard and RLS remain the authorization boundary, and the redirect target is a
  fixed literal because a `?next=` parameter would be an open redirector.
- `lib/domain/identity/credentials.ts` — sign in, register, sign out, with email
  normalisation and a password minimum owned by the domain rather than by provider config.
  Sign-in failure returns one message whether the account is absent or the password is
  wrong, so it cannot be used to enumerate addresses.
- `/sign-in`, `/sign-up`, and sign-out on the organizations page. All callers.
- `tests/schema-conformance.test.ts` — reads `pg_class`, `pg_index`, and `pg_constraint` to
  assert RLS and the leading-column rule for **every** table in `public`, including tables
  not written yet. Carries its own negative control.
- `tests/identity.test.ts` — registration, sign-in, normalisation, and the
  non-enumeration property.

**I1** and **I2** are now enforced for every future table, not only the three that exist.
**I12** gains the server-side guard that runs regardless of the proxy.

Verified: 20 tests, and the redirect behaviour checked against a running dev server. The
browser cookie handshake through `@supabase/ssr` is covered only in parts — a
browser-level test is the honest way to close that, and does not exist yet.

### Tenancy kernel — organizations, memberships, events

The first vertical slice: schema, domain, route, UI, guard, test.

- `infra/supabase/migrations/20260825000001_tenancy.sql` — `organizations` (the tenant),
  `memberships`, and the append-only `events` table; RLS enabled and forced on all three;
  `app.current_tenant_ids()` as the single tenant resolution point; `public.create_organization`
  as the narrow privileged bootstrap.
- `apps/web/src/lib/domain/tenancy/` — `listMyOrganizations`, `createOrganization`,
  `requireActor`. The route, the server action, and the form are callers and decide nothing.
- `apps/web/tests/tenancy.test.ts` — two organizations with identical names in one database,
  under two genuinely signed-in users. Verified non-vacuous: three organizations exist while
  one user sees two and the other sees one.

Newly enforced: **I1, I2, I3, I11, I12** (see `docs/domain-model.md`).

Deliberately absent: no `packages/`, no `services/api/`, no roles table, no per-tenant
terminology, no Customer, Location, Asset, Work Item, Resource, Document, or Field
Definition. Each arrives with the slice that needs it.
