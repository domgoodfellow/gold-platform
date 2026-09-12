# Changelog

Shipped work, recorded on merge. Milestone definitions live in `docs/roadmap.md`; task state
lives on the issue board. Nothing here has a checkbox (`constraints.md` D9).

## Unreleased

### Platform Context and Organization Context, one identity holding both, and the pieces that follow from it

D45. Platform authority stops being a Postgres role a session had to wear instead of
`authenticated` — the mechanism that used to force "somebody who is both staff and a member of an
organization loses the membership half while signed in." Staff are checked live
(`app.is_platform_staff()`/`app.require_platform_staff()`) from inside a policy or a function
body, so one identity can hold platform authority and any number of organization memberships at
once and switch between them in the context switcher. The organization's top ordinary role is
renamed to `Admin` (tenant vocabulary, never an authorization primitive — nothing branches on the
string). Organization invitations close the gap direct member-adding left, with a hashed token
unlike the customer portal's own plaintext one. Platform support access becomes a real, audited,
expiring session rather than a click with no record. `packages/types`, `packages/schemas`,
`packages/ui` and `packages/config` arrive, each with a real consumer in the same change.

- `supabase/migrations/20260915000001_platform_staff_is_checked_not_worn.sql` — `app.
  is_platform_staff()`; every table `platform_staff` read via its own Postgres role now reads it
  via a policy on `authenticated` instead; every narrow-door write function widens its grant to
  `authenticated`, keeping the internal staff check it already had; `organization_commercial_summary`/
  `organization_usage_detail` become `security definer` (a column grant could no longer do the
  job once staff share `authenticated`'s own); `platform_tenants` gains a `where
  app.is_platform_staff()` clause in its own body; the `platform_staff` Postgres role and its
  sign-in hook are retired.
- `supabase/migrations/20260915000002_the_founding_role_is_called_admin.sql` — `FOUNDING_ROLE`
  becomes `'Admin'`; a scoped data migration renames existing seed-created `Owner` rows holding
  exactly the founding capability set, and no others.
- `supabase/migrations/20260915000003_organization_invitations.sql` — `organization_invitations`
  (hashed token, `role.manage` reused), `invite_member`/`accept_invitation`; acceptance refuses
  unless the accepting account's own email matches the invited address.
- `supabase/migrations/20260915000004_platform_support_sessions.sql` — `platform_support_sessions`,
  `start_support_session`/`end_support_session`; grants no read beyond what staff already held.
- `apps/web/lib/domain/tenancy/invitations.ts`, `apps/web/lib/domain/platform/support.ts` — the
  domain layer for both; `apps/web/lib/adapters/email/` — a small new capability, GOLD's own
  transactional email, distinct from a tenant's billed channel.
- `apps/web/app/organizations/[organizationId]/org-shell.tsx` — `OrganizationSwitcher` lists the
  caller's real organizations and, when they hold platform authority, Platform Administration,
  sourced from `listMyOrganizations`/`isPlatformStaff` rather than a static link; its raw
  `<button>` becomes `@gold/ui`'s `Button`, closing one of `milestone-m11.test.ts`'s two
  violations as a side effect.
- `apps/web/app/(platform)/platform/organizations/[organizationId]/` — an "Open organization"
  action and, once a session is active, a support-view banner and a People list.
- `packages/types`, `packages/schemas`, `packages/ui`, `packages/config` — registered in
  `pnpm-workspace.yaml`; `@gold/ui` holds the shadcn primitives moved from `apps/web/components/
  ui/`, exported as subpaths, plus `Alert`/`Dialog`/`Table`/`Badge`, this record's own first
  callers.
- Docs: `docs/domain-model.md` I21 rewritten (mechanism moved, claim unchanged), I38/I39 added;
  `docs/constraints.md` D45; `CLAUDE.md`, `docs/market.md`, `docs/roadmap.md` corrected wherever
  they described the retired role-swap or used "tenant zero" language; `docs/ui-system-audit.md`
  retired per its own stated lifecycle (Phase 1 landed), its two still-open items folded into
  `docs/constraints.md`'s deferred table.

**Not built, named rather than left unstated.** Support access does not reach a tenant's own
operational tables (customers, work items, and the rest) — a future, separate slice. Teams and
`packages/sdk` stay deferred, per `docs/domain-model.md`'s and `docs/constraints.md`'s own
existing reasoning. A support session shows a member's display name, never their role's name —
staff have never held `select` on `roles`, and this record does not add it.

### An organization scopes its own provider, and a generated secret lives in Vault and nowhere else

Provider Bindings (D44): which external scope belongs to an organization, how GOLD provisions
and uses it safely, and where a generated credential is retained. Twilio is the one provider
proven end to end — a real subaccount, key and application, created idempotently and recorded
through the same narrow-function pattern D43 established; Resend and a tenant's own sending
domain get the lighter binding/resource support transactional email actually needs; Deepgram,
ElevenLabs and model inference get nothing new, because nothing yet calls for a binding of their
own.

- `supabase/migrations/20260912000001_an_organization_scopes_its_own_provider_binding.sql` —
  enables Supabase Vault; `organization_provider_bindings` (organization → provider → external
  scope → lifecycle) and `organization_provider_resources` (one externally created thing beneath
  a binding), both tenant-owned, RLS-scoped, with a composite foreign key leading with
  `organization_id` (I18, I2). Neither table carries any write grant to any role.
- `supabase/migrations/20260912000002_a_narrow_door_provisions_and_never_reads_back_a_secret.sql`
  — `begin_provider_binding`, `set_provider_binding_status`, `record_provider_resource`,
  `set_provider_resource_status` (all staff-only, idempotent by upsert), and
  `store_provider_secret` — the one function that ever writes to Vault, returning only the
  resource id it acted on. No role is granted `select` on `vault.secrets` or
  `vault.decrypted_secrets`, and `secret_id` is withheld from every column grant.
- `supabase/migrations/20260912000003_a_tenant_configures_only_what_is_already_bound.sql` —
  `set_calling_number` (D39) recreated to refuse a number already bound to a *different*
  organization, via a new `security definer` helper, `app.phone_number_owner` (needed because the
  function itself stays `security invoker`, and an invoker-mode read would only ever see the
  caller's own rows). `record_organization_email_domain` — a business naming its own sending
  domain beneath GOLD's one Resend account, staff verifying it afterward through the same generic
  resource-status door.
- `apps/web/lib/adapters/telephony/` — `registry.ts` gains `telephonyProviderKey()` and
  `TELEPHONY_RESOURCE_TYPES`, the one place this capability's vendor name and resource-type
  vocabulary live, and a `telephonyProvisioner()` capability (`createSubaccount`, `createApiKey`,
  `createTwimlApp`) beside the existing one. `telephonyProvider()` grows one argument,
  `actingAccountSid` — GOLD's master credentials address any subaccount by naming it in the
  request path, so no second credential is ever needed to place a call inside a business's own
  scope. `twilio.ts` implements both, still no SDK.
- `apps/web/lib/domain/providers/{bindings,twilio-provisioning}.ts` — the domain layer: typed
  reads and staff-write wrappers over the narrow functions above, and
  `provisionTelephonySubaccount`, the real lifecycle (subaccount, then key, then application),
  idempotent at every step and recording a failure as durable binding state rather than only a
  thrown error. `resourceType` is opaque `string` throughout, never a vendor-named union — an
  earlier draft typed it as one and `adapters.test.ts`'s vendor-name scan (I15) caught it, the
  same test catching a literal `'twilio'` inside the orchestration itself.
- `apps/web/app/(platform)/platform/organizations/[organizationId]/` — a "Providers" section:
  every binding and its resources for one business, a button to provision Twilio, a form to
  register an existing/moved number, a generic resource-status form for staff to verify a domain
  or mark anything failed. Nothing here can select a secret.
- `apps/web/app/organizations/[organizationId]/settings/connections/` — the tenant-safe
  Connections surface: phone (connected status, owned numbers, a link to where the outbound one is
  actually chosen — one configuration path, not two), email (domain status, a form to add one),
  AI & speech (which capabilities this deployment offers, informational only). No parent account,
  no secret, no wholesale rate, no cost, ever.
- `apps/web/tests/provider-bindings.test.ts` — cross-tenant isolation on both new tables; the
  narrow functions are the only write path, for both a tenant and staff; idempotency (retrying
  `begin`/`record` never duplicates a logical binding or resource); a failed provisioning attempt
  is durable state; a generated secret's storing function never returns it, and neither vault
  table is selectable by any role; a tenant cannot claim another organization's bound phone
  number, and an unbound one is unaffected; Twilio resolution addresses a bound subaccount's own
  scope rather than GOLD's master one.

Newly enforced: **I33, I34, I35** (see `docs/domain-model.md`). `constraints.md` gains **D44**;
its "Not built here" paragraph corrected — provider bindings were the item it named as absent.

### A provider bills GOLD in its own currency, not a tenant's, and a meter names no vendor

A narrow correction to the commercial control plane (D43), found before provider bindings —
three real bugs that would have surfaced the moment a second real provider or a real
reconciliation arrived, caught first instead.

- `supabase/migrations/20260911000001_a_meter_is_a_capability_a_provider_is_who_answered.sql` —
  `platform_providers`, a new vocabulary table. `platform_meters` drops its `provider` column
  entirely — `transcription_seconds` naming `deepgram` could not also let `elevenlabs` answer it.
  `platform_provider_rates` gains `provider_key`, keyed by `(provider, meter, currency,
  effective date)`; `app.provider_rate_at` now answers with the provider's own currency rather
  than being told one to look for. Also grants `platform_staff` the `select` on
  `platform_meters`/`platform_products` it should have had since `20260910000001` — nothing had
  ever exercised the staff console's own read of either table until this change's tests did.
- `supabase/migrations/20260911000002_a_provider_bills_gold_in_its_own_currency.sql` — **the
  bug.** `usage_events` held one `currency` column for both GOLD's cost and a tenant's charge,
  and `charge_for_call` looked up GOLD's wholesale rate using the *tenant's* currency — Twilio
  does not bill GOLD in whatever a Canadian customer trades in. Split into `provider_currency`
  and `customer_currency`; neither is ever converted into the other. Drops
  `provider_cost_status`, which implied a row could move from estimated to reconciled in place,
  contradicting "immutable" one line above it.
- `supabase/migrations/20260911000003_a_reconciliation_never_charges_twice.sql` —
  `usage_cost_reconciliations`, append-only, keyed to one usage event, carrying no quantity and
  no customer-charge column at all, so a correction can never duplicate either.
  `public.record_usage_reconciliation` is its one door — staff-checked today, the same shape
  every other commercial write function uses, until a provider-sync machine role exists to widen
  the grant onto it. `public.organization_usage_detail` keeps the original estimate visible next
  to whatever later corrected it.
- `supabase/migrations/20260911000004_margin_is_never_guessed_across_currencies.sql` —
  `organization_commercial_summary`, rewritten to use the latest reconciliation in place of the
  estimate it corrects (never the sum of both), grouped by both currencies, reporting
  `margin_minor` as null whenever they disagree and the cost is not exactly zero — the same rule
  `jobEconomics` already holds across a tenant's own currencies (I10), and the same open question
  D40 named the day it shipped voice ("the spread"), kept unsolved rather than solved quietly.
- `apps/web/lib/domain/commercial/{catalogue,usage}.ts` — `listProviders`,
  `recordProviderRate`/`recordRetailRate` split so only the provider one takes a `providerKey`,
  `organizationUsageDetail`, `recordUsageReconciliation`. The `/platform` console and its forms
  updated to match; the tenant-safe "Plan & usage" screen touches only its own renamed column.
- `apps/web/tests/{commercial-catalogue,commercial-usage}.test.ts` — two providers pricing one
  meter independently; a provider cost and a customer charge coexisting in two currencies on one
  fact, with no margin guessed across them; a reconciliation replacing the estimate for reporting
  without duplicating quantity or charge, and the estimate staying inspectable afterward; a
  tenant refused every one of the newly withheld columns and both new functions; cross-tenant
  isolation on the new reconciliation table.

Newly enforced: **I31, I32** (see `docs/domain-model.md`); I28–I30 revised to say precisely what
D41's entitlement build does and does not yet cover, and what D43's rate/ledger split actually
guarantees. `constraints.md` D43 rewritten in place to describe the corrected shape rather than
the superseded one.

### GOLD can now answer what it sells, what a business owes, and what serving it costs

Every table before this one answers a question about a *tenant's* business. Nothing answered
the question GOLD needs about itself — D41 (module entitlement) had been specified and left
"Decided, not yet built" for exactly this trigger. It is now built in full, generalized past
modules into a catalogue, two rate cards, a usage ledger, and a platform console reading all of
it, without touching D40's prepaid comms purse or blurring D42's two money paths.

- `supabase/migrations/20260910000001_gold_sells_gold_the_commercial_catalogue.sql` —
  `platform_meters` (eight named meters, vocabulary only) and `platform_products` (the base
  platform, one row per real module, a seat), both migration-written. `platform_provider_rates`
  and `platform_retail_rates`, append-only and effective-dated, in micro-minor-units (D43's
  amendment to I10's rate precision). `public.record_provider_rate` / `public.record_retail_rate`
  are the one door onto each, `SECURITY DEFINER`, checked against `platform_staff`
  (`app.require_platform_staff`) and granted `execute` to that role alone — the amendment D40's
  "written by migration and by nothing else" needed once platform-side money needed more than a
  migration, applied only to these two new tables.
- `supabase/migrations/20260910000002_a_module_is_wanted_and_a_term_is_paid.sql` — D41, built:
  `organization_commercial_terms` (the term, append-only, no write grant to anyone),
  `public.record_commercial_term` (the one door), `public.usable_modules` /
  `app.module_paid` / `public.module_commercial_state` (the wanted∩paid intersection, computed
  fresh). `app.grant_founding_terms` replaces `app.enable_default_modules`, per D41's own "a
  trial stops being a special case." Every business already using a module was backfilled a
  zero-price term for it, so nothing already working stopped working.
- `supabase/migrations/20260910000003_an_unpaid_module_goes_read_only.sql` —
  `app.check_module_entitlement`, the generic write-refusal trigger, attached to
  `payment_accounts` (`card_payments`) as the proven pilot. The other five optional modules'
  tables are a named gap, not a covered one.
- `supabase/migrations/20260910000004_a_call_knows_what_it_cost_gold.sql` — `usage_events`, the
  generalized ledger, tenant-owned, with GOLD's own cost withheld from `authenticated` by column
  grant. `app.charge_for_call` (D40) is replaced, never edited, to also record what a call cost
  GOLD alongside the retail debit it already wrote.
- `supabase/migrations/20260910000005_gold_reads_its_own_margin.sql` —
  `platform_provider_sync_failures` (ships empty, same shape `platform_failures` had between M5
  and M6), `public.organization_commercial_summary` (usage, cost, charge, margin — staff only),
  and platform-staff read access to D40's own tables, which had never been granted it.
- `apps/web/lib/domain/commercial/` — `catalogue.ts`, `terms.ts`, `usage.ts`. A new engine
  directory rather than `lib/domain/billing/`, because that one is a tenant's own price book and
  GOLD's subscription revenue must never be confused with it (D42).
- `apps/web/app/(platform)/platform/organizations/[organizationId]/` — the staff console's
  answer to all six questions for one business, with forms to record a rate or a term.
  `apps/web/app/organizations/[organizationId]/settings/plan/` — the tenant-safe projection:
  entitlement in plain language, what's been bought, usage and what GOLD charged for it, credit
  balance. Never a wholesale cost, never a margin.
- `apps/web/lib/domain/tenancy/modules.ts` — `listEnabledModules` stays the wanted axis;
  `listUsableModules` is the new wanted∩paid one, and every presentation call site (navigation,
  the operational screens that gate a section on a module) now calls it. `lifecycle.ts`'s
  readiness computation and `setModuleEnabled`'s own self-check stay on the wanted axis
  deliberately — entitlement is a rendering rule, not an operational-completeness one.
- `apps/web/tests/{commercial-catalogue,commercial-terms,commercial-usage}.test.ts`.

Newly enforced: **I28, I29, I30** (see `docs/domain-model.md`). `constraints.md` D43 records the
shape and the five deliberate amendments to D40/D41 this required; D41's "Decided, not yet
built" row is closed.

### A prospect can ask GOLD for a workflow review, and read nothing back

The homepage's primary CTA pointed at an in-page anchor with no submission mechanism behind it.
It now leads to `/workflow-review`, a public form that writes an ordinary customer into GOLD's
own tenant rather than a second CRM.

- `supabase/migrations/20260909000001_a_workflow_review_leaves_no_way_back_in.sql` —
  `platform_settings` (one row, RLS forced, no grant to any role) and
  `public.request_workflow_review`, a `SECURITY DEFINER` function that takes no organization id
  from its caller at all. `create_booking` accepts one because it re-checks it against the
  caller's own `external_actors` binding; this axis has no binding to check against, so the
  target is read from `platform_settings` instead, set once per deployment by
  `supabase/snippets/workflow-review-target.sql` (D42's reasoning applied a second time).
- `apps/web/lib/domain/workflow-review/workflow-review.ts` — anonymous sign-in (D22, I11),
  the one RPC call, then an unconditional sign-out. Booking keeps its session alive so a visitor
  can see their own booking; this deliberately does not, because there is nothing here for a
  visitor to read back.
- `apps/web/app/(marketing)/workflow-review/` — the route, in GOLD's own chrome. Filling it in
  creates no account, no membership, no organization. Success reads "Request received" rather
  than redirecting to `/sign-up`.
- Corrected the product-example sentence on the homepage. It previously read as a promise that a
  tenant could rename the platform's own screens ("the areas, the words... are this business's
  own"); the screens are fixed (D6) and only a tenant's own data — customers, jobs, work types
  and statuses — varies. Rewritten to say that.
- `apps/web/tests/{workflow-review,workflow-review-route,marketing-homepage}.test.ts`.

Newly enforced: **I26** (see `docs/domain-model.md`). `constraints.md` D22 carries the reasoning
for the second, narrower caller.

### The homepage sells the product these slices actually produced

Rebuilt for what GOLD now is, after four slices gave it a real lifecycle, a real cockpit, a real
Configuration Center and a real split between operating Work and defining it — not the platform's
internal naming for how it is built, and not the order this repository's own commercial reasoning
expects one customer to buy successive pieces.

- `apps/web/app/(marketing)/page.tsx`, `layout.tsx` — header nav, hero with a stated primary
  motion ("Request a workflow review", never presented as equal to self-service signup), the
  current-fragmentation problem, a product example grounded in the real shell (Today, Work,
  Schedule, Customers, Settings — not generic SaaS chrome), capability families, the real
  four-step implementation motion, an automation/AI progression that marks what is available
  today versus direction, and vendor trust kept visually subordinate.
- No fabricated customer counts, testimonials, guarantees, or contact destination that does not
  exist in this repository's configuration.
- `apps/web/tests/marketing-homepage.test.ts`.

### Guided Setup leaves the permanent sidebar

The last inconsistency from the Configuration Center slice: Guided Setup and Settings both sat in
the sidebar's Configuration group, though Business Setup is implementation infrastructure and not
a permanent tenant area. `navigation.ts`'s `sidebar?: boolean` (added below) now hides it while
LIVE without removing the `/setup` route, the elevated SETUP-state treatment, D32's proposal
history, or AI drafting access — none of which moves.

### Settings becomes the Configuration Center; Work becomes operational only

Operations and configuration were mixed on one screen — Work carried both today's jobs and the
type/status definitions behind them. Split, so that navigating today's work never routes an
operator through settings for it (D23).

- `apps/web/lib/navigation.ts` — `Area` gained `sidebar?: boolean` (route stays real and
  addressable, hidden from the sidebar) and `parent?: string` (drives a breadcrumb via
  `AreaTrail`), rather than a second label/route registry alongside `AREAS`.
- `apps/web/app/organizations/[organizationId]/settings/work/` — work types, statuses and
  transitions moved here from `Work`, which now shows only what is scheduled or waiting.
- Settings became a hub linking to ten configuration destinations, each carrying a
  "Settings → X" breadcrumb rather than a client-side tab framework.
- `apps/web/tests/settings-configuration-center.test.ts`, updates to `navigation.test.ts`.

### Today is an operational cockpit, not a static greeting

Widget composition is now lifecycle-aware rather than a fixed set: what a SETUP-state business
sees differs from a LIVE one, and every widget's eligibility comes from actual configured product
state rather than a role name or a row count.

- `apps/web/app/organizations/[organizationId]/today/page.tsx` — a Setup Readiness widget while
  in SETUP (wording sourced from `computeReadiness`, never a second opinion on the same facts); a
  Recent Activity widget while LIVE, reading the same `events` table `listCustomerTimeline`
  already reads, through a shared interpretive core rather than a duplicate one.
- `apps/web/lib/domain/timeline/timeline.ts` — `listRecentActivity` extracted alongside
  `listCustomerTimeline`, both built on one shared `describe()`/`Vocabulary`.
- Existing Committed/Waiting widgets kept their business logic unchanged; reused `WidgetGrid`
  unmodified.
- `apps/web/tests/today.test.ts`.

### A business starts in SETUP, and Launch is a decision — closed against a direct-RPC bypass

Every organization now begins in `operational_state = 'setup'`; readiness is computed, never
stored, from actual configured product state; Launch to `'live'` is something an operator decides
rather than something that happens on its own.

- `supabase/migrations/20260908000002_a_business_launches_when_someone_says_so.sql` —
  `operational_state`; `apps/web/lib/domain/tenancy/lifecycle.ts` — `computeReadiness`,
  `launchOrganization`.
- **The first version of Launch checked only `organization.manage`, never the blockers
  themselves** — anyone holding that capability could call `launch_organization` directly through
  PostgREST and skip `computeReadiness` entirely. Closed the same day, in
  `20260908000003_a_launch_cannot_bypass_its_own_blockers.sql`: `public.organization_launch_blockers`
  is now the one definition of what blocks SETUP → LIVE, called by `computeReadiness` for
  presentation and by a `before update of operational_state` trigger for enforcement — the same
  shape I13 already uses for a work item's status, one table over.
- `apps/web/tests/lifecycle.test.ts` — including a direct-RPC attempt against an organization
  with an open blocker, asserted refused regardless of capability.

Newly enforced: **I27** (see `docs/domain-model.md`).

### Sixteen areas in one flat list, and one divider

The sidebar was two groups — operational, then configuration — with sixteen entries between them
and nothing saying what any run of them had in common. Three labelled sections now, in
`AREA_GROUPS` order:

| Section | Holds |
|---|---|
| Operations | Today, Work, Schedule, Resources, Ask, Reports |
| Records | Customers, Calls, Locations, Assets |
| Configuration | Pricing, Automations, Custom fields, People and roles, Guided setup, Settings |

The grouping comes from `starting_conversation.txt`'s four layers, with **one deliberate
difference**. That document's third layer is *business modules*, and it cannot be a section here:
*module* is the billing axis (D25), and Reports, Assets, Automations and Reception are all
modules — so a section named for it would have to hold areas belonging to all three of the others.
Two axes crossed in one list is how a sidebar stops making sense. These three are named for what
an operator does.

Nothing was invented to fill them. That document also lists Teams, Notes, Activities,
Notifications, Tags, Time tracking, Expenses, Inventory, Routes, Dispatch, Approvals, Forms and an
audit log — none of which exists, and `navigation.test.ts` fails on an entry with no route behind
it. The sixteen areas that exist were regrouped; no seventeenth was added.

**Resources and Reports sit under Operations**, which was the owner's call on the two placements
that could have gone either way.

`navigation.test.ts` no longer compares two group names. It asserts each section is one unbroken
run and that the runs arrive in `AREA_GROUPS` order, with operations first and configuration last
— D23's rule read off a value rather than restated as a sentence. Verified by interleaving the
list and watching it fail.

A section whose every area belongs to a switched-off module renders as nothing at all, heading
included. Naming a part of the application that is not there for that business would be worse than
the gap.

### Logging in, and a way back from a forgotten password

The verb is *log in* now, and the route is `/login` — a URL is something people read, and leaving
`/sign-in` under a button saying *Log in* would have reproduced the inconsistency the rename was
for. *Sign out* became *Log out* to match; that pairing was not asked for and is the obvious
consequence of the one that was. *Sign up* stays as it is, since **Log in / Sign up** is an
ordinary pairing and nobody asked for that half.

**There was no way to recover an account.** Somebody who forgot their password had no route back
in at all, and the screen offered them a new account instead — the wrong answer to the question
they arrived with. *Forgotten your password?* now sits above *create one*, in that order and for
that reason.

Four screens where there were two:

- `/forgot-password` asks for an address and sends a link.
- `/auth/recover` is a route handler, because exchanging the code writes cookies and a Server
  Component cannot (`lib/db/server.ts` says so where it swallows that write).
- `/reset-password` sets the new one, and turns away a caller with no session — which is what
  arriving without following a link looks like.

**The recovery request reports success whatever happened.** `signInWithPassword` already refuses
to distinguish *no such account* from *wrong password*; a reset form is the easier place to lose
that, since there is no password to be wrong. One sentence for every address, saying what was
done rather than what was found.

**Nothing in the flow takes a destination from the request.** `proxy.ts` refuses a `?next=`
parameter on the grounds that a stored destination must be checked against a closed set at both
ends; that argument is stronger here, where the request arrives holding a credential. The callback
redirects to one literal, and it does so with a **relative** `Location`. Both `request.url` and
`request.nextUrl` were measured redirecting a request made to `127.0.0.1` off to `localhost` —
two origins as far as a cookie jar is concerned, so the session set by the exchange would not have
travelled, `/reset-password` would have found nothing, and the flow would have looped back to
asking for another link. A relative location needs no host at all.

### The front page and the credential screens are in the same building

There was no shared chrome anywhere: the marketing page was a bare centred column, and the auth
screens were a form in the middle of white with no wordmark and no way back. `SiteShell` is a
header and a footer, and both surfaces wear it.

**It is GOLD's chrome and belongs on GOLD's pages only.** On `/book/{slug}` or `/portal/{token}`
it would be our wordmark on somebody else's shop front — D20 keeps the platform out of a tenant's
frame entirely. `public-profile.test.ts` now fails the build on a `SiteShell` under `app/(public)/`,
which is the structural form of the sentence rule that suite already enforced.

The footer links to nothing that does not exist. A Privacy, Terms and About row would be three
dead ends, and this application has enough of those recorded already.

`CredentialsForm` grew a `fields` switch instead of splitting into four near-identical forms. What
must not drift between them is the part nobody looks at twice: the autocomplete hints a password
manager reads, the `role="alert"` on the error, and the disabled state while a submit is in flight.

### A business dials from its own number

Reception shipped complete from the carrier inwards — signed webhooks, a conference per call, legs
as rows, recordings — and with nothing in the product to point any of it at. `callingNumber()` read
`TELEPHONY_FROM_NUMBER`, one environment variable for a whole deployment, so every business on it
dialled from the same number or none did. A module with a switch and no route to its inputs is what
D31 exists to prevent, and what card payments did before it.

`telephony_settings` is one row per business holding one nullable number, and the Calls screen sets
it — where the module's `configuredAt` already pointed, first in *Set up*, because it is the one
thing there without which the module does nothing.

**An identifier, never a credential** (D39). The carrier account stays GOLD's, and what a business
stores grants nothing on its own. A form taking a carrier auth token is the shape D27 refused for
payments — a real secret needing rotation and revocation — and it is refused here for the same
reason. `.env.example` already promised this variable would "go away when the table arrives"; it
has, and the account itself is still per deployment.

**A table rather than a column on `organizations`.** A column would have meant re-granting that
table's whole update list, which is the promise-about-every-column mistake this repository has made
twice. And `organizations` is the kernel: a setting that exists only because a business switched a
module on does not belong on the row every business has.

**`organization.manage`, not `field.manage`.** 20260828000003 drew that line and it decides this —
naming a board column is configuring how a business records work, and the number its customers see
when it rings them is the business itself. It sits with currency and the clock.

**Two refusals where there was one.** *This deployment cannot place calls* and *this business has
no number yet* are different problems with different people to fix them, and `placeCall` now says
which.

`reception.test.ts` proves the parts a dialer gets wrong: another business can neither read the row
nor write it, clearing it is a real act that stops the dialer, and a role holding every reception
capability — `field.manage`, `call.place`, `customer.create` — is still refused by the database.
That last one signs the member in *after* the membership exists, because a session opened before it
would be refused for having no tenant at all, which is the wrong reason and would pass even with
the capability check deleted. What is deliberately not asserted is that `placeCall` refuses for the
business's reason: no carrier is configured in that environment, so it refuses one step earlier,
and a test that could not tell the two apart would pass whichever check was removed.

### Reception had no face, and the pipeline was a list of words

The module this platform sells a floor on rendered as one flat list of every call ever made,
followed by two lists of vocabulary. The pipeline existed only as those stage names — a business
could read what its stages were called and never see anybody standing in one.

Calls is a dashboard now (`ui-spec.md` §2b): what happened today, how calls went in the business's
own words, and who is where in the pipeline. Any tile opens to the whole thing.

**The pipeline is a board, and it is deliberately read-only.** `customer-forms.tsx` said this was
coming — the stage selector lives on the customer's own page because moving a relationship is
something somebody does while looking at the person, and *"a board is a way of reading the same
column and it can be built later"*. This is the reading. Dropping a card would be a write, the
write already has a home, and a second one here would be a second path to the same column. The
board scrolls sideways rather than wrapping, because columns that reflow stop reading as a
pipeline. *No stage* is a column only when somebody is in it — a business that has staged
everybody never sees it, because an empty column would read as a step in a process nobody named.

**No rate and no comparison.** *Reached* is a flag a business set on its own outcome, and what a
good day on a floor looks like is not something this platform knows — the same reasoning that
keeps a status neutral (§7).

The *Set up* section is unchanged and still sits at `id="setup"`, where the module's `configuredAt`
points and where `navigation.test.ts` reads for it — below the tiles now, because two lists of
words adjusted twice a year are not what somebody opens this screen for.

**Still missing, and named rather than left to be discovered:** there is nowhere in the product to
configure the telephone. `telephonyProvider()` reads five environment variables and
`callingNumber()` a sixth, so a business has no number of its own and the dialer is invisible to
it. D39 already decided the shape — a subaccount identifier stored against the business, never a
credential — and nothing stores one yet.

### An area can be a dashboard now, and Today is the first

`components/display/widget.tsx`: `WidgetGrid`, `Widget`, `WidgetPanel`. Tiles read at a glance,
any of which opens as the screen. `ui-spec.md` §2b is the specification.

**It is not the `dashboards` in `lib/domain/reporting/`, and the two must not converge.** That one
is a business's own arrangement of saved reports, and the platform still seeds none — including
the four names in `roadmap.md` — because which numbers a business watches is configuration. This
is how an *area* draws itself, which has always been the platform's. Nothing here writes a
`dashboards` row and no test below reads that table.

**The grid is flex and the rule is about the tile, not the viewport** — no narrower than 18rem,
otherwise share the row. Two fit side by side at 40rem and four at 80rem; one column on a phone
falls out of the same line rather than being declared as a third case.

**Opening a widget is a URL.** `?widget=<key>` on the area's own page, the shape the Reports screen
already used for `?dashboard=`. So it survives a reload, arrives with the back button, can be sent
to somebody, and reads its rows on the server under the caller's own RLS — none of which is true
of a panel a component remembers. It replaces the grid rather than covering it, so nothing traps
focus and the way out is the way back.

`dashboard.test.ts` holds that from both ends: `widget.tsx` never becomes a client component or
grows state, and a page linking to `?widget=` reads `searchParams`. A tile opening onto nothing is
`navigation.test.ts`'s dead entry wearing different clothes.

**`Stat` and `StatRow` are gone.** A number in a bordered box, and a row of them — `Widget` is the
same thing with somewhere to go, and Today was their only caller. Keeping both would have left two
boxes with a number in them and no rule for choosing between them. The one claim worth carrying
over now sits on `Widget.note`: no trend and no comparison, because the platform cannot tell
whether a number moving is good or bad for a business it knows nothing about.

**Today is rebuilt from them.** What it replaced was two counts at the top and two tables below,
the second cut off at ten rows with *N more in Work* underneath — the same idea without a way to
see the rest without leaving the screen. Each tile now previews four rows and opens to the whole
table.

### The shell never said where you were

There was no header. `AppShell` was a sidebar and a content column, and the only thing naming the
current screen was an `<h1>` at the top of that column, which scrolled away as soon as a list got
long. A job screen said the job's title and nothing about the area it belonged to or the way back
to it.

The shell now has a sticky header carrying three things: whose business this is (below `md`, where
the sidebar is not there to say so), where you are, and the two actions that belong to the shell
rather than to any screen. `ui-spec.md` §2a is the specification.

**The area's heading moved into it and is still one string.** `navigation.ts` supplies the
navigation entry and the `<h1>` both, exactly as before; `AreaTrail` renders it, and what changed
is only where. On a detail route — *in* an area but not *at* it — the header shows the way back
and the page keeps writing its own `<h1>`, because a job's title is a tenant's words.

**Switch business and Sign out came out of the sidebar.** They were two rows under sixteen areas,
which put *leave this business* in the same column as *go to Customers*. They are not navigation.

**The sidebar is gone below `md` entirely.** It used to render there too, stacking the business's
identity and those two actions above every screen while the same areas sat in the bar along the
bottom — two bands of chrome and the list twice before any content. The phone bar is `fixed` and
`display: none` on an ancestor takes a fixed descendant with it, so it is now a sibling of the
sidebar rather than a second `<nav>` inside it: `OrgNavBar` beside `OrgNav`, still mapping the one
`AREAS` list.

The content column widened from `max-w-3xl` to `max-w-5xl`, which is what side-by-side content
needs and what the next slice is for.

### Sections were the same size as sentences

`SectionHeading` was `text-sm font-medium` — body text, a shade heavier. So a screen read as one
large title over an undifferentiated wall, and nothing marked where a section started. Now 16px
semibold, against 24px for the page, 12px uppercase for a group and 14px body: four steps that can
actually be told apart. It is one line in `section.tsx` and it changes every screen in the
application.

### A page whose only purpose was one click

`/organizations` rendered a full screen to show most operators a list of length one and ask them
to click it. It now sends anyone with exactly one business straight in. `?all=1` keeps the list
reachable — it is what the header's *Switch business* link sends, and without it that link and
this redirect would bounce a single-business operator right back where they came from.

### Every page outside the shell was as wide as its longest line

`app/layout.tsx` lays `<body>` out as a flex column, so the sign-in screen can fill the viewport
and centre in it. Every page outside the operator shell is a direct child of that body, and each
centred itself the ordinary way — `mx-auto max-w-2xl`. In a flex container an automatic margin on
the cross axis absorbs the free space *instead of* stretching the item, so `align-self: stretch`
never applied and each `<main>` collapsed to the width of its own text. The `max-w-*` was never
reached, because the box never got near it.

Nine screens, and they were the wrong nine: the marketing page, sign in, sign up, the business
list, the platform console, `/book/{slug}` and `/portal/{token}` with both of their loading
states. Everything a stranger, a prospect or a tenant's own customer ever sees. On the business
list a heading and a *Sign out* button sat welded together in the middle of an empty page, because
`justify-between` had no width left to distribute. Only the screens inside `AppShell` were spared,
and only because its `<main>` sits in a grid cell rather than a flex one.

Each of those containers now declares `w-full` alongside its `mx-auto`, which is correct in a grid
cell and in an ordinary block too — so it is one rule for every surface rather than a rule about
which parent a page happens to have today. `AppShell` and the organization `not-found` carry it as
well, for that reason rather than because they were broken.

`layout.test.ts` is what holds it, and it reads the source rather than rendering anything. The
obvious test — mount the layout and measure it — cannot work: jsdom implements no layout at all,
computes no flex stretch and no used width, and would have reported the same class list either
way. Measuring this honestly needs a real browser, which this repository does not run. So the rule
is enforced one level up, the way `public-profile.test.ts` enforces a business's own words. It is
the first test here about how a screen draws, and the gate could not fail on one before it.

### Nothing streamed, and an unhandled error took the whole route

Every screen here is `force-dynamic` and awaits several reads under RLS before it can render
anything, and there was no `loading.tsx` or `error.tsx` anywhere in the application. So a person
moving between Work and Customers looked at the *previous* screen for the whole of that wait with
no sign anything was happening, and anything that threw took the entire page including the
navigation.

The shell survives. `loading.js` and `error.js` sit *inside* the layout above them, so the sidebar,
the business's name and its brand stay on screen and only the content column changes. The skeleton
draws bars rather than a silhouette of the page it stands in for: these screens are shaped by what
each tenant configured, and a business with three custom fields and one with none do not share an
outline.

`error.tsx` is for the unexpected half only — a refusal a person can act on is a `DomainError`
caught by the action that raised it and rendered beside the control that caused it. It shows
`error.digest` and not `error.message`, because Next forwards a generic message for anything thrown
in a Server Component *precisely so* server detail cannot reach a browser; the digest is the half
that matches the server log.

`not-found.tsx` is the one worth reading. `requireOrganization` calls `notFound()` for two reasons
it must not tell apart: the business does not exist, or it exists and the caller holds no
membership in it. RLS answers both with no row, and that identical answer **is** the security
property — a page saying *this exists but is not yours* would confirm a tenant's existence to an
outsider one URL at a time.

`global-error.tsx` replaces the document, so `globals.css` never loads and every class in
`components/` would do nothing. Its styles are inline and plain, and no tenant brand is applied:
the code that knows whose page this is, is the code that just failed.

**The prop is `retry`, not `reset`.** Next 16 renamed it, and `AGENTS.md`'s standing warning that
this version diverges from training data is why the bundled docs were read rather than it being
written from memory — `reset` would have typechecked as an unused prop and produced a dead button.

### The public copy guard covered two files somebody remembered

`public-profile.test.ts` reads public route source and fails on a sentence the platform puts in a
business's mouth — its own docblock says it is the test that "survives a careless author". It was
scanning a hardcoded list of two paths, so the customer portal renders the same header and was
never scanned at all, and the first `loading.tsx` added to the booking route would have fallen
outside it too.

It walks `app/(public)` now. Verified non-vacuous by planting *Welcome* in the portal and watching
it fail — in a file the old guard could not see — and it asserts it scanned something, because a
guard that reads nothing passes quietly.

### A row says what can be done to it, and a table stops being a table on a phone

The control set that landed with `ui-spec.md` fixed how a screen was *spelled* — one button, one
input, seven colour roles — and left untouched what the screens were actually made of. Every list
was a link with two lines of middle-dot-separated text under it, every create form rendered
permanently at the bottom of the screen it belonged to, and the two real tables were wrapped in
`overflow-x-auto`.

**What a row is for.** *Ana · Riverside · Van 2* asks a reader to work out which of those is the
customer and which is the van, and it is genuinely ambiguous when a customer is named after a
place. Every value now carries the word for what it is, and `actions` is a slot on `DataTable`
rather than a column — because the question a list answers is not *what are these* but *what do I
do about them*. Recording a meter reading is on the asset's row; setting coordinates is on the
location's; moving a job on is on the job.

**Below `md` a table is a list of cards.** A scrolling table on a phone puts the columns that
matter off the right-hand edge and asks somebody to drag a grid sideways to find out what a
number refers to. Each card is the primary column as a heading and every other column as a
labelled pair — including the `secondary` ones the wide table drops, so the phone shows *more*
about each row rather than less. Both renderings map one `columns` array, and one is in the
accessibility tree at a time, which is the precedent `OrgNav` set.

**Sizing is by available space rather than by breakpoint.** The work board and the schedule use
`repeat(auto-fill, minmax(…, 1fr))`, so a business with two vans gets two columns and one with
nine gets three, with nothing in the code deciding which.

**A create form is available, not permanent.** `Disclosure` is `<details>` and `<summary>` — the
browser opens it, closes it, focuses it and reaches it by keyboard, so there is no state, no focus
trap and no escape-key handler of ours. `OrgNav` refused a drawer on exactly that reasoning; the
element that does all four already ships. It opens by default only when the list behind it is
empty, because then the form *is* the screen.

The work board is the sharpest case: each job rendered two whole forms, so a status holding ten
jobs was forty controls and the jobs were whatever was left between them. Moving a job on stays
visible, since that is what happens most; scheduling is several fields done once, so it is behind
a disclosure.

**Two things this spec claimed that had quietly stopped being true**, fixed in the code rather
than softened in the document. §4 said no link in the application was styled as a button — the
schedule's day controls, the payment connect link and the booking slots each spelled one out, so
`ButtonLink` exists now, on an anchor, because *go somewhere* and *submit something* must not be
the same element. And §4 named the signup screen's hand-written focus ring as "a real gap" that
belonged in `inputs.tsx`; it is there, on `focus-visible`, so every control in the application has
it instead of four on one screen.

Also on the schedule: a booked window links to its job, which it never did — a dispatcher looking
at one was a step away from wanting it and had to go to Work and find it by name — and a day is
picked rather than clicked past one at a time.

**The public surfaces get the same treatment**, which matters more there than anywhere: the
booking page draws a card per service and its chosen slot takes the business's own colour, and the
portal's work list is a table that becomes cards on the phone most customers open it on.

### `components/` is a design system again, and `features/` grew by counting surfaces

Fourteen files sat flat in `components/`, and about half of them were not components in the sense
the other half were: `org-shell` is one surface's navigation, `credentials-form` is one route
group's form, `brand-style` renders a tenant's colour. A directory described as "shared controls"
held all three.

The sub-folders are `docs/ui-spec.md`'s own sections — `controls/`, `containers/`, `display/` —
so a file is under the heading somebody would have looked it up by, rather than under a taxonomy
invented for the directory.

**What moved out is the more useful half of the change, and each move was decided by counting
surfaces rather than by what a file sounds like.** `features/README.md` sets the bar at a *second*
surface, so `brand-style` (the operator shell, booking, the portal) and `locale-fields` (the
platform console, admin settings, pricing) qualified and went. `credentials-form` and `org-shell`
serve exactly one surface each and went the other way entirely — beside the routes that render
them, because a shared directory holding one surface's chrome means less than one that does not.

**`custom-fields/` is the case that tests the rule.** It knows exactly what a `FieldDefinition`
is, which makes it the most domain-shaped thing in the directory — and every caller is the admin
surface, so it stayed. Sounding like a feature is not the test.

That README also moved: it was titled `# features/` and living inside `public-profile/`, so it
described a directory from inside one of its inhabitants.

### Every list had a page size nobody chose, not just the console

The staff console's silent truncation turned out to be one instance of a class. `listCustomers`,
`listWorkItems`, `listLocations`, `listResources` and `listAssets` had no `limit()` at all — so
each was answered with PostgREST's first thousand rows and no indication that it was. A business
doing ten jobs a day crosses a thousand work items in about three months, at which point its board
quietly stops showing the oldest and nothing anywhere says so.

All five now take an explicit limit and return a `Counted` — an array carrying the number of rows
the query matches. `DataTable` reads it, so every table on the surface reports *Showing 500 of
1,432* without a single call site asking for it; the work board says it itself, because it draws
cards rather than a table.

**`Counted<T>` is `T[] & { total }` rather than `{ items, total }`, and the reasoning changed once
under contact with the tests.** The object shape is the conventional one and was the first draft;
what argued against it is that about forty callers are tests reading
`expect(await listWorkItems(…)).toEqual([])`. The first attempt used `Object.assign`, which made
`total` an ordinary property — and ten suites promptly failed with *expected `[ , total: +0 ]` to
deeply equal `[]`*, falsifying the argument as written. It is non-enumerable now, which is not a
way of quieting those tests but the accurate statement of what the value is: `toEqual` compares a
list's **contents**, and how many rows the database holds is not one of them.

The cost of that choice is that the rest of the suite cannot see the total at all, so it gets its
own file. `counted.test.ts` asserts the metadata survives, that it stays invisible to `toEqual` and
`JSON.stringify`, that `.map` and `.filter` drop it — correct, since a derived list has no honest
total — and that a real limited read reports three when it fetched two.

**It was called `ListPage` first**, which reads as a screen in a repository where every route file
is `page.tsx` — and the first person to meet it asked why a list needed its own page. Named for the
count it carries, it cannot be mistaken for a route.

**It does not paginate.** No cursor, no next page. What it buys is that a screen can say *showing
500 of 1,432* instead of showing a thousand and implying that is everything; the remedy for a
business that genuinely has more is a filter, and that is a feature with its own slice.

### The staff console had a page size nobody chose

`listTenants` read `platform_tenants` unbounded, and its own note said pagination would wait for
"the first time this screen is slow, which is a fact rather than a guess". The fact arrived in a
worse shape than the one predicted: PostgREST answers an unbounded select with its **first thousand
rows and no indication that it did**. So the console was never unpaginated — it had a page size
nobody chose, no way to reach the next page, and a silent cliff. Ordered newest-first, what it
dropped was the oldest tenants, which is the half of the list somebody chasing a lapsed business
would be looking for.

The limit is explicit now and the total comes back in the same round trip, so a partial list says it
is one. What this does not add is a filter or a next page — neither has a caller yet. What it buys
is that the console can now tell somebody they need one.

**Found by a test failing for the wrong reason.** `platform-staff.test.ts` asserted staff
visibility by reading every organization and looking for two ids in the result — so it silently
depended on the database holding fewer than a thousand of them, and on a machine that had run the
suite a few hundred times it failed with *staff cannot see this tenant*, which is the exact
opposite of what had happened. It names the two ids it means now. The claim is unchanged:
`organizations_select_staff` is `using (true)`, so what makes them visible is the role and not the
row, and a filter is applied after the policy rather than instead of it.

### A business looks like itself, and cannot make its own screens unreadable

D23 rejected a per-tenant theme by name and sent it to D20's marketing surface. Two of the three
things it said were right — the shape (colour, lettering, logo) and the insistence that a theme is
worthless until every control reads a role instead of a literal. The third was wrong: a per-tenant
*site* needs a paying tenant asking for one, while a business looking like itself on the screens it
already has needs no such evidence, and the cost of not having it was paid daily on a surface that
read as a specification rather than as a product.

`brand_settings` holds **one** colour, a lettering pair from a closed list and a logo. It renders by
overriding three CSS roles on the operator shell and both public surfaces. Not one control changed,
which is the ground already laid by `ui-spec.md` §3 being collected rather than a coincidence.

**One colour and not five.** The `mamouandco` table D23 records has five colour roles, and that
shape does not survive being handed to somebody who is not a designer: five colours is five ways to
put unreadable text on your own screens. `lib/domain/branding/palette.ts` derives the rest against
WCAG AA — a button's label is black or white by measurement, and the colour used as a *link* moves
in lightness, hue intact, until it reads on the page behind it. There is one such calculation and
there may not be a second, on I4 and I5's grounds. `branding.test.ts` asserts it over ten colours
including pure yellow, white, and the mid grey where black and white are equally bad, in both
schemes.

**What a tenant may not recolour is as decided as what it may.** The page, the rules, the hint text
and `danger` stay the platform's. A business overriding its own page background can make its own
text vanish, and a tenant recolouring what a refusal looks like is §7's mistake wearing a brand.

The `brand` bucket is the one public bucket in this database. *Never serve a private file from a
durable public URL* is a rule about files whose **existence** is confidential — every example it
gives is one — and a logo is the opposite kind of object. Who may **write** is unchanged, enforced
by the same tenant-id path prefix `documents` uses.

Drafting proposes a voice and a brand alongside the rest of a setup, and `configureBusiness` writes
them last — after everything gated by a different capability, so a member who may configure the
work but not rename the business gets the whole operational setup and is refused only at the end.
The drafting adapter is told not to write a claim the business did not make, and not to invent a
colour: a tagline you made up is on a page a customer reads, and a colour you made up is on every
screen they look at.

### Signing up asks two questions

The first screen somebody meets asked four things at once: a business name, their own name, an IANA
zone chosen from a list of every zone on earth, and a currency — the last two beside the first two
as though *what is your business called* and *what is your ISO 4217 code* were the same kind of
question. Two of the four are gone, by the oldest rule in form design: remove any field that can be
derived elsewhere or collected later.

**The zone is derived.** The browser knows it, and it is shown rather than hidden, because deriving
something silently and being wrong is worse than asking. One line with a Change link is not a
question — nobody has to answer it to get through.

**The currency is collected later**, on the pricing screen, in front of somebody already thinking
about prices. That needed `organizations.currency` to become nullable, and the previous shape is
worth naming: it was `not null default 'EUR'`, so a business that never reached the currency box
was silently recorded as trading in euro. `create_organization` raised on a null currency with the
reasoning that a platform default would be the platform deciding what a business trades in — which
was correct, and was being defeated one line below by a column default. The rule now travels with
the write it protects: `create_price_book_item` and `record_work_item_cost` refuse, in a sentence,
at the moment the answer is actually needed.

**Guided setup is on at founding**, and somebody who makes a business lands on it rather than on an
empty schedule — unless this deployment holds no drafting key, in which case that screen's only
content would be what it cannot do, and they land on the first operational area instead. The module whose entire job is standing a business up started off and sat last in
the configuration group, so the way to reach the thing that saves you filling in eight screens was
to go through the settings you were trying to avoid. `assistant` is deliberately not in that list:
drafting sends nothing anywhere until somebody types a description and presses a button, while the
assistant reads a business's rows out to a model to answer with.

### A rule armed before its fixture was built could move the fixture

`automations.test.ts` went red once in a full run and passed alone and on re-runs, which is the
shape of a race rather than a bug. *Records a failure when the slot it would move into is taken*
created its rule first and its two jobs second — and the test above it leaves a 4mm reading at the
same location, so that rule was **due the instant it existed**. `run_due_automations()` is global
and vitest runs files in parallel, so a tick from any other suite could fire it between the two
jobs being scheduled, shift the first an hour forward into the slot the second was about to take,
and fail the fixture with the double-booking message the test exists to produce later.

The rule is now written after the fixture. Nothing about what the test asserts changes: it is due
at the tick the test itself calls, which is where it was always meant to fire.

**Worth naming rather than only fixing**: a global tick and parallel test files means any suite
can fire any other suite's armed rules. Nothing else currently arms a rule and then builds around
it, and this is the reason not to.

### Committed time, and one predicate written a third time

What counts as a resource being busy is `work_items_resource_not_double_booked`'s partial
predicate, and it already lived in two places: the exclusion constraint, and `listSchedule`'s
filters. I5 is held up by `availability.test.ts` asserting those two agree in both directions
rather than by either having been deleted. `public.time_committed` is the third expression, and it
is admitted on exactly the terms D35 set for the second price calculation — `reporting.test.ts`
runs the same jobs through `listSchedule` and through the aggregate and fails on any disagreement,
including across a status change that frees a resource, so the correspondence is held through a
change rather than only at rest.

**The utilisation percentage is refused rather than deferred, and the distinction is the point.**
Its denominator is opening hours minus commitments, which is `freeWindows` — the one availability
calculation. A rule expressed twice and pinned by a test is safe; a second answer to *what is
free* is not, because that answer is the one somebody books against. A rule with two authorities
is not a rule. So the platform reports the time and a business dividing it by its own opening
hours is doing arithmetic this platform did not invent for it.

Two things tests found. Time is **clipped to the period**, because a job crossing a month boundary
belongs to both months in the proportion it held and counting it whole in each reports more time
than exists. And the correspondence test first compared a UTC day against the aggregate's
tenant-zoned one and passed by luck — a booking late in the UTC day fell outside the Manila one
and said so.

`formatMinutes` is the one place minutes become words, and gives hours and minutes rather than
decimal hours: *7h 30m* is what a timesheet reads like, and 7.5 invites being multiplied by a rate.

### A business says which status means finished, and two claims are withdrawn

**The corrections first, because a plan was built on them.** `roadmap.md` said work completed had
no date to count it into. It has one — `events.occurred_at` is not null and
`change_work_item_status` has written `work_item.status_changed` with both status ids since M2 —
and what was missing is which status a business calls finished, which is a question and not a
column. It also said M4's refusal of a platform-owned `is_terminal` was the blocker; it is the
**template**, and it is also why `releases_resource` cannot be borrowed: Cancelled frees the
resource and is not completed work, and one flag could not have said both. And it said one
completion column would unblock quoted revenue too, which rested on the first mistake —
`work_item.line_added` and `work_item.line_removed` both carry `occurred_at`, so that question
needs no new column at all.

**What shipped is the second measure, and the first that is not money** — which took
`requires: 'billing'` off the reporting module, its removal being the evidence promised when that
line was written. `work_item_statuses.marks_complete` is the tenant's answer;
`public.work_marked_complete` reads the event log against it.

It reads the log rather than the work item, so answering the question later counts history
correctly rather than only what happens next. It counts **jobs, not events**, so a job finished,
reopened and finished again in one period counts once and correcting a mistake does not look like
extra work. It has no service grouping, because a job is finished as a whole. And it says
**marked** complete: `occurred_at` holds when somebody moved the job, not when the work stopped.

`report_definitions.measure` arrives with it, and it is D36 predicting its own extension — the
fields stay fixed *per measure*, so a report gained one value from a closed list rather than a
query language. An unanswerable pair is refused when a report is **saved** rather than when
somebody clicks it.

### A dashboard shows each person what is theirs to read

A dashboard holds no audience and needs none: `dashboards_select` asks whether any pinned report
comes back, with `report_definitions_select` running inside the subquery under the caller's own
rights. A second role list would be a second thing to keep in step, and the day the two disagreed
the answer would be whichever policy ran last.

One dashboard, three people: its author sees every tile, somebody a single report is shared with
sees that tile and is told nothing about the others, and somebody none of it is for **does not see
the dashboard at all** — not empty, absent, name included. Nothing in application code decides any
of that, so a filter in a page must never be added beside it.

**The platform seeds no dashboard**, including the four `roadmap.md` names. That entry calls them
configuration rather than four screens, and shipping them as rows would be the hardcoding
`constraints.md` forbids arriving as a convenience.

**M7's criterion is met**, and `milestone-m7.test.ts` is what says so: a dive school in Cebu and a
joinery in Tallinn, a non-founder in each defining a report, pinning it and sharing it with a role
their business named — and then the reporting layer read as text, failing on any word either
tenant chose. The figures are secondary; a platform that shipped a report called *What the reef
brings in* would pass every other assertion in the file.

### A report is a row, its filters are columns, and its audience is a policy

A definition holds a grouping, a period and up to three filters, and there is no query language.
`starting_conversation.txt` §17 lists six things and four of them are already fixed for this
report set: the entity *is* the grouping, the fields are invoiced, incurred and margin, and the
calculation is the subtraction D35 owns. That is a claim about this report set rather than about
reporting, which is why D36 writes it down — the day a set arrives whose fields are not fixed is
when the argument for a builder has to be made rather than assumed.

**Filters are typed columns with composite keys, never JSON** (I18). One JSONB column would have
been a third of the work and would have accepted a customer belonging to another business,
producing an empty report nobody could explain instead of a refusal. A filter narrows *jobs*, so a
job's revenue and its costs are counted together or not at all.

Running a saved report calls the same aggregate the ad-hoc screen calls — D35's rule one level up,
and the thing this design is most likely to grow out of. The audience is
`report_definitions_select`, so a report shared with a role the caller does not hold returns no
row. `app.current_role_id` is `security definer` for the reason `app.current_tenant_ids` is.

**A delete that RLS filters to nothing is not an error**, found by a test: clearing an audience you
may not manage came back clean without changing anything. `setReportRoles` now compares what was
there with what went, which is the database's own answer rather than a capability read in
TypeScript.

### A total is a different disclosure from a row

`report.read`, and the record it has to reconcile with. `20260902000006` said there is no
capability for what the tools reach and that adding one would be a mistake, because a tool runs
`security invoker` under the caller's own token and returns rows their own screens already show
them. That reasoning is sound and its subject is **rows**.

An aggregate has none. *What this business billed each customer this year* is in no table and
cannot be assembled by reading rows one at a time — a member can open one invoice, and one invoice
is not the book. The line between the two records is whether the answer exists as a row anywhere.

The check is in the function because there is nothing to put a policy on: the invoices, their
lines and the costs must stay readable by every member, because a job screen shows all three.
`schema-conformance.test.ts` therefore reads function bodies as well as policy expressions when it
checks I16 — a clarification rather than a relaxation, since `add_member_by_email` has enforced
`role.manage` in a function since M1 because `auth.users` is not readable and no policy could have
said it. The search is narrowed to bodies that mention `has_capability`, and a negative control
asserts the check still fails for a capability nothing enforces.

Expect the first live tenant to meet the consequence: **a capability is never granted
retroactively.** Founding roles hold everything; a role somebody configured by hand sees the
Reports page explain itself until this is added on the Roles screen.

### The aggregate layer, and it refuses to say "revenue"

`public.invoiced_and_incurred` is one `stable`, `security invoker` function — D34's shape for a
tool, because a report *is* one the moment somebody asks the assistant for it — read by a new
Reports screen and by the loop in the same change. Two callers is what licenses it existing at
all.

**D35 records why this is not a second price calculation.** It is one rule expressed twice, which
I4 forbids unless the two are pinned together, so `reporting.test.ts` totals the same invoices
through `priceWorkItem` and through the aggregate and fails on any disagreement. That is I5's
mechanism rather than an exception to I4: the availability predicate has always lived in a
constraint *and* in a query, held honest by a test that they agree. When a minimum charge or a tax
lands in `priceWorkItem` that test fails, which is the event I4 was written to catch — repair it
by teaching the aggregate, never by relaxing the assertion.

**"Revenue" is four facts and only two are dated by a person.** Invoiced comes from
`invoices.issued_at` and incurred from `work_item_costs.incurred_at`. Received is named and
unbuilt. Quoted is named and needs a decision between two questions rather than a column. So a
business that prices here and invoices elsewhere sees an empty report, and the page says why —
which is the honest answer and may describe most of them.

A group is keyed by an entity **and** a currency, so a business that changed what it trades in
gets two rows for one customer rather than a figure in neither — the refusal `jobEconomics`
expresses as a null margin, expressed here as a table. Grouping by service returns no cost,
because a cost belongs to a job and a service is one line on it, which is also why the assistant
still refuses *least profitable service*. And the period is two dates the database zones itself:
`20260902000009` found a tool handing a model a UTC instant for a business in Cebu, and pushing
that conversion out to callers would put date arithmetic with daylight saving in it inside a
language model.

No total is stored and none may be. I4's own record names a stored subtotal as the thing that
becomes a second opinion, and a materialized view is that with a performance excuse.

### A cost and an invoice say when they happened, not when somebody typed them in

**An asymmetry closed rather than a feature added.** `record_payment` has taken a caller-supplied
`p_received_at` since invoices arrived and coalesces it to `now()`; its two hand-entered siblings
never got the argument. So a fuel receipt from last Thursday was stamped with the moment somebody
got round to entering it, and an invoice for work finished last month was dated today.

Both tables already knew these were two clocks — `work_item_costs` carries `incurred_at` *and*
`created_at`, `invoices` carries `issued_at` beside it — and only the platform's own one was ever
writable, which left the other a slower copy of it. `recordCost` now takes `incurredAt` and
`issueInvoice` takes `issuedAt`, both optional, both coalesced in the database so an unfilled
field means the instant the row was written rather than midnight of a day some process guessed
at from its own clock.

**The payment form was missing the input its action always read.** `recordPaymentAction` has
passed `receivedAt` through since M4 with nothing on screen to fill it, so every hand-entered
payment was stamped with the moment it was typed. All three date fields now exist.

Numbers still follow the order invoices were raised in rather than the dates on them, and a test
asserts it: a business that back-dates out of order gets a number that does not match its date,
which is theirs to notice, because numbering by date would mean renumbering documents already
sent.

**What this deliberately does not touch is `created_at` anywhere, and `events.occurred_at`.**
Those are this platform's own record of when a row appeared and when somebody acted. A caller
that can set them is a caller that can write a customer dated before the business existed and an
event log that is not a log. A business wanting to record when somebody *became* a customer has
custom fields for it, which is the answer that does not cost the trail its meaning.

### A scope is settled once per statement, not once per row

Twelve policies written for outsiders were charging operators for the privilege. A `stable`
function in a `using` clause *may* be called once per statement and is not obliged to be — only
`immutable` folds to a constant — so a bare `app.current_external_tenant()` was evaluated for
every row a statement touched, and each evaluation read `external_actors`. RLS ORs every
permissive policy on a table together, so an operator listing a thousand jobs paid a thousand
lookups to satisfy a policy that permits them nothing at all.

Wrapping each call in a scalar subquery makes it an InitPlan: computed once, before the scan.
**No policy changes what it permits**, which is the whole risk of the change, and `booking.test.ts`
and `portal.test.ts` are what say so.

`auth.uid()` was already wrapped everywhere, because Supabase's own advisor knows the `auth`
functions by name and cannot see a scope function this schema invented. So the rule is now
asserted by shape rather than by memory: `schema-conformance.test.ts` scans every policy in
`public` for an unwrapped session scope — including the two `app.` ones the advisor is blind to —
with a negative control that plants one and confirms the scan sees it. `app.has_capability` is
deliberately exempt: it takes the row's own column as an argument, so it cannot be lifted out of
a row, and asserting it would demand a fix that does not exist.

### Where your question goes, said on the screen that sends it

The assistant is the only feature in this platform that sends a business's rows anywhere, so it
is the only screen that has to say so. Two places, chosen because they are the two moments
somebody decides:

**At the switch.** The module's description on the settings screen now says that questions, and
the rows read to answer them, are sent to whichever model the installation uses.

**On the Ask screen**, as a small `?` that opens: which model replied is recorded on every answer;
a model on the installation's own hardware sends nothing outside it; and a **free tier is usually
free because the provider may keep what it receives and train on it**, which makes it right for
trying this out and wrong for a real customer's details.

A `<details>` rather than a hover tooltip. A tooltip is unreachable on a phone and invisible to a
keyboard, and this is exactly the sentence somebody needs on the device they are standing on a
site with. No JavaScript, so it works on a server-rendered page.

### A calendar tool, a suggestion judged before it is offered, and Gemini for free

**Half of what the weak model got wrong was an underbuilt foundation.** Reading the first
`llama3.1:8b` run as *this model is not good enough* was wrong about three of its four failures:
it invented an argument because the schema was not enforced, dated things 2024 because nothing
told it the date, and guessed at a time because **no tool could tell it what was already booked**.

**`public.schedule_ahead` is that missing tool** — what is in the diary over the next few days, in
the business's own hours. It returns rows and not availability, so it is not a second `freeWindows`
(I5): a model may propose a time that looks free and the exclusion constraint still decides (I6).

**A suggestion is judged when it is written, not when somebody presses it.** The whitelist's
validators are extracted and run twice, so one that could only ever fail is recorded as `failed`
with the reason beside it and never appears as a control. Finding the two missing column grants
took one attempt, because this table's insert grant is by column — the discipline working rather
than failing.

**Every test founded a business in UTC, which is why a whole class of defect was invisible.** Both
businesses in `ai-tools.test.ts` now think in a real zone — America/New_York and Asia/Tokyo — and
the rendered wall clock is asserted against the instant it came from.

**With all of it in place, a 9B model does the whole chain**: asked to move a job it calls
`work_at_risk`, takes the id from the result, and produces a suggestion somebody can press.
`llama3.1:8b` still cannot chain those two steps, and firmer wording only changed which wrong
thing it put where the id goes. That is a ceiling rather than a defect, and it is recorded rather
than hidden.

**Gemini needs no new code.** Its OpenAI-compatible endpoint is three settings on the existing
chat-completions provider, which is the point of naming an adapter for the dialect rather than for
a vendor.

### Four things a real model found, and a local one is now the cheapest way to run this

Driven end to end against Ollama — `qwen3.5:9b` and `llama3.1:8b` — which is the same path a
business that will not let its rows leave the building uses in production.

**A tool handed a model an instant, and a model is what renders it.** `work_at_risk` returned
`timestamptz`, PostgREST serialised UTC, and the answer read an hour wrong for Amsterdam and nine
for Cebu. Every test passed, because every test founds a business in UTC. The instant stays and
the business's own wall clock is rendered beside it in Postgres — not by giving a model a zone
name and letting it do date arithmetic with daylight saving in it.

**A model has no clock.** Asked to move a job to *9am tomorrow*, one answered with a date in 2024.
Today's date in the business's zone now travels beside the question, after the cached prompt
prefix rather than inside it.

**The schema is the contract.** A weaker model invented a `status` argument on a tool that
declares no properties, and PostgREST answered *could not find the function*. Undeclared
arguments are dropped now, which turned a hard failure into a correct answer for that model.

**A default model name is a trap.** `ASSISTANT_MODEL` defaulted to `llama3.1`, which Ollama
resolves to `llama3.1:latest` — a tag a machine holding `llama3.1:8b` does not have. Both
settings are required together.

**And what a weak model does is a product answer rather than a bug.** One proposed moving a job it
never looked up, naming it *"ID of the Fenwick Road excavator hire job in the system"*. Nothing
happened, because a write is a proposal; the person is told the suggestion does not name a real
job; and `answered_by` records which model said it.

### Both questions M8 names, one shared definition, and the gate grew a second half

**The second tool.** `public.customers_not_contacted` answers the other question in M8's
criterion. Thirty days is its caller's argument rather than the platform's opinion, and what
"contacted" means is *nothing recorded about them* — from the same events the customer's own
screen shows, so an operator can always click through and see why a name came back.

**It moved a definition rather than copying one.** Which events are about a customer is not
obvious: almost everything a business remembers happened to a *job*, and one action names the
customer only in its payload. That rule lived inside `listCustomerTimeline`; a second caller
means extracting it, so `customer_activity` is a `security_invoker` view both read. The
timeline's action list deliberately stayed behind — which events are *about* a customer and
which are worth showing are two questions, and only the first was duplicated.

**Nothing told the model which business it was answering for.** The first tool schemas required
`organization_id` from a model that had never been given one, so a real call would invent a uuid,
match nothing, and report success with an empty answer — every layer working, the whole feature
useless. Found by driving the path end to end rather than by reading it. The loop fills it in
from the request now; it appears in no schema and no prompt, and an id a model supplies anyway is
dropped rather than merged past, because two differently-named keys in the record read as though
two businesses had been named.

**`pnpm check` is the gate now, and it runs both runtimes.** `apps/api` had tests from M4 that
nothing ran, which was tolerable while that runtime was two handlers deciding nothing and stopped
being so when the tool loop moved in. The root script runs pnpm recursively and then pytest
directly, because `apps/api` is deliberately not a workspace member (D3).

**Retrieval is recorded as decided and not built, with the real reason.** Not "no evidence yet":
this database holds almost no prose. Every free-text column is a line long and `documents` stores
no extracted text at all, so embeddings would be worse than `ilike`. The trigger is a corpus, and
only document text extraction or M9's transcripts create one.

### Asking the system questions: M8's first criterion, and it did not wait for M7

An operator asks in plain words on `/organizations/{id}/ask` and gets an answer built by tools
running **under their own access token**. `constraints.md` D34 holds the decisions.

**A tool is a `stable`, `security invoker` function in Postgres**, not a query in the other
runtime. `public.work_at_risk` is the first: work whose booked window has passed while its status
still holds the resource, and work booked for today with nobody assigned. Every threshold in it
belongs to the tenant — `releases_resource` is the only judgement it uses, so there is no platform
opinion about lateness and no working day hiding in a definition of risk.

**I14 stops being a promise and becomes a property.** Postgres refuses an `insert`, `update` or
`delete` inside a non-volatile function, so a tool cannot write. The refusal arrives at
*execution* rather than at `create function` — checked against a live probe rather than assumed —
which is why `ai-tools.test.ts` reads `provolatile` for every name in the registry: a tool
declared `volatile` would have been allowed to.

**The argument is not what narrows.** A model chooses a tool's arguments, so if
`p_organization_id` were the boundary, the boundary would be a value the model made up. RLS
decides and the caller's own JWT is what RLS reads: one business's id handed to another
business's session returns nothing.

**A tool's joins are part of what it discloses**, and this was found by testing rather than
reasoned out. A portal customer may read their own work items but has never been able to read the
business's internal board vocabulary — so this tool, which joins `work_item_statuses`, answers
them nothing at all rather than a narrowed list. Each joined table's own policies apply, so a tool
answers *less*, never wrongly.

**This axis has no Postgres role.** `payment_webhook` and `automation_runner` each hold one
because no person is present; here one always is, so `apps/api` forwards the token and mints
nothing — asserted from its own source.

**`agent_runs` records what was asked and what was said, never what was read.** Each tool call is
a name, its arguments and a row count. It is **readable only by the person who asked**, which is
this schema's one departure from *a member sees their business's rows*: an answer holds whatever
its asker could see, and a tenant-wide history would be a way to read yesterday's answer to a
question today's policies refuse.

**The loop is provider-blind and ships with two implementations.** `app/ai/loop.py` owns
iteration, dispatch, the cap and the record; a provider answers *what is the next turn*. Claude is
the default, and anything speaking chat completions is the other — which is how a business answers
with a model on its own hardware, and the answer to the fact that a tool result is the first thing
this platform sends outside that is a business's own rows rather than its own words. No vendor's
tool-runner is used: it would have meant a second loop and an `agent_runs` row that meant two
things.

**No aggregate-shaped tool exists, and that is the decision rather than a gap.** Revenue by
customer and least profitable service wait for M7; until then the assistant says it cannot answer.
`roadmap.md`'s *Order of work* said this whole criterion waited for M7 and has been corrected: the
dependency was always the report-shaped half, and a tool that cannot contain a calculation is what
keeps the distinction from rotting.

**The loop still writes nothing, and a person can.** An answer may carry one intended action —
today only *move this job* — recorded on the run as pending and performed by nobody until somebody
presses the button. `apps/web` holds the whitelist that says what an action name means, so the two
runtimes may disagree and the disagreement fails closed; an action carries no Postgres function,
so nothing in the Python plane could perform one; executing adds no capability, because the policy
on `work_items` refuses exactly as it would for a drag on the schedule and the exclusion
constraint decides whether the window lands; and a decided action is frozen in the policy rather
than only in the flow.

**Rescheduling cannot reassign, and a test is why.** The first executor omitted the resource, and
`scheduleWorkItem` reads an omitted resource as *nobody assigned* — so moving a job quietly took
the person off it. It now reads the job's current resource and passes it back, and the model is
given no way to name one: *move this to tomorrow* and *give this to somebody else* are two
decisions.

### Founding closes: every business exists because GOLD made it exist

The other half of D29, and the half M5's criterion turns on. `create_organization` now holds
**no grant at all** — not for `authenticated`, not for `anon`, and not for platform staff
either. A business begins one way: somebody at GOLD provisions it.

**It closes in the database, not on a screen.** The form came off `/organizations` too, but that
is cosmetic; the enforcement is the revoked grant, because a missing button is not a boundary
(I12) and a direct PostgREST call would have founded a tenant regardless.

**`/sign-up` stays open, and D29's own consequence line was wrong to say otherwise.** Building
the operator door showed why: provisioning names an owner who must already have an `auth.users`
row, and creating one needs the admin API `apps/web` may not hold (D14). Close registration and
provisioning has nobody to hand a business to. **An account is not a tenant** — the same
precondition `addMember` has always stated out loud. Recorded as an amendment rather than
quietly reinterpreted.

**The function is not dropped**, because it carries 20260830000001's guard against an anonymous
session founding a business — found the expensive way, and worth more than the tidiness of
deleting an ungranted function. It is the self-serve door with no key cut; M8 cuts the key. Since
that guard is now unreachable from any session, `provisioning.test.ts` asserts the same rule at
the door that *is* open while `tenancy.test.ts` asserts the outer refusal. Neither alone is the
guarantee.

### Creating a business and configuring one came apart, because the schema refused otherwise

`configureBusiness` used to create the organization it configured. The first version after
founding closed simply pointed that call at the operator door — and it fails at the *second*
step: `createRole` and everything after it run against policies keyed to
`app.current_tenant_ids()`, and platform staff are a member of nothing. **I21 refusing exactly
what it says it refuses.**

So `configureBusiness(db, organizationId, shape)`: GOLD creates the business, and whoever does
the configuring configures it. `BusinessShape` loses `name`, `timezone`, `currency` and
`founderDisplayName` — those are settled when the business is created — and keeps everything
that is a fact about its *shape*.

**This is worth recording as confirmation rather than as cost.** "What separates the two doors
is who does the configuring" was D29's argument in prose; it is now the signature of the
function, and it got there because the database would not accept anything else. A separation
that could only have drifted is instead one that cannot compile.

### Every test fixture provisions

Twenty-nine test files founded their tenants by calling `create_organization` as an ordinary
signed-in user, each with its own copy of the same five lines. They now go through
`tests/helpers/founding.ts`.

That duplication was not worth fixing while it was accurate. It became worth fixing the moment
it stopped being: **a founding path only the tests could reach would be the second creation path
D29 forbids**, and the suite would have been proving the platform worked in a way the platform
no longer does. Four suites needed more than a fixture swap, and each is a small record of what
closed — the colliding-names test that proves I2, the two that assert a refused currency and an
impossible timezone (now asked of the open door), and the anonymous-session guard.

`milestone-m5.test.ts` gained the assertion the milestone actually needed: the owner of a real
business, holding every capability their business has, still cannot found a second one.


### The operator door: GOLD provisions a business and stays out of it

D29's operator door, and **D28's trigger to revisit firing for the first time**. That record
granted platform staff `select` and nothing else, and said the first thing staff must *write*
would be a new decision. Provisioning is it.

**What it granted is narrower than the trigger anticipated.** Not a write grant on
`organizations` and `memberships` — the obvious reading, and indistinguishable at the privilege
level from letting staff rename a live business and add themselves to it — but one `execute` on
`provision_organization`, no table privilege, on the `create_booking` shape (D22). The role still
holds no `insert`, `update` or `delete` on any table.

**I21 gained a clause, because the line moved and pretending it had not would have been the
worse outcome.** Staff may now bring a tenant into existence, and may still write nothing
belonging to a tenant that already exists — which holds for a structural reason rather than a
careful one: no function on this axis takes an organization id, so there is no existing business
a staff path could name. `provisioning.test.ts` provisions a business and then fails to rename it
or join it, in one test, because either half alone proves nothing.

**GOLD stays out of what it hands over.** The founding membership is the owner's, and
`created_by` on the organization, its role and its membership is the owner too — the tenant's own
rows carry no GOLD user id anywhere, which is the whole of D28's objection to solving this with a
membership. The event is the deliberate exception: `actor_id` is the staff member, because they
are who acted, and the readable half is snapshotted into the payload as a name.

**Both doors write `organization.created` and only the payload differs** — D29's correction as a
row. A test builds one business through each door and compares what came out, because "two doors
onto one creation path" is a claim that decays quietly: one door gains a default, and a year
later a provisioned business is a subtly different product.

**Two defects found by writing the tests, both in what this branch had already shipped.**
`getOrganization` and `listMyOrganizations` embed `roles`, which platform staff hold no `select`
on — so both threw `permission denied` for a staff caller rather than answering. Since
`requireOrganization` turns only *null* into `notFound()`, a staff member who typed a tenant URL
got a **500 where this branch's changelog claimed a 404**. Both now read insufficient_privilege
as "you are a member of nothing", narrowly — that one SQLSTATE and no other, because swallowing
errors here would hide the class of bug RLS exists to make loud.

### M5 has a milestone test

`milestone-m5.test.ts`, in the shape the other four established. **It inverts all of them at
once**: every previous milestone was proved by a caller inside a business, and this one runs
entirely as a caller inside none — no membership, no role, no capability obtainable — who must
nevertheless see everything and change nothing.

It holds a connection string for exactly one statement, adding the `platform_staff` row, because
that is genuinely how a colleague is added (D28 grants no application path). Everything after
runs on a signed-in session through the anon key, since a milestone about *not* using a
service-role client cannot be proved with one. Two businesses that share no word, currency or
zone, one founded by its owner and one provisioned by GOLD; the positive and the negative
asserted about the same rows in the same test, so they cannot drift apart.


### D29 named the wrong axis, and the documents now say what was actually decided

The record was titled *a tenant is provisioned, not self-served*, and the M5 criterion said a
business becomes a tenant "not because a stranger found a signup form". Both read as a position
against self-serve. D29's own body says the opposite — both paths call one `createOrganization`
and there must never be a second — so the title contradicted the record underneath it, which is
the failure mode `constraints.md` is most exposed to: a heading that gets quoted while the
reasoning under it goes unread.

**Provisioned and self-served are not two kinds of tenant.** They are two doors onto one
creation path, and what separates them is who does the configuring — a fact about the far side
of the door rather than about the tenant. The rule that governs both, identically: a door may be
open where somebody is doing the configuring, and stays shut where nobody is, because a new
organization here is genuinely empty and handing the emptiness to somebody with nothing to fill
it is not a product. Today the somebody behind the operator door is a person. M8's onboarding
flow is the somebody behind the self-serve door, and it makes that door the *better*-configured
of the two rather than the emptier one.

What M5 closes is the **unattended** door — `/sign-up` as it stands, where a stranger founds an
organization and no implementer, proposal or review is on the other side. That is not a position
on self-serve, and the corrected record says so.

D29 rewritten, the M5 criterion and its onboarding bullet rewritten, and the marketing page's
comment corrected — it had inherited the old framing verbatim.

### The M5 record: an invariant, a deferral, and a collision that is two records working

Three documents were behind the code.

**I21 exists.** *A platform-staff path may read across every tenant and write nothing that
belongs to one* — the invariant D28 said would land with the slice, enforced since the slice
landed and recorded nowhere. Its `Enforced by` cell names both halves, because only one of them
is a policy: no write policy names the role, *and* the role holds no write grant on any table,
so a permissive policy added later still hits a missing privilege.

**"What is failing" is deferred to M6, on the record.** The console answers three of M5's four
questions. It does not answer the fourth because nothing in this schema records a failure — a
`DomainError` is raised, rendered and dropped — and a failed-thing table here would be a table
with no writer. M6's automation is the first thing that can fail with nobody watching. The row
lands with the writer.

**Operator provisioning is a staff write, which is exactly D28's trigger to revisit.** That is
the two records working rather than disagreeing: D28 declined to grant a write before there was
one to name, and D29 names it. `roadmap.md` M5 now carries the shape question the slice has to
answer first — a narrow write grant, or one `SECURITY DEFINER` function on the `create_booking`
precedent.

`walkthrough.md` gains the console: how to become staff, and the step that catches people —
the role is a claim on a token minted at sign-in, so somebody promoted while signed in stays
`authenticated` until their next one. It also records that `add-platform-staff.sql` is **not** a
fourth entry in *what you cannot reach from any screen*. That table is a debt list; this snippet
is a decision, because a screen for it is a staff write D28 has not granted.


### Staff land on the console, and the front door stops pointing into the shell

Two routing facts that were left over from when `/organizations` was the only place to go.

**A staff member signed in and landed on "You do not belong to an organization yet."** True —
they are members of nothing, which is the axis working — and useless. `/organizations` now
sends them to `/platform`. It cannot loop with the redirect the other way, because both ask
`isPlatformStaff` and one answer cannot satisfy both conditions. This is convenience of the
same kind `proxy.ts` is: delete it and a staff member sees an accurate empty list rather than
anything they should not.

Worth recording that the boundary was checked rather than assumed, because staff now hold
`select` on `organizations` and `memberships` with `using (true)`: both `listMyOrganizations`
and `getOrganization` filter on the caller's own `user_id`, so staff get an empty list and a
`notFound()` on any tenant route. They cannot wander into a business's shell.

**GOLD's front door said "Organizations" and linked into the operator surface**, which it had
done since M1 when that was the only other route. It now says what the platform does today and
offers a sign-in. Deliberately absent: anything about automations, connectors or AI — the
runtime is M6 and the AI layer is M8, and a front door advertising either would be selling
what this repository cannot do. Deliberately absent too: prices, for the reason D8 keeps them
out of `docs/`. A number on a public page is a promise and the first three sales calls will
move it; the tier *layering* is architecture and is safe to state.

### The tenant list, and the console it is the whole of

`/platform` renders one row per business: who exists, when they arrived, what they have
switched on, when they last did anything. Those four are M5's own words and they are the
entire scope — the difference between this and the aggregate layer M7 owns is one `count(*)`
wide, and what separates them is that this answers *does this tenant exist and is it alive*
while nothing here answers *how is this tenant doing*.

It reads `platform_tenants`, a view built `security_invoker`. That flag is the whole safety
argument: a view defaults to running as its owner, which would make it a service-role client
with extra steps — the thing D14 refuses and D28 refuses again. Running as the caller means
every policy on `organizations`, `organization_modules` and `events` still applies underneath
it. Two boundaries, and the test asserts both separately: the grant, which refuses a member
outright, and the flag, read from `pg_class.reloptions` because nothing about the grant would
reveal if somebody dropped it and dropping it is one word.

**Each business is rendered in its own zone and its own currency, and nothing is totalled.** A
console showing every tenant in one timezone would be deciding what Tuesday means for somebody
in Tokyo (I9); one summing two currencies would be inventing a rate (I10).

`(platform)` is a route group and so a layout boundary, never a security one — the same as
`(auth)` and `(public)`. The staff check on the page is courtesy, exactly as `proxy.ts` is:
delete it and a member sees an empty list, which is ugly and still correct.

### Platform staff are a Postgres role

D28's axis, built. `platform_staff` is a Postgres role declared the way `payment_webhook`
already is, holding `select` on the four tables a console reads and no `insert`, `update` or
`delete` grant on any table at all. A user listed in the new `platform_staff` table arrives in
that role through Supabase's custom access token hook, which rewrites the token's `role` claim
— so identity still reaches Postgres as the caller's own JWT and D17 is applied rather than
bypassed.

**The invariant is enforced twice and the second half is the one that matters.** No write
policy names the role, and the role holds no write privilege — so a permissive policy added
later still hits `permission denied`. The test asserts the message rather than merely a
failure, because the difference between "a policy declined" and "there is no privilege" is the
entire guarantee.

Two consequences worth stating rather than discovering. The hook runs for **every** token this
project issues, so the no-op path is tested explicitly: an ordinary member must still come back
as `authenticated`, and a regression there would break every suite in the directory. And the
claim replaces `authenticated` outright, so one human who both runs GOLD and operates a tenant
needs two sign-ins — which is D28 working as intended, since our people are not in a customer's
own list of who works there.

Nothing writes `platform_staff` through the application; `infra/supabase/snippets/` holds the
statement. A screen for it is a *staff write*, which is D28's own trigger to revisit and is not
spent here.

### Standing a business up is a domain function

`milestone-m3.test.ts` made its point with a local `configure` helper: one function, a fixed
sequence of domain calls, every word and number taken as data, called twice over an equipment
hire yard in Amsterdam and a clinic in Tokyo. The claim held and then sat in a test, where
nothing but a test could call it.

It is now `configureBusiness` in `lib/domain/onboarding/configure.ts`, moved under this
repository's own rule — *if a second caller needs a rule that is currently inline, extract it
first, then call it twice*. The second caller is the AI onboarding flow M8 describes and D29
makes self-serve signup conditional on: describe a business in prose, receive a proposed
configuration, review it, apply it. `BusinessShape` is what that proposal *is*, which is why it
is a type rather than an argument list — a proposal has to survive being generated, rendered,
edited by a human and only then applied.

**The milestone assertion got stronger rather than being relocated.** It reads
`configureBusiness.toString()` now, and fails if any tenant's name, type, status, role, price
or field key appears in it — real code rather than a test helper, so it is a claim about the
platform instead of a claim about one file.

Two things it deliberately does not do. It creates no customer and no job: the test's version
did, so it had something to assert against, and that was evidence rather than configuration — a
business that has just been stood up has neither, and inventing one is the platform speaking
for it. And it is **not atomic**; each call is a transaction and the sequence is not, so a
failure part-way leaves a partly-configured business. Nothing is lost and nothing is corrupt,
because that is also the state of a business somebody is configuring by hand. Atomicity means
one privileged function taking the shape as JSON, which puts the order of these steps in the
database, and no caller has needed it.

M3's own field-order assertion now claims only that each business got the order it declared.
The stronger claim — that `position` is assigned explicitly rather than falling out of creation
order — was always duplicated in `field-forms.test.ts` "renders in the order the tenant chose,
not the order they were defined", which proves it against a form rearranged after the fact.
This is the version M3 can honestly make.

### An anonymous session may not create an organization

**The booking slice's bill, arriving a milestone late.** Enabling anonymous sign-in (D22,
`20260829000003`) was the right answer and remains one: an outsider reaching `/book/{slug}`
gets a genuine `auth.uid()`, which is what left I11 and D17 untouched. What it also did, with
nothing recording it, is enlarge who the word `authenticated` refers to — a Supabase anonymous
user carries `role: authenticated` in its JWT exactly as a registered one does — and every
grant already written against that role widened with it.

