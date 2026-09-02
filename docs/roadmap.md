# Roadmap

Milestone **definitions**, not task lists. A milestone is done when its acceptance criteria
are demonstrably true — not when a checklist looks full.

**Status is not tracked here.** Task state lives on the issue board; shipped work is recorded
in `CHANGELOG.md` on merge. Nothing in this file has a checkbox, because nothing in git
forces a checkbox to stay accurate. See `constraints.md` D9.

One issue per **vertical slice** — schema, domain, route, UI, guard, test — never one issue
per layer.

---

## Order of work

**A milestone number is identity, not sequence.** M0–M10 are cited over three hundred times
across this repository — in documents, tests and migrations — so renumbering them to express a
change of order would break every citation in order to record a fact that belongs in one list.
This is the list.

What drives it is `market.md`: this is a configured-deployment business, and the order below is
what that model wants built first. It is falsifiable — the first three sales calls can overturn
it, and if they do, this section changes rather than the numbering.

1. **M5 — the platform side.** Provisioning is the factory floor. Every signed customer walks
   through it.
2. **M6 — workflows and automations.** **Taken ahead of the place this list gave it, and the
   reason is worth keeping rather than quietly renumbering.** M5 shipped a staff console that
   could not answer its own fourth question — *what is failing* — because nothing in the schema
   recorded a failure, and M6 was named as the milestone that would give that question a writer.
   Finishing a screen that named a question it could not answer beat leaving it standing. It also
   settled D30, which the AI layer would otherwise have had to settle while holding a second
   problem.
3. **M8's second criterion — describe a business, receive a proposed configuration.** The half of
   the AI layer with a business behind it, and now the half with a door standing open in front of
   it: `20260901000001` reopened self-serve founding, so a business can sign itself up and reach
   nothing but the hand-configuration screens. D29 says this flow is the only thing that door
   waits on. **D32 holds the decisions**, and `milestone-m8.test.ts` demonstrates it.
4. **Tenant marketing and branding.** D20's deferral, revisited — a named revenue line and the
   third sale to the same customer. **It has no milestone number yet and needs one**;
   `organization_profiles` is the seed and `tire-app-template`'s `site_content` is the pattern.
   **A tenant's own integrations (D33) is the second unnumbered entry**, and it waits on a
   customer naming one rather than on anything in this list. A third would mean the numbering has
   stopped describing the work.
5. **M8's first criterion — asking the system questions. Built, and it did not wait for M7.**
   This entry said it lands *after* M7, and that was right about the dependency and wrong about
   its size. Four of the seven commands `starting_conversation.txt` §18 uses as examples are
   reports, and an AI layer over no aggregate layer either cannot answer those or grows a second
   aggregate layer inside its tool implementations — which is what I4 and I5 exist to prevent one
   level up. But *what work is at risk of being late today* is a query over `work_items` and needs
   nothing that does not exist, and the two shapes of question were never the same dependency.

   **What keeps the distinction honest is that a tool cannot contain a calculation.** A tool is a
   `stable`, `security invoker` function in Postgres (D34), so the failure this entry feared is
   structurally unavailable: there is no aggregate-shaped tool, a question needing one is answered
   *I cannot answer that*, and the tool that answers it gets written when M7's aggregate layer
   exists for it to call.
6. **M7 — reporting and dashboards.** Now the thing that unlocks the report-shaped half of the
   question tools, rather than the whole of them.
7. **M9 — reception and sales.** D5's reasoning is unchanged and nothing in `market.md` moves it.
8. **M10 — desktop.** No customer has asked.

**A milestone splitting across this list is new, and M8 is the first.** Its two criteria share a
number and not a dependency, which is what the numbering was always warned about: the number is
identity. Nothing is renumbered and both halves keep citing M8.

**GOLD as tenant zero runs alongside all of it and is not a milestone.** GOLD is an operations
business — customers, work items, scheduling, documents, costs — so it is an ordinary
organization with ordinary memberships, distinct from the `platform_staff` role D28 keeps out of
every tenant. The risk it carries: a field our own pipeline wants is *one* caller, and the
constraint against building for one is right to refuse it.

---

## M0 — Founding documents

> **Done when:** `/scope` can be run against the first real slice and returns a named
> invariant and a decision record without the operator supplying either.

That is the whole test. If scoping a task requires explaining the platform in the prompt,
the documents have not absorbed enough, and the gap is found for the price of one prompt
rather than one milestone.

### Already true

- `vision.md`, `constraints.md`, `domain-model.md`, and `roadmap.md` exist.
- `CLAUDE.md` routes work to the right document.
- The five prompts exist as slash commands in `.claude/commands/`.
- The invariants are stated. Which of them are actually enforced is recorded in
  `domain-model.md`'s `Enforced by` column and nowhere else, because a count repeated here
  is a status field that nothing keeps honest (D9).

### Remaining

Nothing structural. M0 closes the first time `/scope` is used in anger.

---

## M1 — The kernel

> **Done when:** two organizations exist in one database, each with its own users,
> customers, locations, and work items, and no query, index, or constraint belonging to one
> can observe or block the other — demonstrated by a test that creates colliding rows in
> both tenants and expects success. Those entities accept per-tenant custom fields through
> `field_definitions`, because after M4 they hold production data and the registry can no
> longer be added cheaply (`constraints.md` D7, D18).

That test is the milestone. It is also the thing every prior attempt deferred.

Covers: `organizations`, memberships and roles — **including a way for a second person to
join one** — the tenant resolution function, RLS across every table created so far,
`Customer`, `Location`, `Asset`, `Work Item`, `Resource`, `Document`, `Event`, and
`Field Definition`.

Enforces: **I1, I2, I3, I11, I12, I16, I17, I18** — and `Event` must ship with the first
slice that writes state, because it cannot be backfilled.

Three things that must be right here because they are expensive later:

- Every unique index and exclusion constraint leads with `tenant_id` (I2). The
  colliding-rows test exists specifically to catch this.
- Custom fields land inside this milestone, not a later one, and arrive together with the
  registry that governs them (`constraints.md` D7 and D18).
- **An organization can gain a second member, and roles are exercised by somebody who is
  not the founder.** A kernel in which every organization has exactly one member cannot
  demonstrate "each with its own users" at all, and a capability check tested by one member
  reassigning their own role proves less than it appears to. See `constraints.md` D19 for
  what a membership may and may not be.

