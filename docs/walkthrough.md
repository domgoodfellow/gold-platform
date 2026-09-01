# Driving the platform by hand

The test suite proves the platform. It does not *show* it to you — every suite runs headless
against a real Postgres, creates its own users, and takes its assertions from function return
values rather than from a screen. This document is the other path: how to sit in front of the
running application and reach, with a mouse, each thing a milestone test proves with an
`expect`.

It is a **guide, not a specification**. Where it disagrees with the code, the code is right and
this file is stale — say so in the same commit that finds it. What it is allowed to be
authoritative about is the one thing no other document records: **which capabilities exist in
the domain layer and cannot be reached from any screen**, which is the section near the end.

---

## What Supabase Studio's user list actually is

Studio's *Authentication* page fills up with addresses like `alice-7f3c…@example.test` after a
test run, and none of them can sign you in. That is not a bug and they are not seed data:

- Each suite calls `admin.auth.createUser` with a **password it generates and throws away** —
  `pw-` plus a random uuid. Nothing writes it down, so nothing can type it into `/sign-in`.
- The addresses are per-run, because two suites running against one database must not collide
  on `customers_org_email_unique` or on a membership.
- Nothing cleans them up. Deleting them by hand mostly fails: `created_by` on every tenant
  table references `auth.users` **without** `on delete cascade`, so a user who founded anything
  is held by their own rows.

**The eraser is `pnpm db:reset`.** It re-applies every migration against an empty database, so
the Studio list and every tenant row go together. Do it before a walkthrough you intend to read
carefully, and expect to redo the sign-up below afterwards.

There is deliberately **no seed file**. `infra/supabase/` holds `migrations` and `snippets` and
no `seed.sql`, because a seeded business would be the platform choosing a business's statuses,
hours and vocabulary — the thing `constraints.md` forbids in its never-hardcode list. A new
organization here is genuinely empty, and the emptiness is the product working.

---

## Standing it up

1. `pnpm db:start` — needs Docker. It prints an API URL, an anon key and a service-role key.
2. Put the anon key in `apps/web/.env.local` (copy `apps/web/.env.example` first). Nothing in
   `apps/web` may hold the service-role key.
3. Put what the tests need in `infra/.env.test` — gitignored, and the only place a service-role
   key belongs, because the suites need to *create* users before they sign in as them.
4. `pnpm --filter @gold/web dev` — <http://localhost:3000>.

Studio is at <http://127.0.0.1:54323>. Use it to *watch* rows, not to make them: every
walkthrough below is meant to be doable without it, and the places where that breaks down are
listed under "What you cannot reach from any screen".

---

## The walkthrough

### 1. Two people, not one

Open a private window alongside your normal one and sign up twice — `/sign-up`. You want two
accounts because `addMember` refuses an address with no account behind it: *"Nobody with that
address has an account yet. Ask them to sign up first."* There is no invitation email; M6 owns
channels, and until then a member is somebody who signed up and was then named.

The second account is also how you see I12 with your own eyes later: a member whose role lacks
a capability still sees every screen and is told why the form is not theirs.

### 2. Have a business provisioned for you

**This step used to say "found a business", and it cannot any more.** D29 closed founding:
`/organizations` has no form on it, `create_organization` holds no grant, and a business begins
when somebody at GOLD provisions it. Sign in as the staff account from *The other side* below,
provision one for the first of your two sign-ups, then come back and sign in as them.

What the provisioning form asks is four things about the business plus the address it belongs
to, and each of the four is a decision rather than a formality:

- *What is it called* — the business's name.
- *What should it call you* — your display name **in this business only** (D19). The founder is
  not a special case; they are its first membership, and another business may know you by a
  different name.
- *Timezone* — write-once at founding, because the edit path needed a capability of its own.
  UTC is the honest default rather than the server's zone, which would make the answer depend
  on where this happened to be deployed.
- *Currency* — required, with no default, because there is no neutral currency to pick.

What you get: one membership holding the founding role with every capability, the kernel — work,
the schedule, customers, locations, resources, fields, roles, settings, none of which is a
module and none of which can be switched off — and exactly one module on: **Billing**.

**Assets, public booking, the customer portal and card payments all start off.** Publishing a
page to the internet is not a default anybody should acquire by signing up, and neither is a
module for machines a business may not have. Go to Settings → *What this business uses* and
watch the sidebar change as you flip Assets and Billing: that is the fastest way to see the
difference between a module and the kernel, and switching Billing off also takes the quote, the
invoice and the margin off every job screen.

### 2b. The shortcut, if this deployment has one — *Guided setup*