For all but one function that was harmless. Everything else granted to `authenticated` takes an
organization id and dies on `app.has_capability`, or reads through a policy keyed to
`app.current_tenant_ids()`, which is empty for somebody who is a member of nothing.
`create_organization` is the exception because it is the only function in this schema that
**bootstraps from nothing**: no organization id, no capability, and a gate that was entirely
`auth.uid() is not null`. So the sequence was: call the anonymous sign-in endpoint, receive a
session, create a tenant — no email, no password, no confirmation.

**It was not a leak and RLS held throughout** — such a caller founds their own empty
organization and could read no existing tenant. What it produced is rows this platform did not
agree to hold, which is D29's objection to open signup arriving through a door D29 was not
looking at: that record closes `/sign-up`, and closing `/sign-up` would not have closed this.

The guard reads `auth.users.is_anonymous` rather than the JWT's claim, because Supabase can
convert an anonymous user to a permanent one and the column flips where an already-minted token
does not. `tenancy.test.ts` asserts the caller holds a real uid *before* asserting the refusal,
and matches the message rather than merely a non-null error — without both it would pass for
the same reason the unauthenticated case beside it does, and keep passing if the guard were
deleted.

**Whether a *registered* stranger may create a tenant is untouched here.** That is a product
decision, it belongs to D29, and it is one line in `PUBLIC_PATHS`.