---

## M2 — The work engine

> **Done when:** an operator can define a work item type, its statuses, and its allowed
> transitions from the admin UI without opening the database — and a work item moves through
> that lifecycle, consuming a resource for a window that nothing else can double-book.

Covers: work item types and statuses as data, transition validation, assignment, the
scheduling core over Work Item and Resource, availability calculation, checklists, time and
cost capture.

Enforces: **I5, I6, I7, I8, I9, I10, I13** — and **I20**, which was added by the slice that
enforced it.

`I7` is a database exclusion constraint. An application-level overlap check is not this
milestone.

**Operating hours are configuration, and they are nothing else.** The availability
calculation subtracts them, and no part of the platform holds a working week: there is no
Monday-to-Friday, no weekend, no seeded rows and no default, because all of those are the
hardcoded business hours `constraints.md` forbids. A business that has configured nothing is
treated as always open, which is the only reading of "it has said nothing" that does not
invent a claim on its behalf.

**I10 and I8 moved here from M3, and the reason is a distinction worth keeping.** M3 owns *pricing*,
which is I4. A recorded **cost** is not a price: a price is derived from configuration a
business publishes, a cost is an observation about a job that already happened. Cost capture
is named in this milestone's coverage above, and it needs no pricing engine — but it does
need money columns, and deferring them would have meant the first pricing slice inventing
them as a side effect.

---

## M3 — The configuration engine

> **Done when:** a new business can be stood up entirely through configuration — modules,
> roles, fields, statuses, forms, terminology, pricing rules, scheduling rules — with no
> migration and no deploy. The test is literally: configure a second business shape without
> a pull request.

Covers: custom forms over field definitions, the price book and what a job is quoted from it,
and the interface.

Enforces: **I4**.

**Two things named in that coverage list were removed correctly. One was removed by mistake,
and this milestone owns the mistake.**

Dashboard configuration had no dashboard to configure, and business rules is one
trigger-condition-action runtime by `domain-model.md`'s own account with nothing triggering
anything yet. Each would have been a table, a screen and a vocabulary built against a
hypothesis, which is the speculative abstraction `constraints.md` opens by refusing. Those two
removals stand.

**Module enablement was the mistake.** The argument given was that there were no modules to
enable — the module table in `domain-model.md` was empty, and a module needs two independent
pieces of evidence with one from a system that shipped. Every clause of that is true about the
wrong noun. An empty ownership table and a two-pieces-of-evidence bar govern an **engine**, a
body of code that owns entities and rules; module enablement is not a claim about code at all.
It is a per-tenant row saying which capabilities this business has switched on, and it had
callers the day it was cut: `navigation.ts` shows every area to every tenant regardless of what
they bought, D21 prices partial adoption against a mechanism this milestone was supposed to
ship, and `vision.md` bills `platform fee + modules + usage` against the same. The D21
quotation used to justify the removal — partial adoption "needs no new mechanism at all" — says
the opposite of what it was read as saying: it means *no mechanism beyond module enablement*,
which was this milestone's job.

`constraints.md` D25 now holds the two words apart so the substitution cannot be made again,
and the *Scope and abstraction* section's own prediction — that it would be over-tuned the
first time something was removed and did not come back — is exactly this. **The slice lands in
M4.** What survives unharmed is the criterion above, because standing up a business shape needs
roles, fields, statuses, transitions, hours, currency, timezone and prices; modules decide what
that business is *shown and charged for*, which is a different question and was always a
smaller one.

**Pricing rules stayed, in the only form that has a caller.** What a business charges is a
per-tenant catalogue and a quantity, and `milestone-m3.test.ts` stands up two businesses that
share no word or number without either needing more than that. A rule *engine* — conditions
over a work item, minimum charges, surcharges — was scoped and deliberately not built, because
neither shape asked for one and a hypothesis is not evidence. When a business needs a rule the
catalogue cannot express, that rule belongs inside `priceWorkItem`, which is why I4 insists
there is only one of it.

I10 and I8 were both enforced in M2. See that milestone for why a cost is not a price; I8
arrived with the two edit paths that made it load-bearing — changing a currency, and editing
a checklist template — each of which is safe only because the thing it could have rewritten
was snapshotted. Pricing does not add the invariant, it inherits it: when amounts derived
from a catalogue land, they snapshot the same way.

**Terminology was in that coverage list and is not a thing M3 builds, so the word is gone.**
It named two mechanisms at once. A tenant already names its own things — `work_item_types.name`,
`work_item_statuses.name`, `roles.name`, `field_definitions.label`, and the per-tenant display
name on a membership (`constraints.md` D19) are rows a business wrote, rendered as written.
That shipped across M1 and M2, and it is what the criterion above means: standing up a business
shape is largely the act of naming its things.

What is **not** built is overriding the platform's own nouns — Work Item, Resource, Customer —
in chrome the tenant never authored. That is a display-layer indirection over strings the code
owns, deferred in `constraints.md` under "Decided, not yet built" until a second vertical makes
its shape knowable; `capabilities.ts` already cites that deferral for the same reason about
capability labels, and `vision.md` makes the primitives non-negotiable in the same breath as it
makes everything else configurable. The debt M3 does take on is that the operator shell
concentrates every platform noun into one navigation definition instead of scattering it across
page headings, so the override is a lookup swap when it has evidence rather than an excavation.

This is the milestone that decides whether the platform is a platform. If standing up a
business shape still needs code, M3 is not done regardless of what has been built.

**M3 also owns the interface, and until then nothing does.** Every screen through M2 is a
`max-w-2xl` stack of sections with incidental `sm:` breakpoints, no shell, no navigation
between areas of one business, and no shared form vocabulary. That is a deliberate deferral
rather than an oversight — M3 rebuilds these screens anyway, because custom forms over field
definitions and pricing both change what is on them, and styling them twice would be the
waste. What M3 owes:

- **An operator shell**: persistent navigation across one business's areas, rather than every
  page beginning with a back-link to `/organizations`.
- **Real responsiveness**, decided rather than inherited from whatever Tailwind default was
  typed first.
- **Shared form components**, extracted from what already exists at the point a third screen
  needs the same control — never before.

