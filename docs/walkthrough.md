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

### 2. Found a business

`/organizations` → **New organization**. Four fields, and each is a decision rather than a
formality:

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

## What you cannot reach from any screen

Three capabilities exist in the domain layer, are covered by tests, and have **no route, no
form and no button**. This is the honest residue of M4, and it is why a hand-driven booking
walkthrough stops short:

| Capability | Function | What its absence blocks |
|---|---|---|
| Publish a kind of work to the public booking page | `setTypeBookable` | `/book/{slug}` resolves only for a business that publishes a bookable type, so **the whole booking flow is unreachable by hand** even with the module on and a URL name set. |
| Withdraw a customer's portal link | `revokePortalInvite` | The portal page's own comment says "the business revokes it". Today the business cannot. |
| Change an existing member's role | `assignRole` | A role is assigned at the moment somebody is added and never changed afterwards. |

`infra/supabase/snippets/publish-bookable-type.sql` exists so the booking flow can be exercised
locally, and **its existence is the evidence of the gap rather than a fix for it**: a real
business cannot run a SQL snippet, and "nobody at that business has ever been given database
credentials" is M4's criterion. The test path proves the platform can do this; no operator path
proves an operator can.

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