### `apps/web/src/` is gone

`app/`, `components/`, `features/`, `lib/`, `proxy.ts` and `tests/` sit directly under
`apps/web`, which is the layout `docs/starting_conversation.txt` draws and the one this
repository described everywhere except in the tree. Next supports both and `create-next-app`
scaffolded the other; nothing ever decided it. A `src/` that contains everything except
`tests/` distinguishes nothing, and `apps/web` was already the boundary it was nesting inside.

`@/*` now resolves to `apps/web/*` in **two** files that must agree — `tsconfig.json` and
`vitest.config.mts` — and the handful of places that named a path as a string rather than
importing it moved with the tree: `navigation.test.ts` scanning the route directory,
`schema-conformance.test.ts` reading the generated types, `public-profile.test.ts` scanning the
public routes' source, and `db:types` in the root `package.json`. One `src/` reference in
`constraints.md` D16 is deliberately untouched — it quotes `tire-app-template`'s own test
imports, and that is a different repository's layout.

### The kernel is not a module, and the platform side becomes M5

**Module enablement shipped in M4 unable to change anything, and the cause was one word.**
`MODULES` listed `work`, `scheduling`, `customers` and `billing` marked `required: true`. Every
area in `AREAS` belonged to one of those four, so the filter `areasIn` applies could never
remove an entry — the switch existed, was tested, and moved nothing an operator could see. A
required module is a contradiction in terms: a module is by definition the part a business
*chooses*, so the phrase is only ever the kernel misfiled. `constraints.md` D25 gains the third
word it was missing — it had separated *module* from *engine* and left open what a module is
separate **from**, and the answer is the kernel, which is neither.