`../../my-builder/my-app/frontend` is the **reference** for the shape of that shell, not for
its code: `components/layout/org-sidebar.tsx` is the one to read. Its sibling
`admin-sidebar.tsx` belongs to a *platform staff* console spanning tenants, which is a
different question entirely and is recorded in `constraints.md` under "Decided, not yet
built" — it cannot run on the caller's JWT, so it is an authorization decision before it is
a screen.

---

## M4 — Vertical one: a real business runs on the platform

> **Done when:** a real business runs its operations on GOLD — quotes or bookings in, work
> scheduled and assigned, work completed, invoiced, and paid — and nobody at that business
> has ever been given database credentials.

**Pneu3L is this milestone's evidence, not its subject.** The criterion above is a claim
about the platform; Pneu3L is the business that makes the claim checkable, in the same way
that M1's criterion is about tenancy and the two organizations in `milestone-m1.test.ts` are
how it is proved. The milestone is over when the *platform* can do that, and the fact that
one named business is doing it is what stops the claim being a hypothesis.

The business is named because "one real field-service business" was a placeholder and D1
deferred the naming to this milestone. **What it is, structurally, is the first row in
`organizations`** — the first tenant, holding no privilege, no branch and no column that a
second one will not also hold. Pneu3L: mobile automotive service, one owner-operator
who is also the technician, Montreal, CAD, `America/Toronto`, Stripe alongside cash as a
first-class payment method. **Its binding scheduling constraint is the travel between jobs
rather than the length of any one of them** — and that is a fact about this business, which is
the whole point of the paragraph above it. Nothing in the platform may hold it.

What the platform owes is not travel-aware scheduling. It is that **what makes a job fit is
something a tenant states, never something the code assumes**, and the first answer to that
already shipped: `organizations.buffer_minutes` is a per-tenant number the exclusion constraint
reads through `occupies`, and a business that leaves it at zero has said its jobs run
back-to-back. A clinic whose real constraint is room turnaround and a hire yard whose constraint
is nothing at all configure the same column to different numbers, and no line of code knows
which of them is which. Travel time computed between two specific addresses is the part the
buffer cannot express; that is a platform capability whose named prerequisite has since landed
— `locations` carries `latitude` and `longitude` as of M6's second slice — and not a Pneu3L
feature. What is still missing for travel time is the measuring, not the points.

It onboards **fresh** — see `constraints.md` D1, which this milestone resolves. Its rows do
not migrate; its configuration does. A business arriving through configuration is the claim
`vision.md` makes, and a business arriving through an import script would prove the opposite.

**The test that keeps the two apart, applied to every slice in this milestone.** Anything
Pneu3L needs is one of exactly three things, and only the first two may be built here:

1. **Platform capability** — the tenant could not express it by configuring, and any business
   of this shape would hit the same wall. `releases_resource` was this. Build it, in the
   domain layer, named for what it does rather than for whom.
2. **Configuration** — a work item type, a status, a transition, a price book item, an
   operating-hours row, a field definition. This is Pneu3L's data, it lives in the database
   and not in the tree, and it is the milestone working as designed.
3. **Pneu3L-specific code** — a branch, a column, a screen or a constant that names this
   business or encodes a fact only true of it. There is no such category. It is the
   per-client app studio `vision.md` refuses in its second sentence, and the fork D1 rejects,
   arriving one `if` at a time instead of all at once.

A slice that cannot be sorted into (1) or (2) has not been scoped yet. The symptom is a
platform noun that reads as a tire word, a default that is only a default because Pneu3L
would have chosen it, or a table whose only conceivable second tenant is another mobile
mechanic. Run `/scope` rather than guessing — the question it is for is exactly this one.

**"Operator" means whoever runs the business, not the founder.** M2's criterion already
exercised somebody who was not, D19 governs what a membership may be, and D20 records that
*admin* names the tenant operator surface. What separates an owner from a dispatcher is role
capabilities and nothing else.

See `constraints.md` D5 for why field service rather than sales.

Covers:

- **The external-actor authorization axis, and this is the milestone's largest cost.** D22
  says booking, the customer portal and any embedded surface are blocked on one model, and
  that whichever surface goes first pays for it. Booking went first, M4 paid, and D22 carries
  the four answers. The one that was not anticipated: the plan was for every write to be an
  RLS permit policy, and a returning customer broke it — `customers_org_email_unique` refuses a
  second row for one address, and a read policy narrow enough to be safe cannot see the
  customer already there. The write side became one privileged function with a scope check
  instead, which made the surface *smaller*: an outsider now holds no insert permission on any
  table at all.
- **Booking and the customer portal.** D20 deferred both and its trigger has now fired: I5
  and I6 were enforced in M2, I4 in M3, and D22 is written. They are no longer blocked on
  invariants — only on the model above.
- **Quote → invoice → payment.** Named in the criterion above and absent from every coverage
  list until now. Stripe is the first vendor behind an adapter and the first real caller for
  the integration shape — and it brought two decisions with it. **D26** moves `apps/api/`
  forward from M6, because ingress is Python's by D2 and the alternative was a route called
  *api* inside the app that is not the API. **D27** decides that a tenant connects their own
  processor account rather than pasting a key into a settings form: GOLD stores an account id,
  charges are created on the business's own account, and no customer money ever reaches a
  balance of ours — which is what keeps this platform out of being a money transmitter, and is
  a legal position rather than an architectural preference.
  What lands in `apps/api` is one endpoint: no scheduler, no `domains/`, no `workers/`, because
  automation execution is still M6 and still the thing that needs them.
- **Job economics.** Prices landed in M3 and costs in M2, and nothing subtracts them.
  Revenue minus cost per job is the smallest useful version, and it is the number the owner
  asks for first.
- **The customer timeline.** `Event` shipped in M1 precisely because it cannot be backfilled,
  so the substrate exists and what is missing is a screen.
