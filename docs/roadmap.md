# Roadmap

Milestone **definitions**, not task lists. A milestone is done when its acceptance criteria
are demonstrably true — not when a checklist looks full.

**Status is not tracked here.** Task state lives on the issue board; shipped work is recorded
in `CHANGELOG.md` on merge. Nothing in this file has a checkbox, because nothing in git
forces a checkbox to stay accurate. See `constraints.md` D9.

One issue per **vertical slice** — schema, domain, route, UI, guard, test — never one issue
per layer.

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
deferred the naming to this milestone. Pneu3L: mobile automotive service, one owner-operator
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
buffer cannot express; that is a platform capability with a named prerequisite — `locations`
holds an address string and no coordinates — and not a Pneu3L feature.

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
  the integration shape.
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
outstanding balance and last-contacted land in M8, where the dialer is the caller that needs a
customer reduced to a number rather than a history — over the aggregate layer M6 builds, which
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

**What M4 produces beyond a running business** is the list of seams that looked general — to
be tested against the next vertical rather than declared general here. That is the other half
of *evidence, not subject*: one business cannot tell you which parts of itself were general,
so what this milestone hands to M5 and M8 is a list of candidates, not a set of engines. `constraints.md`'s
*Scope and abstraction* governs what may be *claimed* about them, and that section is
explicit that it is not a gate on building any of it.

---

## M5 — Workflows, automations, and the channels they act through

> **Done when:** Pneu3L adds a second technician, writes a rule — *when the forecast at a
> job's location crosses this threshold, move the job and tell the customer* — and a forecast
> change reschedules the job and sends the message. No code change and no deploy.

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
- **Three trigger shapes, and they are not the same shape.** A schedule fires at a time. An
  external condition fires on a reading from a provider. Maintenance fires when *a counter a
  human or a sensor advances crosses a threshold* — the model `Mechanic_Maintenance` already
  ships, and the one an event-shaped runtime does not express naturally. Designing for the
  second alone is the specific mistake available here.
- **Weather is an integration plus rules, and nothing else** (D11). The provider goes behind
  an adapter like any other; the business writes conditions against its answer. What is *not*
  configuration is the one prerequisite underneath: **`locations` holds an address string and
  no coordinates.** Nothing can ask a provider for conditions at a place until that is a
  column or a geocoding adapter, and the same gap blocks travel time and service areas.
- **Channels** — email, SMS, and the first outbound voice path, each behind an adapter that
  names a capability rather than a provider. Delivery is idempotent per recipient per reason;
  `Mechanic_Maintenance`'s notification log is the shape, and the failure it prevents is
  telling a customer the same thing twice.
- **`apps/api/` arrives here**, and this is earlier than the Python plane used to be placed.
  A scheduled evaluation asking *what is due* has nowhere to live in Next.js. Per D24 it is a
  scheduled serverless invocation and not a worker daemon, so anything that must survive
  between runs lives in Postgres.

`infieldos-main` is the reference for the screens this shape needs — alerts, crews, activity —
alongside `tire-app-template`'s spec under D23. Reference for the shape, never the code; D1's
reasoning generalises to both.

---

## M6 — Reporting and dashboards

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

It lands before the AI layer deliberately. Four of the seven commands `starting_conversation.txt`
§18 uses as examples — least profitable services, cost trends, parts to order, customers not
contacted — are reports. An AI layer over no aggregate layer can only answer the other three.

---

## M7 — The AI layer

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
configuration. This is also **Business templates** from *Decided, not yet built*, arriving
the way that entry demands: as an extract of configuration that has already proven itself,
rather than a bundle cloned from a guess.

`step-by-roll` is the reference: role, agent, skill, tool, workflow held apart, with a
capability check on every tool. That separation is I14 already built once.

---

## M8 — Vertical two: reception and sales

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

**Customer intelligence lands here**: lifetime value, outstanding balance, last contact, next
action. M4 built the history and M6 built the aggregate layer; this is the first caller that
needs a customer reduced to a number.

The progression is deliberately staged, and each stage is sellable on its own:
record → understand → assist → automate → delegate. Live rebuttals and voice agents are the
last two stages, not the first.

---

## M9 — Desktop

> **Done when:** the Electron build renders the same React components as the web app, with
> no forked UI, and adds only what a browser genuinely cannot do — device access, local
> printing, tray, hotkeys, headset integration.

Electron is another client, not another product. The `packages/ui` extraction happens here,
at the moment a second consumer exists — and not before (`constraints.md`, never create a
workspace package with one consumer).