What a business always has is now simply not in the list. What remains is what a business can
genuinely decline: `billing`, `assets`, `booking`, `portal`, `card_payments`. `Area.module` is
optional and absent means kernel; `setModuleEnabled` has no refusal left to make; a founding
business starts on billing alone, and `assets` is backfilled for every existing organization
because taking a live tenant's screen away would be this migration deciding something about
them. **Switching billing off takes Pricing out of the navigation *and* the quote, invoice and
margin off every job screen** — hiding the area alone would be half a switch, which is the
failure the booking module already shipped once.

**The test that should have caught it did not, and the reason generalises.** Every assertion in
`navigation.test.ts` checked that `MODULES` and `AREAS` agreed with each other, and two lists
agree perfectly when the filter between them is dead. It now fails if no area belongs to an
optional module — a claim about the feature doing something rather than about the lists
matching.

**Route groups, and a word D20 had been using for two surfaces.** `apps/web/app` now
separates `(marketing)` — GOLD's own site, GOLD's voice — from `(public)`, which is a tenant's
own customers and is what `public-profile.test.ts` scans. D20 defers marketing because *every
word on a public page a business shows the world is a claim that business makes about itself*,
which is true of a tenant's site and was never true of ours; `app/page.tsx` had been rendering
GOLD's own words since M1 with nobody calling it marketing, so the only available reading of
that record was that the page in front of you was forbidden. The per-tenant marketing surface
stays deferred with its trigger intact. `(auth)` is the one group that earned a layout — both
credential pages carried an identical centred `<main>`. `organizations/` is deliberately
ungrouped, because `navigation.test.ts` scans that directory and a group folder would hide its
children.