- **Editing and cancelling a work item.** `updateWorkItem` does not exist and neither does a
  cancel path: a job typed wrong today is wrong permanently, which no live business tolerates.
  Editing the details is a `work_item.update` capability following the per-column split
  `app.check_work_item_update_capability` already establishes.

  **This list said cancelling "is a status the tenant configures and a transition into it,
  needing no new code", and that was wrong.** The claim was about D6 and it was right about
  D6; what it missed is the exclusion constraint, whose partial predicate was
  `resource_id is not null and scheduled_during is not null` and knew nothing about status. A
  tenant could configure "Cancelled" and move a job into it, and the van stayed booked for a
  job nobody was doing — on a business whose primary scheduling constraint is travel, that is
  the afternoon gone. The available workaround was worse than the gap: unschedule then
  transition is two capabilities, so a dispatcher who could cancel but not schedule left the
  slot held with nothing reporting it.

  What it needed was one question the tenant answers about their own word —
  `work_item_statuses.releases_resource` — feeding the constraint's predicate. Deliberately
  not `is_terminal`, which 20260827000003 refused for the right reason: that flag is the
  platform deciding what a status *means*, and this asks only whether the van is occupied.
  Recorded here rather than quietly fixed, because "configuration is enough" is the claim
  this platform makes most often and this is the first place it was checked and found short.
- **Module enablement, arriving late from M3.** See that milestone for why it was removed and
  `constraints.md` D25 for the word that removed it. It lands here because this is where the
  callers finally became undeniable rather than merely present: Pneu3L is one owner-operator
  who does not want *Assets*, *Resources* or a customer portal on their phone, and booking is
  the first surface that a tenant either offers to the public or does not. The shape is the
  smallest thing that satisfies those callers — a per-tenant set of enabled module keys, an
  `AREAS` entry naming the module it belongs to, and a navigation that renders what is on.
  **It is not authorization and must never become it**: a member who cannot configure fields
  still sees that fields exist and is told why the form is not theirs (I12), whereas a module a
  tenant has not bought is not part of their business at all. The two failures look identical
  on screen and are opposite in the database — the guard stays RLS and `app.has_capability`,
  and module state answers a different question.
- **The interface, per D23** — which exists so that M4 does not rebuild its screens the way
  M3 rebuilt M2's.
- **A business's own words on its public page**, which was not in this list and had to be.
  Booking is a public surface, so it trips the precondition D20 defers *marketing* over: copy
  is configuration, and the first booking page shipped speaking in the platform's voice. One
  row of tenant copy per business, rendered at the top of any public surface. Not the marketing
  surface — no pages, no blocks, no theme — and D20 is amended to say why the two could never
  have been sequenced the way this roadmap assumed.

**CRM is a module and not an engine, and both halves of that are worth keeping.**
`docs/starting_conversation.txt` §9 describes a CRM engine: a customer timeline and customer
intelligence. **Both get built.** The timeline screen lands in this milestone; lifetime value,
outstanding balance and last-contacted land in M9, where the dialer is the caller that needs a
customer reduced to a number rather than a history — over the aggregate layer M7 builds, which
is why they are not simply arithmetic written twice. A tenant will see *Customers* in their
navigation, switch CRM on or off, and be billed for it. That is a module and it is real.

What is not built is a `crm` directory owning entities and rules of its own, because the
timeline is a projection of `events` and the intelligence is arithmetic over work items, prices
and payments. That is the engine bar in `constraints.md`, and CRM does not clear it — nor does
it need to, because **a module with no engine is the normal case** (D25).

An earlier version of this paragraph read "there is no CRM engine" and stopped there, which
sounded like refusing the product when it was only declining a directory. That is precisely the
collision D25 exists to end, and it is recorded here rather than smoothed over because this
document caused it.

**Three capabilities shipped without an operator path, and that was a debt against this
milestone's own criterion rather than a deferral.** `setTypeBookable`, `revokePortalInvite` and
`assignRole` existed in the domain layer, were covered by tests, and had no route, form or
button. The first was the sharp one: a type becomes bookable when a business says which status a
booking starts in and how long one takes, and there was nowhere on any screen to say it — so
*publishing to the public booking page* was something only somebody with database access could
do, which is the precise thing "nobody at that business has ever been given database
credentials" claims nobody has to. The test path proved the platform could do it; no operator
path proved an operator could.

**`setTypeBookable` is paid.** It is a section on the Work screen under the selected kind of
work, gated on the booking module — the address is configured in Settings where the module says
it is, and *which types are on the page* is per type and belongs where the types are.
`outstandingModuleSetup` used to end that module's sentence with "and no screen here can publish
one", which was the debt written into the product; it now names the screen.
`infra/supabase/snippets/publish-bookable-type.sql` is deleted, because a snippet beside a screen
is a second way to do one thing. **Two remain**, and `docs/walkthrough.md` names both where
somebody would hit them.

**Module enablement shipped inert, and the cause was a word.** Every area in `AREAS` belonged
to one of four modules marked `required` — `work`, `scheduling`, `customers`, `billing` — so
the filter `areasIn` applies could never remove an entry, and the three switchable modules each
owned a surface *outside* the sidebar. The switch existed, was tested, and changed nothing an
operator could see. The caller this milestone gave for the whole feature, an owner-operator who
does not want *Assets* on their phone, was unreachable on the day it landed.

A required module is the kernel misfiled: a module is by definition the part a business
*chooses*, and there is no version of this platform where somebody records work without work,
a schedule, customers or a way into their own settings. Those are now simply not in the list —
`Area.module` is optional, absent means kernel — and what remains is what a business can
genuinely decline: `billing`, `assets`, `booking`, `portal`, `card_payments`. Switching billing
off takes Pricing out of the navigation *and* the quote, invoice and margin off every job,
because hiding the area and leaving the sections would have been half a switch.

**This is the second time D25's distinction was needed and the first time it was not enough.**
That record separates a module a tenant enables from an engine that owns code, which is what
M3 got wrong. The word it did not pin down is what a module is separate *from* — and the
answer is the kernel, which is neither. `navigation.test.ts` now fails if no area belongs to an
optional module, which is the assertion that would have caught this: every test it had was
about the two lists agreeing rather than about the feature doing anything.

**What M4 produces beyond a running business** is the list of seams that looked general — to
be tested against the next vertical rather than declared general here. That is the other half
of *evidence, not subject*: one business cannot tell you which parts of itself were general,
so what this milestone hands to M6 and M9 is a list of candidates, not a set of engines. `constraints.md`'s
*Scope and abstraction* governs what may be *claimed* about them, and that section is
explicit that it is not a gate on building any of it.

---

## M5 — The platform side