**Optional, and worth doing once in each direction.** Switch **Guided setup** on in Settings and a
*Guided setup* entry appears at the bottom of the configuration group. It takes one box: describe
the business in your own words — the work it does, how a job goes from start to finish, what you
charge for, when you are open — and it hands back a whole proposed setup with questions attached
about whatever it could not work out.

**Nothing has happened to the business at this point, and that is the thing to check.** Open
*Work* in another tab before you press Apply: still empty. The proposal is a row, every word of it
is yours to change on the screen, and only Apply writes anything — through exactly the same calls
steps 3 to 6 make by hand. Change a stage's name before applying, then go and look at the board:
your word is there and the drafted one is not.

**If this deployment has no model key, the screen says so** rather than taking three paragraphs
and refusing them, and points you at the screens below. That is the honest state, not a broken
one: everything the proposal would have written can be typed in by hand, which is why guided setup
is a module and not part of the kernel.

Steps 3 to 6 are the hand path. Do them at least once even if the shortcut worked — they are what
the shortcut is a shortcut *to*, and a proposal that lands part-way leaves you finishing it here.

### 3. Teach it what work is — *Work*

The Work area is where a business's vocabulary is written, and a brand-new one has none, so the
board is empty and there is nothing to create a job against.

1. **Kinds of work**, at the bottom of the page — create one. This is a `work_item_type`, and
   the board above the fold is that type's jobs grouped by that type's statuses.
2. **Statuses** — create at least two. Each carries the tenant's own word, an order, and one
   question the platform genuinely needs answered: *does this status release the resource?*
   That flag is the place `roadmap.md` records "configuration is enough" being checked and
   found short — a cancelled job that keeps the van booked is the afternoon gone.
3. **Allowed moves** — create the transitions. Until you do, **the type is frozen, not
   unconstrained** (I13): a job can be created in a status and moved nowhere. If a move you
   expected is refused, this is why, and the refusal came from a database trigger rather than
   from the form.
4. **Steps every ⟨type⟩ involves** — the checklist template, optional. It is *copied* onto each
   job at creation and never joined, which is what makes editing it safe for work already done.

### 4. Give it something to schedule — *Resources*, *Settings*

- **Resources** — a van, a bay, a person, a room. The scheduling engine has no opinion about
  which of those it is holding.
- **Settings → Opening hours** — starts empty, and empty means *always open*, not *closed*.
  Nothing anywhere holds a working week: no Monday-to-Friday, no weekend, no seeded set. Add a
  rule or two and watch the schedule's free time contract around it.
- **Settings → This business → buffer** — how long a resource stays busy *after* work ends.
  Zero means back-to-back. It is enforced by the exclusion constraint rather than merely
  displayed, so widening it far enough to overlap two committed jobs is refused by the
  database — which is the database declining to hold a schedule the business cannot work.

### 5. Who the work is for — *Customers*, *Locations*

Create a customer; create a location and link it to them. A customer's detail page is the CRM
screen: their locations, their documents, their timeline read from `events`, and their
invoices. Nothing there is a table of its own — the timeline is a projection.

### 6. What it charges — *Pricing*

Price book items, in this business's currency, in integer minor units. A job is priced by
copying catalogue rows onto it, and the copy holds no foreign key back, so editing the
catalogue never rewrites a quote somebody already agreed to.

### 7. Run a job — *Work* → the job's own page

Create a work item from the board, then open it. **`/work/{id}` is the screen where this
platform actually happens**, and it is the one screen with no sidebar entry, because it is a
detail route inside Work rather than an area of its own. On it:

- edit the job, move it through the statuses you configured, tick the checklist copied from
  the template;
- record time and record costs — observations about a job that happened;
- add priced lines from the catalogue — a claim the business published in advance;
- read *job economics*, which subtracts the two and **returns no margin at all** when the
  currencies differ, because converting one would need a rate, a rate has a date, and a date
  makes this accounting software.

### 8. Money

On the same page: **issue an invoice**, which snapshots its lines, then **record a payment**.
There is no `paid` column — where an invoice stands is derived on every read. If
`STRIPE_SECRET_KEY` is set and the *Card payments* module is on, a card control appears; the
business's own processor account is connected from Settings → Getting paid, and what GOLD
stores is an `acct_` id, never a key.

### 9. The customer's own view

Customer detail → **portal link**. Open it in a private window: `/portal/{token}`. The token is
the credential and the page does not pretend otherwise — it is the security model of a link to
a shared document. Note what the page says and does not say: every word that is not application
state is the business's own copy from Settings → Public page, because no platform sentence may
appear on a public surface.

### 10. Trying to break it — the part worth doing twice

These are the assertions the milestone tests make, performed by hand:

- **Double-book a resource.** Schedule two jobs onto one resource in overlapping windows. The
  refusal comes from `work_items_resource_not_double_booked`, a partial gist exclusion
  constraint — there is no check in the domain layer, deliberately, because a check before an
  insert races identically.
- **Cancel one and re-book the slot.** It only frees up if the status you moved it into says it
  releases the resource. Flip that answer in Work → Statuses and watch the schedule change.
- **Sign in as the second account** under a role missing `work_item.transition`. Every screen
  still renders and the forms explain themselves. The guard is RLS; the sentence is the
  courtesy.
- **Found a second business from the same account** and switch between them. Identical names,
  identical statuses and identical customer email addresses all coexist — that is M1's whole
  claim, and the sidebar's *Switch business* is where you feel it.

---

## The other side: the platform console

Everything above is a tenant. `/platform` is the first screen in this application built for the
people who run GOLD, and it is the only one you cannot reach by clicking — you have to be put
into a Postgres role first.

1. **Sign up a third account** at `/sign-up`, normally. The row references `auth.users`, so the
   person has to exist before they can be staff.
2. **Run `infra/supabase/snippets/add-platform-staff.sql`** in Studio's SQL editor, with the
   address and name edited at the top. It raises if the address matches no user rather than
   inserting zero rows and reporting success.
3. **Sign out and sign in again.** This is the step that catches people. The role arrives as a
   claim on the token and the token is minted at sign-in, so somebody promoted while signed in
   stays `authenticated` until their next one. Nothing is broken; the session is just older than
   the decision.

Then `/platform` lists every business: when each arrived, what it trades in, what it has
switched on, and when it last did anything — each rendered in that tenant's own zone and
currency, because a console showing every business in one timezone would be deciding what
Tuesday means for somebody in Tokyo.

**Provision a business, which is what this console is for.** *Provision a business* asks the
four things founding asks plus the one that makes it the operator door: whose business it is.
That person **must already have an account** — a membership references `auth.users`, so sign
them up first in a private window, exactly as you would before adding a member. Fill it in and
the business appears in the list below, newest first.

Then sign in as that owner. They have the whole business — the founding role and every
capability — and you are not in it: their *People* list has one row and it is not you. Nothing
in their organization, role or membership records a GOLD user id at all. What does record one is
their event log, which says the business was provisioned and by whom, because that is a true
fact about how it began.

**What to actually look at, because the screen is a list and the milestone is not.** Try to
reach a tenant. Take an organization id off the console and open
`/organizations/{id}/work` as the staff account: you get a 404, not a page, because
`getOrganization` filters on the caller's own membership and staff hold none. Then try to write
anything at all — there is no button, so this one is Studio's SQL editor with the role set — and
the refusal is `permission denied`, a missing privilege rather than a policy declining. That
distinction is the whole invariant (I21): no write policy names this role *and* the role holds no
write grant, so a permissive policy added later still hits a wall.

**One human who both runs GOLD and operates a business needs two accounts.** The hook replaces
the `role` claim outright, so a staff member who is also a member of an organization loses the
membership half while signed in — their tenant policies key on `authenticated` and they are no
longer wearing it. That is D28 working as intended rather than a rough edge: our people are not
in a customer's own list of who works at their business.

---

### 11. Make it run itself — *Settings*, *Automations*, *Assets*

Everything below is configuration and none of it needs a deploy.

**Switch it on.** Settings → *Automations*. The switch now names where it is set up and links
there, and tells you what is still missing — which is D31, and the reason the Card payments
switch used to be a dead end. Switch on *Weather* or *Maintenance* too and each says it needs
Automations, rather than handing you a link into a screen that is not there.

**Write a rule.** Automations → *New rule*. Name it, pick what sets it off, and press add. It
arrives inert: no conditions, nothing to do. Then add a condition — the picker offers the parts
of a job *and this business's own custom fields*, from the registry it already keeps — and add an
action.

Four kinds of trigger, and they are genuinely four different things:

| Kind | Fires | Runs |
|---|---|---|
| when something happens | an event: a job created, booked, moved, scheduled | inside the transaction that caused it |
| a set time before a job starts | the moment the offset names | on the next tick |
| when conditions cross a line | a reading at the job's location | on the next tick |
| every so many hours or miles | a counter reading you record on a machine | inside the write that recorded it |

**Watch it act.** Create a job that matches, and it moves before the page finishes reloading. The
job's timeline names the rule. Under the rule, *Recently* shows what it did.

**Watch it fail, which is the more interesting half.** Point a rule at a status the type's own
lifecycle cannot reach from where the job is, and create a matching job. **The job is created
normally** and the rule records a failure with the database's own sentence in it — that is the
subtransaction working, and the reason a business's bad rule can never break a customer's
booking.