**M5 through M9 shift up one, and the platform side takes M5.** Everything built so far was
built for a tenant; the people who run GOLD have no surface and watch their own tenants in the
database vendor's dashboard. **D28** decides that the staff axis is a Postgres role —
`platform_staff` alongside `payment_webhook` — rejecting a service-role client (D14 already
refuses it, and one mistake would expose every tenant) and rejecting a membership in every
tenant (which writes our employees into each customer's own list of who works there). It also
settles the word D20 asked someone to settle: *admin* is taken, so this is *platform*.
**D29** decides that a tenant is provisioned rather than self-served: `/sign-up` being open was
never a decision, only what the first identity slice left in `PUBLIC_PATHS`. Guided self-serve
is not the alternative — it is M8's onboarding criterion, calling the same
`createOrganization`, and it is blocked until something can fill the emptiness a new business
starts with, because that emptiness is deliberate.

### M4 — vertical one: a real business runs on the platform

**M4 is met.** `milestone-m4.test.ts` runs one business end to end — a stranger with no account
finds it by the name it chose, reads what it offers, takes a slot, and the operator schedules
that job, works it along the lifecycle the business configured, quotes it, invoices it and takes
cash — while asserting at every step, including the ones where they successfully wrote, that
`app.current_tenant_ids()` is empty for that stranger. That is the milestone's inversion: M1 ran
byte-identical input across two tenants, M2 ran identical input twice, M3 ran maximally
different input through identical code, and all three ran as members. Half of this one is
somebody who is a member of nothing. It touches no SQL, because "nobody has ever been given
database credentials" is a claim about the path.

**`apps/api` exists, and Stripe is what brought it forward.** D2 gives webhook ingress to
Python and the roadmap put `apps/api/` at M6; both could not hold. D26 settles it in favour of
D2 and the layout: a Next route would have put a second thing called *api* inside the app that
is not the API. What landed is one endpoint, no scheduler and no `domains/`. The two Stripe
touchpoints split along D2's own line — creating a checkout session is a transactional flow and
stays in TypeScript, being *called* by Stripe is ingress and is Python — and only one side
verifies, so there is one HMAC in the repository rather than two.

**The writer with no human caller gets a role, not a key.** `payment_webhook` holds no grant on
any table and exactly one `execute`; `record_provider_payment` derives the organization, the
invoice and the currency from a `payment_requests` row this platform wrote first, so the caller
names a provider, a reference and an amount and nothing that decides where money lands. Stripe
may not tell this system which invoice to settle. **I11 kept one shape**: the integration is a
real `auth.users` row with no email and no password, which was one insert against a nullable
actor for machines.

**I15 is enforced, and the test's second assertion is the one that matters.** An import
boundary was the obvious half; the half that caught a real break is that no domain file may
name a provider *at all*, because the first draft derived a provider name from whether a
reference started with `cs_`. It also forced `registry.ts` out of the contract file, since
choosing an implementation is the one operation that must name implementations.

**Module enablement, arriving late from M3.** `organization_modules` is what a business has
switched on — a row, never a directory (D25). Off is an absent row rather than a false flag, so
there is no third state; switching a module off removes its area from the navigation and
removes nothing it produced. **It is not authorization**: no RLS policy consults it, and a
member who lacks a capability still sees the screen and is told why (I12), whereas a module the
business never bought is not part of that business. A founding business gets the operational
core and nothing that publishes anything — booking, the portal and card payments start off,
because publishing a page to the internet is not a default anybody should acquire by signing up.

**A tenant connects its own processor; GOLD holds neither its keys nor its money.** D27. The
obvious reading of "per-tenant payment configuration" is a settings form taking a secret key,
and it is the expensive one — it obliges this platform to encrypt, rotate and eventually leak
somebody else's live credentials. Instead a business authorizes GOLD from its own Stripe
account and what gets stored is an `acct_` id, which grants nothing on its own and which the
business can revoke without telling us. Charges are created **on** that account, so funds never
enter a balance of ours: Connect is not the same as a marketplace, and the charge type is what
decides whether a platform needs a money-transmitter licence. `account` is a required field on
`PaymentRequest` precisely so the other shape cannot be reached by forgetting an argument.

**Two holes the tests found rather than the design.** The connect callback had no CSRF state —
anyone who could get an operator to open it with a code of their choosing would have pointed
that business's card payments at their own bank; it now carries a single-use httpOnly nonce
naming the organization. And **a refused RLS `delete` returns success, not an error**: a role
without `organization.manage` was being told an account was disconnected, and a module switched
off, while both sat unchanged. Both now read back the deleted rows and tell "you may not" from
"there was nothing to remove". A write that silently does not happen is worse than one that is
refused loudly.

**A module that switches nothing off is worse than no module, and the first version of this
shipped three of them.** `booking`, `portal` and `card_payments` declared a surface they
controlled and controlled nothing — a business could turn public booking off, believe its page
was down, and find out otherwise from a customer. Enforcement is in the database, not the page:
`app.module_enabled` is the single answer, `booking_organization` stops resolving a slug,
`create_booking` re-checks rather than trusting how the visitor arrived, and a portal link goes
dead with the same message a never-valid one gets. Card payments is checked in the domain layer,
because its caller is a member and can read the table. `modules.test.ts` asserts each switch
removes its surface, that switching back on destroys nothing, and — the case that would catch
modules and capabilities merging — that a role without `organization.manage` loses the switch
and keeps its work.

**Reading `events` found a third missing action.** `work_item.booked` was written by the
booking slice and was not in the timeline's allowlist, so a job a customer booked themselves was
invisible on that customer's own history. That is now three times the same hazard has surfaced —
a polymorphic append-only table whose readers arrive after its writers — and it will recur
every time a slice writes a new action.


**Invoicing, and money arriving — three columns that are not there carry the design.** An
invoice has no `total_minor`: its total is `priceWorkItem` over its own snapshotted lines, and
`InvoiceLine` is a `PricedLine` with a position rather than a parallel shape, so the second
document to carry a total did not get a second calculation (I4). It has no `status` and no
`paid` flag: settlement is `invoiceStanding`, arithmetic over payments, which cannot disagree
with the payments it was derived from — the argument `domain-model.md` already makes for
refusing a `calendar` table. And a payment has no `method`: "cash" is what *no provider* means,
so the operator path takes no provider argument at all and a payment that names a processor can
only have been written by one.

**An invoice line copies a priced line, which copies a catalogue row, and there is no key back
to either.** That is I8 one level up from where it already applied. The test that matters
strikes every line off the quote *after* the invoice is issued and reads the invoice unchanged:
the quote stays editable, which is the whole point of copying rather than pointing.

**Two capabilities rather than one**, because they are plausibly two people — deciding a job is
finished and asking to be paid for it is whoever runs the work; writing down that money arrived
is whoever opens the post. A second invoice for one job is refused by a unique index rather
than by a check before the insert, and so is a duplicated number: I6's argument about checking
before writing, applied to a sequence instead of a slot. `events` gained two readers' worth of
actions — `invoice.issued` snapshots the number and `payment.recorded` the amount and currency,
because both are terms somebody agreed to rather than vocabulary a tenant can rename.


**The customer portal, and D22's prediction holding.** That record said whichever surface went
first would pay for the model and the other two would inherit it. Booking paid; the portal added
exactly **one column** — `external_actors.customer_id`, the gap D22 named in advance — and
changed nothing else about the axis. It is written by one privileged function on presentation of
a token and by nothing else: no column grant, no update policy, so the attack that removed that
column from the first draft is still impossible.

**The two surfaces scope differently and that is why the column was needed.** Booking scopes an
outsider to rows *they made*; a customer of ten years made nothing, because the business did. So
every external policy now reads "rows I made, or rows about me", with
`app.current_external_customer()` as the companion to `app.current_external_tenant()` — same
shape, neither returning a set.

**I19's second shape landed**, exactly as D20 predicted: a customer reading their own document
through a permission check with no capability to call. The read under the external policy *is*
the check.

The link is the credential and the page says so. Anyone holding it is that customer — the model
of a link to a shared document, revocable by the business — because proving control of an email
address needs a channel, and channels are M6's. The token is stored rather than hashed on
purpose: a business that lost the link it sent must be able to send the same one again.

**Booking, and the external actor it paid for.** D22 stated four questions and settled none,
on the grounds that whichever surface went first would pay. Booking went first. An outsider is
a row binding one `auth.users` id — from anonymous sign-in, so `auth.uid()` is real and I11
needed no second shape — to exactly one organization, through a scope function that returns at
most one uuid and is deliberately not `app.current_tenant_ids()`. What makes "never a set"
structural is a unique index on `user_id` alone: I2 inverted on purpose, because the risk here
is one actor spanning two tenants rather than one tenant blocking another. The conformance test
names it as its single exception.

**Two things went differently from the plan, and both made the result better.** The binding was
to carry a `customer_id`; writing it meant granting an outsider `update` on their own binding,
and an outsider who can write a customer id onto their binding can write somebody else's — the
composite foreign key does not object, because another customer of the same tenant satisfies it.
`created_by` scopes an outsider to their own rows instead, and the binding is now immutable. And
the write side was to be four RLS permit policies; a returning customer broke that, because
`customers_org_email_unique` refuses a second row for one address and a read policy narrow enough
to be safe cannot see the customer already there. One `SECURITY DEFINER` function with the scope
check as its first act replaced them, and the surface got smaller: an external actor now holds no
insert permission on any table.

**A business's own words on its public page, because booking broke a Never.** The booking
surface shipped saying "Book a time" and "This business is not taking bookings online at the
moment" — the platform speaking in a tenant's voice, on a URL that business puts on the side of
a van. `constraints.md` forbids exactly that, and D20 defers the *marketing* surface for exactly
that reason while permitting booking, which is a public page. The two were always one problem
and the second arrived first; D20 is amended to say so.

What landed is one row of tenant copy — display name, tagline, intro, contact, address —
rendered at the top of any public surface. **Not** the marketing surface: no pages, no blocks,
no editor, and no colour, because D23 rejects a per-tenant theme by name and copy is what the
Never is about. A business that has configured nothing renders its own name and stops, which is
the same reading of silence that operating hours and the buffer take. The assertion that
matters reads the public routes' own source and fails on a hardcoded sentence, so the rule
survives a careless author.

It is also the first inhabitant of `apps/web/features/` — UI that two *surfaces* need, admin
editing what booking renders. Route-owned components stay beside their route; a feature moves
when it has a second surface, which is the bar `constraints.md` sets for extracting a function,
applied to a directory.

**A public URL carries a name, not a tenant id.** The surface first shipped at
`/book/{organizationId}`, which published an internal identifier and — worse — let a path
segment decide which tenant an anonymous visitor bound to. D17 forbids exactly that;
`/organizations/[organizationId]` gets away with it because RLS re-derives membership whatever
the URL claims, and out here there is nothing to re-derive against. A business now chooses a
slug, resolved server-side by a function that answers only for a business publishing something
bookable — which also makes the public directory opt-in, where before anyone holding a uuid
could bind themselves to any organization.

**Nothing on that page carries a second opinion.** Slots come from `freeWindows` over the same
operating hours the operator's schedule subtracts, and the price is the catalogue row copied by
`add_work_item_priced_line` — which is exactly what D20 said booking was blocked on. Availability
is published through a view that says which resource is occupied and when, and nothing else: a
resource can be a person, and who is free on Tuesday is not a fact a booking page needs to
publish. I6 stopped being an internal claim — a test reads a slot as a member of the public, lets
somebody else take it, and commits against the stale answer.

**A buffer between jobs, and it is the tenant's.** `constraints.md` lists **buffers** in the
never-hardcode set beside statuses, prices, hours and currency, and this is that taken
literally: the platform holds no gap between jobs and invents none, zero is what a business
that has said nothing means, and why a business wants one — driving to the next address,
cleaning the room, inspecting the machine — is deliberately not modelled, because naming the
column for any one reason would put one business's operations in every business's schema.

**It is enforced, not displayed**, and that decided the shape. Padding only the availability
calculation would leave `freeWindows` refusing a slot the database happily accepts — I5 broken
in the direction nobody notices, and the constraint no longer the re-assertion I6 depends on.
So a job now carries two ranges: `scheduled_during`, the appointment the customer was told, and
`occupies`, which is that plus the buffer and is what the exclusion constraint compares. At a
zero buffer the two are identical, so a business that has configured nothing sees byte-identical
behaviour. Changing the buffer recomputes work already scheduled, and widening it far enough to
overlap two committed jobs is refused — the database declining to hold a schedule the resource
cannot actually work.

**The customer timeline: `events` gets its first reader.** The table shipped in M1 because it
cannot be backfilled, and thirty-odd writers have been filling it since with nothing looking.
Reading found two things. Payloads are thin about vocabulary and thick about snapshots, and
that split is already right — a status name is a row the tenant owns and is resolved at render
(D6), while an amount or a title is a term somebody agreed to and is snapshotted (I8); so a
business that renames a board column sees the new word in last month's history, because the job
moved into a *row*. And `location.linked` names the **location**, carrying the customer in its
payload, which was reasonable when written and invisible to a reader filtering on `entity_id`.
That is a standing hazard of an append-only table with a polymorphic subject rather than a bug
fixed once: the row records which entity the writer thought it was about, and the reader that
arrives two milestones later may be standing on the other side of it.

**Today, and the phone rendering D23 asked for.** The area an operator opens the application
for, answering *what do I do next* — one chronological list merged across every resource, which
is a different question from the schedule's per-resource grid. It computes nothing: every window
comes from `listSchedule`, because a second notion of "today's work" is exactly the second
answer I5 forbids. The navigation bar is now fixed to the bottom on a phone and a column from
`md`, and `AREAS` carries a `group` so that D23's separation of operational from configuration
is asserted rather than merely typed in the right order.

**Job economics.** Revenue minus cost per job, the number the owner asks for first. `totalCost`
is new and is the only place costs are added, for the reason I4 gives about prices — a total
looks like formatting until something conditions it. Margin comes back `null` rather than zero
when nothing is priced, and `null` rather than converted when the currencies disagree: a rate
has a date, and a date makes this accounting software. A business that changes what it trades in
reaches that case for real.

**Editing a work item, and cancellation that actually frees the van.**

`work_item.update` is a third lane in the per-column split `app.check_work_item_update_capability`
already ran: the policy is the coarse gate, the trigger is the refinement, and a caller holding
only this may correct a title, a customer, a location, an asset and the custom fields — and may
not touch the status, the resource, the window, or the type. `type_id` is outside every grant
because changing it strands the status the job sits in, and I20's three-column reference is what
would refuse it; better no path than one that fails halfway with a foreign key error nobody can
read.

**A referential action is not an edit.** Three of those columns sit behind `on delete set null`,
so deleting a customer nulls the reference on every job pointing at it — an UPDATE that reaches
the trigger looking exactly like somebody editing a job. Without a guard, deleting a customer
would have demanded `work_item.update` from whoever did it, which is authorization for one
entity leaking onto another. `resource_id` had the same hole before this change and nothing had
exercised it.

**`roadmap.md` said cancelling needed no new code, and that was wrong.** The claim was about D6
and it was right about D6; what it missed is that `work_items_resource_not_double_booked` was
partial on `resource_id is not null and scheduled_during is not null` and knew nothing about
status. A tenant could configure "Cancelled", move a job into it, and the van stayed booked
forever — and the workaround was worse than the gap, because unschedule-then-transition is two
capabilities, so a dispatcher who could cancel but not schedule left the slot held with nothing
reporting it.

The fix is one question the tenant answers about their own word — `releases_resource` — and
deliberately not `is_terminal`, which the original migration refused for the right reason: that
flag is the platform deciding what a status *means*, while this asks only whether the van is
still occupied. It reaches the constraint through a mirrored column, because an exclusion
predicate must be IMMUTABLE and cannot join, and **that mirror is a cache rather than a
snapshot** — the one place configuration is meant to reach work already committed, because a
tenant marking "Cancelled" as releasing means it about the jobs already in it. I8 now records
where it stops, so nobody enforces it here and silently unfixes cancellation.

I5 and I7 moved together, which is the property that keeps I5 honest: `listSchedule`'s filters
are the constraint's partial predicate written as a query. One test reads a window as free and
then commits against it, which is both halves of that agreement in one assertion.

**`docs/walkthrough.md`, and the three capabilities it found with no operator path.** Writing
down how to reach each milestone's claim with a mouse is what surfaced them: `setTypeBookable`,
`revokePortalInvite` and `assignRole` are tested, work, and are reachable from no screen. The
first is the one that bites — a business cannot publish itself to the booking page without
somebody opening the database, against a criterion that says nobody has to. Recorded in
`roadmap.md` M4 as a debt rather than closed quietly, with
`infra/supabase/snippets/publish-bookable-type.sql` making the flow walkable locally and saying
in its own header that it is evidence of the gap and not a fix for it. The same pass found that
module enablement cannot currently change the navigation, because every area belongs to a
required module — the mechanism is right and the case the milestone gave as its caller is not
yet expressible.


### M3 — the configuration engine

`milestone-m3.test.ts` stands up two whole businesses that share no word, number, status,
field, currency or timezone — an equipment hire yard in Amsterdam trading in euro, a clinic in
Tokyo trading in yen — through **one** `configure` function containing no branch on which of
them it is holding. That structure is the milestone rather than the assertions inside it: if
either shape had needed a special case, the function could not exist, and its existence is
what "configure a second business shape without a pull request" means. It inverts its
predecessors deliberately — M1 ran byte-identical input, M2 ran identical input twice, M3 runs
maximally different input through identical code.

**I4 is enforced.** `priceWorkItem` is the only place an amount is derived. What keeps it
single is that a priced line *copies* its catalogue row rather than joining to it, and
`work_item_priced_lines` holds no foreign key to `price_book_items` at all — asserted from
`pg_constraint`, because a copy that is merely not currently joined becomes a join the first
time a key makes one look safe. Re-pricing the catalogue changes what the next job is quoted
and nothing about a job that exists (I8). A job is never quoted in two currencies: after a
business changes what it trades in, its catalogue holds both — amounts are never converted —
and a gist exclusion using `currency with <>` refuses the mix in the database rather than in a
check before the insert that would race identically (I6).

A price is not a cost, and they are now two tables. Quantity is an integer and nothing rounds,
which is a constraint on the product rather than a simplification: a business billing
half-hours prices per half-hour, and when a fractional quantity earns its way in, how a
half-cent rounds is a pricing decision belonging in that same one function.

**The field registry became a form.** Fields carry a position and can be relabelled and
required, so the shape of every form is configuration rather than an artefact of the order
somebody defined things in. `kind` and `key` are refused to everyone by a column grant:
changing a kind reinterprets every value already stored under that key and renaming a key
orphans them, and neither fails at the moment of the edit — both surface later as
`check_custom_fields` refusing an unrelated write to a row that was valid when it was made.

**The operator shell landed**, with persistent navigation, a decided responsive breakpoint and
no drawer. Every platform noun now lives in one file, serving as both the navigation entry and
the page heading, so no page under `[organizationId]` carries a heading of its own. A test
asserts that registry is complete in both directions — an entry with no route, and a route
with no entry. The eleven-fold copy of the route guard preamble is extracted and cached, and
still runs in every page rather than only the layout: Next reuses a layout across client-side
navigations without re-rendering it, so a page leaning on its parent for authorization would
be trusting a cache.

**Terminology was two mechanisms and `roadmap.md` was wrong about it.** Names a tenant authors
shipped in M1 and M2; overriding the platform's own nouns is unbuilt and stays deferred until
a second vertical makes its shape knowable. **Module enablement, dashboard configuration and
business rules were removed from M3's coverage** — there are no modules to enable, no
dashboard, and nothing that triggers anything. Each would have been built against a
hypothesis. A pricing rule *engine* was scoped and deliberately not built for the same reason:
neither business shape needed one.


### Two basics on the way in, and M3 takes the interface

Sign-up asks for the password twice, and the rule that they must match lives in
`domain/identity` rather than the form, because `credentials-form.tsx` renders whatever the
domain returned and composes no sentence of its own. It guards a typo in the one credential
nobody can recover for you.

Founding a business now asks **where it is** with a real timezone picker and **what it trades
in** with a real currency list, both from ICU at runtime rather than a table in this
repository — a currency list checked in here would be a second, staler answer to something the
platform already has a source for. Neither is derived from the other: a Dutch company
invoicing in dollars is ordinary, so a country-to-currency guess would be the platform
deciding what a business trades in. The currency still has no preselection when founding, for
the same reason it never had a default. The settings screen reuses the identical two controls,
so there is one answer to "how does a business say where it is" rather than a picker in one
place and a text box in the other.

**M3 now owns the interface**, and `roadmap.md` says so: an operator shell, real
responsiveness, and shared form components. Deferred there rather than done now because M3
rebuilds these screens anyway — custom forms and pricing both change what is on them — and
styling them twice is the waste.
`my-builder/my-app/frontend/components/layout/org-sidebar.tsx` is recorded as the reference
shape. Its sibling `admin-sidebar.tsx` is a *platform staff* console spanning tenants, and
that is now in `constraints.md` under "Decided, not yet built" as an authorization decision
before it is a screen: staff are in no tenant, `app.current_tenant_ids()` answers accordingly,
and D14 rejects service-role outright.

### Opening hours, checklist templates, and the edit paths

The four things M2 had left, and the one instruction attached to them: no hardcoded business
hours or days.

**Operating hours are entirely the tenant's, and no part of the platform holds a week.**
There is no Monday-to-Friday, no weekend, no seeded rows and no default set. A day is a
number 1–7 because the calendar has seven days and repeats — the only thing assumed, and a
property every one of these businesses already shares. The platform holds no *word* for any
day in any language either: the settings screen asks `Intl` for the reader's own names.

- A business that has configured nothing is treated as **always open**, and the asymmetry
  with I13 is deliberate. An empty transition set genuinely asserts that no move is legal, so
  reading it permissively would void the invariant silently. An empty hours set asserts
  nothing, and reading it as *closed* would invent a claim the business never made.
  `operating-hours.test.ts` "seeds no hours at all for a new business" is the assertion that
  keeps that honest — if anything ever starts creating a default week, it fails first and by
  name.
- **The one bare `time` column in the schema, and it belongs there.** "Time is `timestamptz`"
  governs instants; "we open at nine" is a recurring local reading with no answer to *which*
  nine. Stored as an instant it would drift an hour twice a year — the bug that rule exists
  to prevent, arrived at from the other direction. `zonedTimeToInstant` resolves it against
  the tenant's zone, and a `pg_attribute` assertion pins `time` to that one table.
- A split day is two rows, and a shift past midnight is two rows on two days — which is what
  they are, rather than one row with a wraparound rule every reader must know.
- Availability changed range, not shape: `freeWindows` is still the single calculation (I5),
  now asked about open periods instead of whole days.

**Checklist templates are a copy, and that is I8.** `20260827000010_checklists.sql` deferred
these and named the question it could not answer without guessing — what happens to work
already created when a template changes. The answer is nothing. `create_work_item` copies the
template onto the job in the same transaction, with no foreign key back, so editing a
template never rewrites what a technician already agreed to do and removing a step never
unticks one they already did. Both are asserted against a job created before the change,
because a copy that is only *described* as a copy is a join waiting to be written by somebody
optimising a query.

**Three edit paths that shipped write-once now exist**, and two of them are safe only because
of decisions taken earlier:

- An organization's name, timezone and currency, behind a new `organization.manage`
  capability — deliberately not `field.manage`, because naming a board column is configuring
  how a business records work and changing the currency it trades in is changing the
  business.
- Changing the currency does not reinterpret history: every amount carries the currency it
  was recorded in. Changing the timezone does not move a booking: every window is an absolute
  instant. Both asserted.
- Renaming a status moves no work, because a job references its status by id — which is the
  whole argument for D6, and now has a test rather than only a claim. A status's `type_id`
  stays outside the column grant: moving one would strand every work item in it, and a path
  that fails halfway with a foreign key error is worse than no path.

**I8 is enforced**, and `roadmap.md` moved it out of M3 with I10. Pricing does not add the
invariant; it inherits it.

The two long-standing lint warnings are gone — an unused import in two test files.

Gate green: 259 tests, against a database rebuilt from scratch.

### M2 — the work engine, demonstrated

`roadmap.md` describes M2 as one demonstration: *an operator can define a work item type, its
statuses, and its allowed transitions from the admin UI without opening the database — and a
work item moves through that lifecycle, consuming a resource for a window that nothing else
can double-book.* `apps/web/tests/milestone-m2.test.ts` is that demonstration.

- **Nothing in it touches SQL.** Every call is a domain function — the same one the server
  action behind the screen calls — and the only privileged client mints the two accounts.
  "Without opening the database" is a claim about the path, so the path is what is exercised.
  Where raw statements appear in the other M2 files they prove a guarantee survives *without*
  the domain layer; here their presence would weaken the milestone's own claim.
- **The operator is not the founder.** The founder creates the business and a Dispatcher
  role; a second human does every act the milestone names, and the timeline is asserted to
  carry the operator's id and never the founder's.
- Two businesses, byte-identical input, including the same instants: the same technician
  name booked for the same hour on the same Tuesday, in both, neither blocking the other.
- **Verified non-vacuous.** `infra/supabase/snippets/i7-vacuity-control.sql` replaces the
  exclusion constraint with the shape `constraints.md` quotes from `tire-app-template` — no
  leading tenant, null resource coalesced to the zero uuid — against a database rebuilt from
  scratch. Exactly the two unassigned-work tests then fail with `23P01`, including the
  cross-tenant one, and everything else still passes.

**A correction that came out of writing that control.** With a non-null `resource_id`, the
leading `organization_id` in the exclusion constraint is redundant for *correctness* — a
resource uuid belongs to exactly one organization, so two tenants can never share a key. It
earns its place through I2, index selectivity, and the fact that the redundancy stops holding
the moment a null resource is coalesced. What actually keeps two tenants' unassigned work
from colliding is the **partial predicate**, and the gap in coverage that this made obvious —
no test had one tenant's unassigned booking meet another's — is now closed.

### Checklists, time and cost

- `infra/supabase/migrations/20260827000010_checklists.sql` and
  `20260827000011_time_and_cost.sql`.
- **I10 is enforced, one milestone earlier than `roadmap.md` said.** A recorded *cost* is not
  a *price*: a price is derived from configuration a business publishes and is what I4
  governs; a cost is an observation about a job that already happened, and needs no pricing
  engine. Deferring it would have meant the first pricing slice inventing the money columns
  as a side effect. Both roadmap lines are corrected rather than quietly outgrown.
- **There is no platform default currency**, and the asymmetry with the timezone is the
  point: UTC is the absence of an assumption about a business, and there is no equivalent for
  money, so `create_organization` refuses to found one without a currency. It is snapshotted
  onto every amount rather than joined, so changing what a business trades in does not
  reinterpret last year's costs.
- `formatMoney` is the only place a minor unit is divided, and it takes the fraction digits
  from the currency rather than assuming two — a JPY case is asserted, because assuming two
  prints ¥1,00 for what is ¥100.
- A checklist step stores `done_at` **and** `done_by`, not a boolean: who ticked it is the
  evidentiary value, and the policy pins `done_by` to `auth.uid()` so it cannot be forged.
  A column grant keeps a caller from rewriting a step's label after doing something else.
- Time worked is separate from time scheduled, and deliberately has **no** exclusion
  constraint: two overlapping timesheet entries are a correction or a mistake to report on,
  not an impossibility. Refusing them would mean refusing to record what happened.
- Neither table has an update or delete policy. A correction is a new row — a negative
  amount is explicitly allowed — which is the rule `events` already follows.

### Availability, and the calendar as a view

**I5 and I6 are enforced.**

- `apps/web/lib/domain/scheduling/availability.ts` and the schedule screen.
- **I5 is not provable by counting functions.** What makes one calculation hold is that it
  and the constraint agree, so nothing has a reason to grow a second opinion — asserted in
  both directions: a window it calls free can be committed, one it does not cannot.
- **I6 is asserted as the race it describes.** Availability is read, a second caller takes
  the slot, and the first commits against an answer that was true when given. Nothing in the
  domain layer could have prevented that: `scheduleWorkItem` deliberately does not check
  first, because a check before an insert would race identically. The exclusion constraint,
  in the transaction that would have written the row, is the re-assertion.
- **No calendar table**, per `domain-model.md`. The schedule screen derives everything on
  read; a day is bounded by `zonedDayRange` in the tenant's own zone, which is 23 hours on
  the day a zone springs forward and 25 on the day it falls back. Both are asserted, because
  that is the bug reported as "the app broke in March" and never reproduced.
- Operating hours are **not** subtracted: a resource is treated as free whenever it is not
  committed, which is true of a resource and not of a business. Per-tenant hours are M3
  configuration, and hardcoding a working day would be the hardcoded business hours
  `constraints.md` forbids.

### The window, the exclusion constraint, and the tenant's clock

**I7 and I9 are enforced.** A work item occupies a resource for a window that nothing else
can double-book, and the guarantee is a database constraint — `roadmap.md` will not accept
this in any other form, and there is no overlap check in the domain layer.

- `infra/supabase/migrations/20260827000009_scheduling.sql` — `btree_gist`,
  `work_items.scheduled_during`, `work_items_resource_not_double_booked`,
  `organizations.timezone`, `schedule_work_item`, `unschedule_work_item`, and the
  `work_item.schedule` capability.
- **The constraint is partial, and that is the whole answer to the failure `constraints.md`
  quotes.** `where (resource_id is not null and scheduled_during is not null)` means
  unassigned or untimed work never enters the index, so there is no key to collide on —
  rather than `tire-app-template`'s coalesce of a null technician to the zero uuid, where
  every unassigned job in the database shares one key and a second tenant's 9am blocks yours.
  Three tests are that failure inverted, and a fourth is the cross-tenant one: the other
  business books the byte-identical window on an identically named resource and succeeds.
- **One `tstzrange`, half-open, not two timestamps.** A gist exclusion needs a range anyway,
  a pair of columns is a pair that can be stored the wrong way round, and `[start, end)` is
  what makes a job ending at 10:00 not collide with one starting at 10:00 — the off-by-one
  nobody finds until a technician is double-booked at a shift boundary.
- **Authorization is split between a policy and a trigger, deliberately.** An RLS policy sees
  the old row in `USING` or the new row in `WITH CHECK` and never both, so no policy can say
  "you may change the status but not the resource". The policy is the coarse gate; the
  per-column refinement is `app.check_work_item_update_capability`, and the test that proves
  it matters gives a member `work_item.transition` — enough to pass the policy — and watches
  the trigger refuse the schedule.
- **I9's second half needed somewhere for the clock to live.** `organizations.timezone` is
  chosen once at founding and validated against `pg_timezone_names`. There is no edit path
  yet, which is the answer D19 already gave for a membership's display name: it waits for a
  caller. `formatWindow` is the one renderer.

Gate green: 178 tests.

### Transitions, and the first update policy work_items has ever had

**I13 is enforced.** A work item can change status, and only along moves the tenant has
configured for that work item type.

- `infra/supabase/migrations/20260827000008_work_item_transitions.sql` —
  `work_item_transitions`, `app.check_status_transition`, `work_items_update`, and the
  `work_item.transition` capability.
- **The check is a trigger, not only domain code.** D6 said transition validity is "enforced
  in the domain layer"; I12 says a direct PostgREST update must be refused exactly as a form
  is, and TypeScript is not on that path. D6 has been corrected rather than softened — the
  clause that was doing the work, *not by the type system*, survives intact, because a
  trigger reading `work_item_transitions` is reading configuration.
- **A type with no configured transitions is frozen, not unconstrained.** The forgiving
  reading makes I13 hold vacuously for every tenant on their first day, silently.
- **The column grant is authorization, not tidiness.** An RLS policy sees the old row in
  `USING` or the new row in `WITH CHECK` and never both, so no policy can say "you may change
  the status but not the customer". `grant update (status_id)` says it, and binds a direct
  caller and an RPC alike.
- **A real bug, caught by the test before it shipped.** A row failing an UPDATE policy's
  `USING` clause is invisible to the statement: the update touches nothing and *raises
  nothing*. The first version of `change_work_item_status` went on to write a
  `work_item.status_changed` event for a move that never happened. It now checks `returning`,
  which is the shape `assign_role` already used for the same reason — and the capability test
  asserts both halves: the status did not change, and no event was written.

Gate green: 162 tests.

### Work item types

M2's first slice, and the debt `20260827000003_work_items.sql` wrote down by name: *"Statuses
are therefore per organization here, and become per type in the change that adds types."*
This is that change.

- `infra/supabase/migrations/20260827000007_work_item_types.sql` — `work_item_types`, statuses
  scoped to a type, work items carrying theirs, and `create_work_item_type`.
- **A status name is now unique within a type, not within the organization.** A business that
  installs *and* repairs wants "Scheduled" on both boards; the old index refused the second
  one. The new index still leads with `organization_id` (I2) — the type is inserted after it,
  never before.
- **I20 arrives with the constraint that enforces it.** A work item cannot sit in another
  type's status, and this is the first claim in the schema that I18's machinery does *not*
  catch: both rows belong to the same organization, so RLS is satisfied and every composite
  reference passes. `work_items_status_same_org_and_type` is a three-column reference, and
  the test writes the mismatch directly because the domain layer cannot express it.
- **`create_work_item` did not gain a type argument.** The type follows from the status, and
  an argument that must agree with another argument is an argument that can disagree with it.
  It is derived inside the function, under the caller's own RLS.
- The backfill names one type per organization that already had statuses. It is the only
  place in this schema where the platform picks a word on a tenant's behalf; the migration
  says why, and says that both alternatives — deleting a board, or refusing to apply — are
  worse in kind rather than in degree.

Nothing transitions yet. There is still no update policy on `work_items`: I13 needs the
allowed-transitions table, which is the next slice.

Gate green: 147 tests.

### Why three of the four surfaces are later

`vision.md` names four surfaces on `apps/web` — marketing, booking, admin, customer portal —
and only admin appears anywhere in `roadmap.md`. **New decision D20** writes down why, so the
asymmetry reads as a choice rather than a backlog nobody wrote.

- **Booking is blocked on invariants, not effort.** It answers *what can I book, when, and
  for how much*, which is I5, I6 and I4 — none enforced. A booking page written first
  necessarily carries its own availability and its own price, the exact second implementation
  I4 and I5 forbid, on the surface where being wrong costs most. I6 describes a public
  booking flow *specifically*: building the flow before the invariant is enforceable ships
  the double-booking it exists to prevent.
- **The customer portal is a second identity model, not more screens.** Every permission runs
  `membership → role → capability`, and a customer must never hold a membership — that row
  would put them inside `app.current_tenant_ids()` and hand them the tenant. Seeing only the
  rows that concern you, from outside the organization, is a new authorization axis. It also
  lands on I19, where a customer downloading their own contract needs a signed URL minted
  after a check that has no `has_capability` to call.
- **Marketing is configuration with a renderer**, and therefore M3 by definition — every word
  a business shows the world is a claim it makes about itself, which this file already forbids
  hardcoding. It is also the only part of `apps/web` that would exercise no domain rule.
- **Rejected: a thin booking or portal page early "to have something to show".** A booking
  flow built for one business hardcodes that business's flow, which is the per-client app
  studio `vision.md` refuses in its second sentence. The admin surface already shows the whole
  kernel working.

Two claims corrected to match: `CLAUDE.md`'s layout table listed four surfaces in a way that
read as present tense, and `vision.md`'s surfaces diagram is now labelled as architecture
rather than build order.

No code changed. Still four documents.

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

- `pnpm db:types` generates `apps/web/lib/db/database.types.ts` from the local schema,
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

- `apps/web/proxy.ts` and `lib/db/session.ts` — session refresh on every
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
- `apps/web/lib/domain/tenancy/` — `listMyOrganizations`, `createOrganization`,
  `requireActor`. The route, the server action, and the form are callers and decide nothing.
- `apps/web/tests/tenancy.test.ts` — two organizations with identical names in one database,
  under two genuinely signed-in users. Verified non-vacuous: three organizations exist while
  one user sees two and the other sees one.

Newly enforced: **I1, I2, I3, I11, I12** (see `docs/domain-model.md`).

Deliberately absent: no `packages/`, no `services/api/`, no roles table, no per-tenant
terminology, no Customer, Location, Asset, Work Item, Resource, Document, or Field
Definition. Each arrives with the slice that needs it.