> **Done when:** somebody who runs GOLD rather than a business on it can see every tenant, what
> each has switched on, and what is failing — from a surface inside this application, holding no
> membership in any of them and reaching no tenant's data through a service-role key. And a
> business that GOLD signed becomes a tenant because somebody at GOLD provisioned it — through
> the same `createOrganization` a self-serve door will call once M8 can do the configuring.

**Everything before this milestone was built for a tenant. This is the first one built for
us.** M1 through M4 answered "can a business run on this", and the answer is yes — while the
people who own the platform have no surface at all, and watch their own tenants in the database
vendor's dashboard. That is not a missing screen. It is the last authorization axis, and it is
the reason this milestone exists before the ones that add tenants faster.

**The staff axis is a Postgres role, and that is a decision rather than an implementation
detail — see `constraints.md` D28.** Every policy in this database keys on
`app.current_tenant_ids()`, which answers *which tenants is this caller in*, and staff are in
none of them. The three shapes that already exist do not stretch: a member is scoped by
membership, an external actor by `app.current_external_tenant()` and is bound to exactly one
tenant, and the machine writer holds no table grant at all. Cross-tenant read is a fourth
shape, D14 refuses the service-role client that would fake it, and putting staff in every
tenant's `memberships` would write our people into each customer's own list of who works there.

**"Admin" is taken and means the tenant operator surface** (D20), so the word is *platform* and
the route is `/platform`. That naming was owed since the console was first written down.

Covers:

- **The staff role and its policies** — one Postgres role, read across tenants, and the
  invariant that comes with it: a platform-staff path may read what it needs and write no
  tenant's data. `payment_webhook` is the precedent for a role with a deliberately tiny grant.
- **The tenant list**, which is the whole console at first: who exists, when they arrived, what
  they have switched on, when they last did anything. Not a dashboard — an aggregate layer is
  M7 and building a second one here is exactly what that milestone exists to prevent.
- **Operator-provisioned onboarding** (D29). GOLD creates the organization and hands it over,
  which is what actually happens when a business is signed. **This is one of two doors onto one
  `createOrganization` rather than an alternative to self-serve**, and the distinction is worth
  stating because D29 was first written as "provisioned, not self-served" and that named the
  wrong axis. What decides whether a door may be open is whether somebody is on the far side of
  it doing the configuring — a new organization here is genuinely empty, and handing the
  emptiness to somebody with nothing to fill it is not a product. M5 builds the door where that
  somebody is a person. M8's onboarding flow is the somebody behind the self-serve door and
  opens it by calling the same function, and it is the *better*-configured of the two rather
  than the emptier one. What closes here is the **unattended** door: `/sign-up` as it stands,
  where a stranger founds an organization and nobody is configuring it at all.
- **GOLD's own public site**, at last distinguished from the marketing surface D20 defers.
  That record blocks a *tenant's* site because every word on it is a claim that business makes
  about itself; this one is GOLD's claim about GOLD, and the argument never applied to it. The
  route group exists and holds the page that has been sitting at `/` since M1.

**What is deliberately not here.** Billing a tenant for what they enabled. `vision.md` prices
`platform fee + modules + usage`, `organization_modules` records what is on and since when, and
the two have never met — but a price is a number, numbers move on the first three sales calls,
and D8 keeps them out of this directory for that reason. The console can *show* what a tenant
has on. Charging for it needs a payment relationship with the tenant that does not exist and a
`billing-usage.md` that D8 unlocks at the first usage event.

**Why here rather than earlier or later.** Not earlier, because a console over one tenant is a
list with one row and the axis would have been designed against a hypothesis. Not later,
because M6 adds automation that fails silently and M9 adds a second vertical: the first time
"what is failing" is a real question is the first time nobody can answer it.

**"What is failing" has no substrate, and that quarter of the criterion is deferred to M6
deliberately rather than skipped.** The console answers three of its four questions — who
exists, what they have switched on, when they last did anything — and `events` is on the staff
grant list and has a read policy, so the fourth has somewhere to come from. Nothing reads it for
failures because nothing *records* one: a failure in this system today is a `DomainError`
raised, rendered to whoever caused it, and dropped, and there is no failed-thing table anywhere
in the schema. Building one here would be a table with no writer, which is the speculative
abstraction `constraints.md` opens by refusing — and the paragraph above is its own argument for
why the wait is short. M6's automation is the first thing this platform can do that fails with
nobody watching; a scheduled evaluation that did not fire is a failure no tenant reports and no
screen shows. **The row lands with the writer, and M6 owns both.** Until then the honest console
is one that does not claim to answer a question it has no data for.

**Closed by M6, and the shape it took is worth recording: it added no table.** "Give the console
a failures table" was the obvious move and would have been a second copy of two tables that
already record their own outcomes — a copy that would drift the first time one of them learned a
new one. What shipped is a view over `automation_runs` and `message_deliveries`, and the same
view serves the tenant's own screen, so there is no second idea of what *failing* means growing
on the other side of the product.

**Operator provisioning is a staff *write*, and it collides with D28 by design rather than by
accident.** `20260830000002` grants `platform_staff` `select` and no `insert`, `update` or
`delete` on any table at all — the second half of the invariant, and the half that survives a
careless policy author. D28's stated trigger to revisit is "the first thing platform staff must
*write*", and D29's operator door is that first thing. **This is the two records working, not
disagreeing**: D28 declined to grant a write before there was one to name, and D29 names it. It
meant the provisioning slice decided a *shape* before it drew a screen, and it chose the second
of the two candidates: **one `SECURITY DEFINER` function and no table privilege**, which is what
the external axis chose the last time a caller needed exactly one write and no table permission
(`create_booking`, D22). A write grant on `organizations` and `memberships` was the other
option, and it fails for a reason worth keeping: it is indistinguishable, at the privilege
level, from letting staff rename a live business and add themselves to it. I21 now carries the
line that choice draws — staff may bring a tenant into existence and may not reach into one that
exists.

**The other half closed too, and it cost more than the estimate.** D29's consequence said M5
"closes `/sign-up`", and taken literally that is not implementable: provisioning names an owner
who must already have an `auth.users` row — the same precondition `addMember` states out loud —
and creating that row needs the admin API, which `apps/web` may not hold and must not (D14).
**An account is not a tenant.** Registration stays open; *founding* is what closed, and it
closed in the database — `create_organization` holds no grant at all — rather than by removing
a form, because a missing button is not a boundary (I12).