**Write a message.** Automations → *What this business says*. Every word is yours; the five
placeholders are the platform's whole contribution. Add a *tell the customer* action, and a job
with a customer who has an address queues one. Whether it is actually sent depends on what the
installation is connected to, and the message itself says which — including "this deployment
cannot send email messages yet", which is the honest answer rather than silence.

**Record a counter.** Assets → any machine → the reading box. The first reading sets the mark and
raises nothing, deliberately: switching a rule on for a machine that has already run nine hundred
hours must not raise nine services that were done years ago. Cross the interval and a job appears,
titled with the rule's own name and attached to the machine.

**Two things you cannot do by hand**, and both are on purpose. You cannot type a weather reading
— a business that could would be a business that could make its own rules fire — so exercising
that path locally means calling `record_external_reading` over a database connection, as
`milestone-m6.test.ts` does. And the tick that runs timed and weather rules is
`/tasks/automation-tick` in `apps/api`, which needs `CRON_SECRET`; without it every scheduled rule
simply waits.

---

## What you cannot reach from any screen

Three capabilities exist in the domain layer, are covered by tests, and have **no route, no
form and no button**. This is the honest residue of M4, and it is why a hand-driven booking
walkthrough stops short. A fourth thing needs database access for a different reason, and it is
recorded under the table because conflating the two would turn a decision into a debt:

| Capability | Function | What its absence blocks |
|---|---|---|
| Withdraw a customer's portal link | `revokePortalInvite` | The portal page's own comment says "the business revokes it". Today the business cannot. |
| Change an existing member's role | `assignRole` | A role is assigned at the moment somebody is added and never changed afterwards. |

**A third capability was on this list and is not any more.** `setTypeBookable` — publishing a
kind of work to the public page — was the sharp one, because `/book/{slug}` resolves only for a
business that publishes something, so the whole booking flow was unreachable by hand. It is now a
section on the **Work** screen under the selected kind of work, gated on the booking module. The
stand-in snippet `publish-bookable-type.sql` is deleted, because a snippet beside a screen is a
second way to do one thing, and Settings no longer says "no screen here can publish one" — it
says which screen does (D31).

**A fourth thing now needs database access, and it is the one entry here that is not a debt.**
Adding somebody to `platform_staff` is a hand-run snippet
(`infra/supabase/snippets/add-platform-staff.sql`) because `platform_staff` has no insert policy
and no grant to any application role — deliberately. A screen that adds a colleague is a *staff
write*, and D28's own trigger to revisit is "the first thing platform staff must write". Nothing
is owed until that decision is made, which is the difference between this snippet and the two
capabilities above it: those stand in for operator paths a business must eventually have, and this
one stands in for nothing, because the person running it is us.

**Provisioning a tenant was the first staff write, and it has landed** (D29) — the decision D28
deferred, made as narrowly as it could be: one `execute` on `provision_organization`, no table
privilege, so the role still cannot write anything belonging to a business that already exists.

**Founding is closed, which is why step 2 above reads the way it does.** `create_organization`
holds no grant, so nobody founds a business from `/organizations` any more — the console is the
only way one begins. `/sign-up` stays open because an account is not a tenant: the owner has to
have one before a business can be handed to them.

With that snippet run, the booking half of the walkthrough is: Settings → set a URL name and
switch *Public booking* on, then open `/book/{slug}` in a private window and take a slot as
somebody with no account at all. What you are watching is D22's external actor — a real
`auth.users` row from anonymous sign-in, bound to exactly one organization, holding insert
permission on no table whatsoever.

---

## Where each milestone shows up on screen

| Test | What it proves | Where you would see it |
|---|---|---|
| `milestone-m1.test.ts` | Two businesses built from byte-identical input can neither observe nor block each other | Found two organizations with the same words, then switch between them |
| `milestone-m2.test.ts` | A non-founder defines a lifecycle and commits work to a resource, twice, identically | Work → statuses and allowed moves, then the schedule |
| `milestone-m3.test.ts` | Two maximally different businesses configured through one function with no branch | Settings' currency and timezone, on a second business sharing no word with the first |
| `milestone-m4.test.ts` | A stranger books; the operator schedules, works, invoices and is paid | Steps 7–9 above, plus the booking half once the snippet has run |
| `milestone-m5.test.ts` | Somebody who runs GOLD sees every business, changes none of them, and hands one over | The console, and the provisioning form on it |
| `milestone-m6.test.ts` | A rule written by a person moves a job and writes to a customer with nobody present | Step 11 above, and *What is failing* on the console |
| `milestone-m8.test.ts` | Prose becomes a whole proposed setup and the business stays empty until a person applies it | Step 2b above — describe the business, then look at *Work* before pressing Apply |
