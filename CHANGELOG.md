# Changelog

Shipped work, recorded on merge. Milestone definitions live in `docs/roadmap.md`; task state
lives on the issue board. Nothing here has a checkbox (`constraints.md` D9).

## Unreleased

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