**Two things it dragged with it, and the second is the interesting one.**

The suite's own idea of how a business begins had to change: twenty-nine test files founded
their fixtures by calling `create_organization` as an ordinary user, and they now provision
through `tests/helpers/founding.ts`. That is one place instead of twenty-nine, and the point is
not tidiness — a founding path only the tests could reach would be the second creation path
this milestone just spent a migration forbidding.

And **creating a business and configuring one came apart, because the database refused to let
them stay together.** The first attempt kept `configureBusiness` whole and had it stand the
business up through the operator door; that fails at the second step, since `createRole` and
everything after it run against policies keyed to `app.current_tenant_ids()` and platform staff
are a member of nothing. I21 refusing exactly what it says it refuses. So GOLD creates the
business and whoever does the configuring configures it — **which is D29's own axis, arriving in
the code because the schema would not accept anything else.** It is worth recording as
confirmation rather than as a cost: the separation was not a design preference that could have
drifted, and the same shape is what M8's self-serve door will need.

---

## M6 — Workflows, automations, and the channels they act through

> **Done when:** the business already live on this platform adds a second technician, writes a
> rule — *when the forecast at a job's location crosses this threshold, move the job and tell
> the customer* — and a forecast change reschedules the job and sends the message. No code
> change and no deploy.

That business is Pneu3L, the first tenant, and it is **evidence and not subject here too** —
the criterion is a claim about the runtime, and naming the tenant inside it would make the
milestone read as a feature request from one customer. What the name supplies is a rule
somebody actually wants written and a second technician somebody actually needs to add.

**One tenant, deliberately.** The obvious version of this milestone stands up a second
business with crews and dispatch and calls the difference a feature. That framing makes
weather an engine, which D11 forbids for the right reason: weather owns no entity and no rule.
Weather is a perfectly good module, and a weather-dependent tenant switches it on.
**Dispatch is not something the platform builds.** It is what a business has once it
configures several resources and turns these capabilities on — and proving that on a business
already live is a far stronger claim than proving it on a second tenant built to need it.

Covers:

- **The workflow and automation runtime.** `starting_conversation.txt` describes these as
  §11 and §13 and they are one feature seen twice: a trigger, a condition, an action, and a
  branch. What exists today is the graph without the verbs — `work_item_transitions` says
  which status may follow which, and nothing anywhere expresses *if* or *then*. The runtime
  arrives here rather than in M3 or M4 because it needs a second caller and M4 supplies only
  the first: a booking confirmation is one line inside the domain function that creates the
  booking. Weather is the second, and the runtime absorbs the first when it lands — *Never
  duplicate a rule across callers* running on schedule rather than as a rescue.

  **There was nothing to absorb.** No notification code existed anywhere in `lib/domain` when M6
  started — M4 shipped no confirmation of any kind, so this described a line that was never
  written. The correction is better than the plan: a confirmation is now a rule *a business
  writes*, in its own words, rather than a sentence the platform sends on its behalf. Recorded
  rather than quietly reinterpreted, because "the runtime absorbs the first caller" was the
  argument for building the runtime here and it turned out to rest on something that did not
  exist.
- **Four trigger shapes, and they are not the same shape.** A schedule fires at a time. An
  external condition fires on a reading from a provider. Maintenance fires when *a counter a
  human or a sensor advances crosses a threshold* — the model `Mechanic_Maintenance` already
  ships, and the one an event-shaped runtime does not express naturally. Designing for the
  second alone is the specific mistake available here.

  **This said three, and the sentence above it assumed a fourth.** A booking confirmation fires
  on an event, and an event is not a schedule, a reading or a counter — it runs *inside the
  transaction that caused it*, which is the one thing the other three cannot do. Corrected here
  rather than quietly built: `event` is the first kind that shipped and the one every other
  slice was tested against.
- **Weather is an integration plus rules, and nothing else** (D11). The provider goes behind
  an adapter like any other; the business writes conditions against its answer. What is *not*
  configuration is the one prerequisite underneath, and it is **built**: `locations` now carries
  `latitude` and `longitude`, filled in by hand or by a geocoding adapter, and `locations` has
  the first update policy it has ever had — a column grant carrying those two and nothing else.
  A place with no point is an ordinary place; nothing is guessed on a business's behalf. The
  same gap blocked travel time and service areas, and no longer does.
- **Channels** — email, SMS, and the first outbound voice path, each behind an adapter that
  names a capability rather than a provider. Delivery is idempotent per recipient per reason;
  `Mechanic_Maintenance`'s notification log is the shape, and the failure it prevents is
  telling a customer the same thing twice.
- **`apps/api/` gains a scheduler here.** It was stood up in M4 for webhook ingress (D26) and
  holds one endpoint; this is the milestone that gives it the responsibility D2 lists first.
  A scheduled evaluation asking *what is due* has nowhere to live in Next.js. Per D24 it is a
  scheduled serverless invocation and not a worker daemon, so anything that must survive
  between runs lives in Postgres.

`infieldos-main` is the reference for the screens this shape needs — alerts, crews, activity —
alongside `tire-app-template`'s spec under D23. Reference for the shape, never the code; D1's
reasoning generalises to both.

### What shipped, and the four things worth knowing about it

**The runtime is in Postgres and the clock is in Python** (`constraints.md` D30). That was the
one open decision and it was forced rather than chosen: a rule tripped by a stranger's booking
runs where `app.current_tenant_ids()` is empty, and a rule tripped by the tick runs where there
is no person at all. Every action is a narrow `security definer` function in the class
`create_booking` already established, and `automation_runner` holds no grant on any table.

**Its cost is recorded and is not small: no action may search for a free slot.** Searching is
`freeWindows`, and a second one of those in a second runtime is exactly what I5 forbids — so a
rescheduling rule shifts by an offset the business typed and the exclusion constraint decides
whether it lands. A refusal is a recorded failure a dispatcher reads. That is I6 doing the job it
was written for, and it is also the first thing to revisit if a business asks for the next free
slot.

**M5's fourth question is answered.** `automation_runs` and `message_deliveries` record their own
failures with the database's or the provider's own words, and `platform_failures` — a
`security_invoker` view, like `platform_tenants` — is what the console reads. The deferral was
right and its reason has expired exactly as predicted: an automation is the first thing this
platform does that fails with nobody watching.

**Weather and maintenance are modules, and neither is an engine** (D11, D25). There is no weather
table and no maintenance table: a reading, a threshold a business typed, a counter log and a mark.
Both are configured on the Automations screen, which is a link a second switch could break — so
`Module.requires` declares the dependency and the settings screen says what is missing (D31)
rather than handing anybody a dead end.

**The rules are read back to the business, and that was not in the plan.** `reviewAutomationRules`
says which rules cannot work — a status nothing can move into, a threshold in a unit no reading
uses, a message rule on jobs with no customer, two rules fighting over one moment. It exists
because *what is failing* cannot see the worst cases: a rule that never fires produces no failed
run, because nothing happened, and on screen that is indistinguishable from a quiet week. None of
it is AI and none of it should be — it is arithmetic on rows the business already has. The
language model version answers the harder question (what this will do to the people receiving it)
and wants these answers underneath it regardless, which is M8.

**What M6 did not build.** A wall-clock schedule ("every Monday at seven") — a report's question
rather than a job's, with no caller. Conditions on a counter rule — every condition looks at a
job and a counter rule runs about a machine before one exists, so the domain layer refuses one
rather than accepting something nobody would consult. A per-tenant sending identity — proving a
domain per tenant is a real feature and a different one. And chaining: an automation may not
trigger an automation, because a cycle and a feature are indistinguishable from the rows.

---

## M7 — Reporting and dashboards

> **Done when:** an operator defines a report — entity, fields, filters, grouping, period —
> pins it to a dashboard, and shares it with a role, without anything about that report or
> that dashboard existing in code.

`starting_conversation.txt` describes these as §17 and §14. They are one machinery: **a
dashboard is a saved report with a layout and an audience.** Building them apart produces two
aggregate layers that disagree, which is the same failure I4 and I5 exist to prevent one level
up.

Covers: the aggregate layer, report definitions as per-tenant rows, the four dashboards the
source names — executive, operations, manager, employee — as configuration rather than four
screens, and the operational and financial report sets.

**M3 removed dashboard configuration and gave a reason with an expiry date:** there was no
dashboard to configure. M4 builds the operator's day view, which is the first one, and at that
point the argument stops working — a second hardcoded dashboard is the thing this milestone
exists to prevent.

**Job economics is this milestone's first row, and it ships in M4 without it.** Revenue minus
cost on one job screen is one function and needs no engine. Revenue by customer, by service, by
employee and by location are that same subtraction grouped four ways, which is where an engine
starts paying. Building the engine first would have been the abstraction with no caller;
building the fourth grouping by hand would be the copy.

**It lands before the *report-shaped* half of the AI layer's questions, and after both the half
that proposes configuration and the half that asks about work.** Four of the seven commands `starting_conversation.txt` §18 uses as examples —
least profitable services, cost trends, parts to order, customers not contacted — are reports,
and an AI layer over no aggregate layer either cannot answer them or grows a second aggregate
layer inside its tool implementations, which is the failure I4 and I5 exist to prevent one level
up. Onboarding is the other half and shares none of that: it writes configuration through
`configureBusiness` and reads no aggregate at all.

**Corrected twice, and the second correction is the interesting one.** This paragraph said
"before the AI layer" for two milestones after that stopped being true; it then said "before the
half that asks questions", which was also too broad. Question tools shipped ahead of this
milestone because a query is not a report, and what stops that from becoming the failure feared
below is D34: a tool is a `stable` function in Postgres, so a tool implementation cannot hold an
aggregate at all. What M7 unlocks is the tools that have no function to call yet.

**The original correction, kept for its reasoning.**
`market.md` moved AI onboarding ahead of both M6 and M7 and the *Order of work* list was
rewritten to say so; this sentence was not, so one file argued both ways and the stale half sat
inside the milestone it favoured — which is the kind that gets believed. Corrected here rather
than quietly, because the correction is the useful part: the dependency was always on *half* of
M8, and reading it as the whole is what put reporting in front of the onboarding flow.

---

## M8 — The AI layer

> **Done when:** an operator can ask "what work is at risk of being late today" and
> "which customers haven't been contacted in thirty days," and the answers are produced
> through the same domain tools a human uses, under that user's permissions — **and** can
> describe a business in prose and receive a proposed configuration, work item types,
> statuses, fields and price book, which a human reviews and applies.

Enforces: **I14**.

Do not start with autonomous agents. First make the AI good at *understanding* the system;
operating it follows. Every tool is a domain service that already exists — if a tool needs
new business logic, that logic belongs in the domain layer and the tool is a caller.

**The second criterion is onboarding, and it is the half with a business behind it.** Reading
the system answers questions; configuring it removes the bottleneck of a service business,
which is standing up the next tenant. It stays inside the guardrail above because a person
reviews and applies the proposal — the AI proposes configuration, it does not become
configuration.

`C:\Users\domin\Documents\step-by-roll` is the reference: role, agent, skill, tool, workflow held apart, with a
capability check on every tool. That separation is I14 already built once.

### The two criteria are built apart, and the second went first

**They share a milestone number and not a dependency.** Proposing a configuration is one
structured call over `configureBusiness`; asking the system questions is a tool loop. *Order of
work* split them accordingly and neither is renumbered.

**Both are now built.** The reason given here for putting questions last — that they are "tools
over an aggregate layer that does not exist yet" — was true of the report-shaped ones and not of
the rest. *What work is at risk of being late today* is a query over `work_items`. D34 holds the
decisions; the short version is that a tool is a `stable`, `security invoker` function in Postgres
called under the asking person's own token, so a tool can neither write nor see a row its caller
could not, and cannot contain an aggregate even if somebody wanted it to. What waits for M7 is
the tools with no function to call yet, and until then the assistant says it cannot answer.

**What the first criterion builds.** `public.work_at_risk`, the first tool; `agent_runs`, a row
per question readable only by whoever asked; `assistant.ask`; an `assistant` module and an Ask
screen; and in `apps/api`, a provider-blind loop over a capability contract with two
implementations — Claude, and anything speaking chat completions, which is how a business answers
with a model on its own hardware. **What it does not build is a write of any kind.** An intended
action coming back for a person to approve is the next slice.

**What onboarding builds.** `configuration_proposals`, a tenant-owned row holding the prose, the
proposed `BusinessShape`, the gaps the model could not fill and an outcome; a drafting adapter
under `lib/adapters/drafting/`; and a setup screen where a person reads the proposal, answers what
it asked, edits anything they disagree with, and applies. Applying calls `configureBusiness`
unchanged. **`constraints.md` D32 holds the decisions**, three of which are load-bearing: the model
holds no tool and no database handle, so I14 is satisfied by an absence rather than by a check;
applying adds no capability, because every step it takes is already gated by a policy; and a failed
apply is recorded on the row in the database's own words rather than rolled back, because
atomicity here would mean a second configuration path.

**It is not Business templates, and `configure.ts` already said so before this was written.** A
template is a named bundle the platform ships and a business starts from; a shape is supplied by
its caller, and nothing in a proposal is seeded, named or known to the platform in advance. The
earlier version of this section claimed the opposite — that onboarding *was* that entry arriving
the way it demanded — and the code contradicted it in its own comments for two milestones. That
entry stays closed, and what it is still waiting for is unchanged: two businesses configured by
hand.

**What this half does not build.** No tool loop, no agent, no question answering — that is the
first criterion. No drafting of message templates, though *Decided, not yet built* is right that
it belongs here and is the same shape: it is a **second** caller of the drafting capability, and
this repository builds the first one first.

### The first criterion is demonstrated by what a tool cannot do

`ai-tools.test.ts` is its demonstration, and like the others it turns on an absence rather than on
a happy path. It reads the tool registry out of the Python source — one registry, not a list kept
on both sides of the seam — and asserts from `pg_proc` that every name in it resolves to a
function that is not `volatile` and does not run as its owner. Then it asks the same question from
four sides of one database: two businesses get their own work back in their own words; each gets
**nothing** when handed the other's organization id, which is the assertion the whole design
exists for, because a model chooses that argument; a portal customer of the right business gets
nothing either, since the tool joins a table the portal has never been allowed to read; and
somebody who is a member of nothing gets nothing at all.

**No model is called, deliberately.** What D34 decides is structural, and a test that asked a
provider would be asserting somebody else's judgement, slowly and for money. The loop's own
behaviour — the cap, the recorded failure, the row count that is never a row — is tested in
`apps/api`, which is not in the check gate; that gap is why everything load-bearing above is
asserted from the side that is.

### The second criterion is demonstrated, and the demonstration is an absence

`milestone-m8.test.ts` describes two businesses that share no word — a chimney sweep in Tallinn
trading in euro, a dive school in Cebu trading in pesos — receives a whole configuration for
each, and **asserts at that moment that both are still completely empty**. No type, no status, no
price, no hour, and the same number of roles founding gave them. That is the milestone: the AI
proposed configuration and did not become configuration, and there is no path by which it could
have, because the drafting capability holds no database handle at all.

Two further things it proves rather than assumes. **The review is real**: between proposing and
applying, the test changes the last stage's name to a word the drafting never produced, and that
is the word in the database afterwards — so a proposal is not what gets applied, the reviewed
version is. And **neither business's vocabulary appears in the code that handled it**: the test
reads `configureBusiness`'s source *and* all three files of the drafting adapter, and fails on any
of their words. M3 makes that claim about the configuring; M8 extends it to the drafting, which is
the second place a business's specifics could have been smuggled in and one layer further out than
M3 was watching.

**The drafting is a fixed provider, and that is the honest choice.** What the milestone claims is
a property of the path — where a proposal lives, what may touch it, who writes — and a test that
called a real provider would be asserting somebody else's judgement, slowly and for money. That
the model has nothing to write with is asserted structurally in `proposals.test.ts`, from the
adapter's imports.

---

## M9 — Vertical two: reception and sales

> **Done when:** a business runs its front desk on GOLD — a call is placed or answered,
> recorded, transcribed, analysed, and attached to the customer timeline as events — and the
> analysis proposes actions that the domain layer executes rather than performing them itself.

Renamed from "Communications and the dialer", which described the plumbing. The plumbing
serves a business function — reception and sales — and naming it that way gives the milestone
M4's test instead of a demo's: a call placed and transcribed proves a pipeline, a business
answering its phone here proves a product. D5 already calls the dialer vertical two and says
why it is cheaper built second, once customers, timeline and audit exist to attach to.

**This milestone buys a second host, and D24 says why.** A call is a persistent media stream
for its whole duration, which is not what Vercel serverless is. `apps/api` does not move; a
realtime deployment target is added beside it.

References: **`agent-system`** — a receptionist agent and a sales agent over Twilio and
ElevenLabs, with an orchestration service and a tool dispatcher whose split matches D2's — and
**`nextfund-portal`**, which proved capability tokens, inbound routing, recording and
transcription.

**GOLD is a user of this milestone, not only its vendor.** Selling configured deployments to
businesses with no system is outbound calling, which makes GOLD a member of vertical two. As
tenant zero it switches the module on like any other tenant — no fork, no second path, and a
dialer we run ourselves is evidence for it that a hypothesis cannot be. What this does *not*
license is building it early to reach the first customer: the trigger is call volume, and thirty
calls need a phone and a list.

**Two-way email lands here, and it is the half of "communications" that is not the dialer.**
M6 sends; nothing reads. A customer's reply currently goes to somebody's personal inbox and
leaves the system entirely. Reading a mailbox so a reply attaches to the job it concerns needs an
authorization against somebody else's account, refreshable tokens, and a matching problem with no
perfect answer — which is why it waits for the milestone that owns a business's front desk rather
than being bolted to the sending half. `constraints.md`, *Decided, not yet built*, holds the full
entry, including the two smaller pieces that land earlier.

**Customer intelligence lands here**: lifetime value, outstanding balance, last contact, next
action. M4 built the history and M7 built the aggregate layer; this is the first caller that
needs a customer reduced to a number.

The progression is deliberately staged, and each stage is sellable on its own:
record → understand → assist → automate → delegate. Live rebuttals and voice agents are the
last two stages, not the first.

---

## M10 — Desktop

> **Done when:** the Electron build renders the same React components as the web app, with
> no forked UI, and adds only what a browser genuinely cannot do — device access, local
> printing, tray, hotkeys, headset integration.

Electron is another client, not another product. The `packages/ui` extraction happens here,
at the moment a second consumer exists — and not before (`constraints.md`, never create a
workspace package with one consumer).
