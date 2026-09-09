# Driving the platform by hand

The test suite proves the platform, headless against a real Postgres. This document is the other
path: how to sit in front of the running application and reach, with a mouse, each thing a
milestone test proves with an `expect`.

It is a **guide, not a specification**. Where it disagrees with the code, the code is right and
this file is stale — say so in the same commit that finds it. It is authoritative about one thing
no other document records: **which capabilities exist in the domain layer and cannot be reached
from any screen** — the section near the end.

---

## What Supabase Studio's user list actually is

Studio's *Authentication* page fills up with addresses like `alice-7f3c…@example.test` after a
test run, and none of them can sign you in. Not a bug, not seed data:

- Each suite calls `admin.auth.createUser` with a password it generates and throws away.
- Addresses are per-run, so two suites against one database don't collide on
  `customers_org_email_unique` or a membership.
- Nothing cleans them up — `created_by` on every tenant table references `auth.users` without
  `on delete cascade`, so a user who founded anything is held by their own rows.

**The eraser is `pnpm db:reset`.** Re-applies every migration against an empty database. Do it
before a walkthrough you intend to read carefully.

No seed file exists on purpose — `supabase/` holds `migrations` and `snippets`, never
`seed.sql`, because a seeded business would be the platform choosing a business's statuses, hours
and vocabulary. A new organization here is genuinely empty, and the emptiness is the product
working.

---

## The short way in: `pnpm demo`

```bash
pnpm demo:fresh    # reset the database, then populate it
pnpm demo          # populate a database that is already empty
```

Stands up two businesses sharing no word — an equipment hire yard in Amsterdam (euro) and a
clinic in Tokyo (yen) — jobs in every state, invoices and costs across three months, saved
reports and a dashboard each. Prints their URLs, accounts, and the one shared password.

- **Not a seed** — every row comes from a real domain call under a real session (D37).
- Refuses anything but localhost, and refuses a database that already holds organizations.
- **Log in as the second account in each business** — three capabilities and nothing else, the
  fastest way to see that hiding a control is a courtesy and the policy is the guard.
- One report is a spike and the rest are spread, honestly: invoices/costs/booked time carry
  dates a caller chose, but *work marked complete* reads the event log, which nothing may
  backdate — every completion is dated the afternoon you ran the script.

---

## Standing it up

1. `pnpm db:start` — needs Docker. Prints an API URL, an anon key and a service-role key.
2. Put the anon key in `apps/web/.env.local` (copy `apps/web/.env.example` first). Nothing in
   `apps/web` may hold the service-role key.
3. Put what the tests need in `.env.test` — gitignored, the only place a service-role key
   belongs, since the suites create users before signing in as them.
4. `pnpm --filter @gold/web dev` — <http://localhost:3000>.

Studio is at <http://127.0.0.1:54323>. Use it to *watch* rows, not to make them — see "What you
cannot reach from any screen" for where that breaks down.

---

## The walkthrough

### 1. Two people, not one

Sign up twice — `/sign-up` — in two browser sessions. `addMember` refuses an address with no
account behind it, and there's no invitation email yet (M6 owns channels). The second account is
also how you see I12 later: a member whose role lacks a capability still sees every screen and is
told why the form isn't theirs.

### 1b. Forgetting the password — the only flow with a round trip in it

Worth driving by hand, because it is the one thing here that leaves the application and comes
back, and no test in this repository follows it end to end: the link is carried by a browser
holding a cookie that a test client does not have.

1. **/login → *Forgotten your password?*** Give it the address of one of the accounts above.
2. The reply is the same sentence whatever you type, including an address with no account. That
   is deliberate — a form that answered differently would let somebody learn which addresses are
   registered.
3. **Read the mail at <http://127.0.0.1:54324>** (Inbucket, part of the local stack). The link
   points at Supabase, which bounces to `/auth/recover?code=…`.
4. Following it should land you on **/reset-password**, already signed in, with your own address
   named on the screen. Set a new one and you arrive at `/organizations`.

**If step 4 sends you back to *Forgotten your password?*, the session did not travel.** That is
the failure this flow is prone to: the exchange sets a cookie on the host the link was opened at,
so anything that changes host between the link and the form loses it. The callback redirects with
a relative `Location` for exactly that reason — `request.url` and `request.nextUrl` were both
measured turning a `127.0.0.1` request into a `localhost` redirect.

### 2. Found a business, or have one provisioned for you

**Stale until this line: self-serve founding reopened** (`20260901000001`, revisiting D29).
`/organizations` shows a form to any signed-in user with no organization yet, and
`create_organization` is granted to `authenticated` — the simplest path for either of your two
sign-ups is to use it directly, right here.

The staff-provisioned door still exists and is what M5's console proves, so it is worth walking
once: log in as the staff account from *The other side* below, provision a business for the
first of your two sign-ups (`createBusinessAction`'s staff-facing counterpart on `/platform`),
then sign in as them. Both doors write the same `organization.created` event — one flagged
`provisioned`, one not — and both call `app.enable_default_modules` before handing you the same
empty business described below.

The provisioning form asks four things, each deliberate:

- *What is it called* — the business's name.
- *What should it call you* — your display name **in this business only** (D19).
- *Timezone* — write-once at founding; UTC is the default rather than the server's zone.
- *Currency* — required, no default — there's no neutral currency to pick.

You get one membership with every capability, the kernel (work, schedule, customers, locations,
resources, fields, roles, settings — none switchable off), and two modules on: **Billing** and
**Guided setup**. The second is on because a first-run screen you have to discover in Settings is
not a first-run screen; it is still a module and still one click from off.

**Assets, public booking, the portal and card payments all start off.** Settings → *What this
business uses* — flip Assets and Billing and watch the sidebar change; switching Billing off also
takes the quote, invoice and margin off every job screen.

### 2b. The shortcut, if this deployment has one — *Guided setup*

Already in the sidebar. Describe the business in your own words — the work, how a job moves start
to finish, what you charge, when you're open — and get back a proposed setup with questions
attached for whatever it couldn't work out.

**The first section is what it wants to switch on**, because that is the only part of a proposal
that changes what the business *has* rather than what it is called. Each one is something the
business pays for, so they are checkboxes to clear rather than a summary to scroll past. Uncheck
one before applying and the sidebar you come back to is missing that area.

**Nothing has happened to the business yet.** Open *Work* in another tab before pressing Apply:
still empty. Only Apply writes anything, through the same calls steps 3–6 make by hand. Change a
stage's name before applying, then check the board — your word is there, the drafted one isn't.

No model key configured, the screen says so rather than failing after three paragraphs.

Do steps 3–6 at least once regardless — a proposal that lands part-way leaves you finishing it by
hand.

### 3. Teach it what work is — *Work*

A brand-new business has no vocabulary, so the board is empty.

1. **Kinds of work** — create one (`work_item_type`); the board is that type's jobs by status.
2. **Statuses** — create at least two. Each carries a name, an order, and one question: *does
   this status release the resource?* (A cancelled job that keeps its resource booked is the
   afternoon gone.)
3. **Allowed moves** — until you create transitions, the type is frozen, not unconstrained (I13):
   a refused move came from a database trigger, not the form.
4. **Steps every ⟨type⟩ involves** — the checklist template, optional, copied onto each job at
   creation and never joined back.

### 4. Give it something to schedule — *Resources*, *Settings*

- **Resources** — a van, a bay, a person, a room; the scheduling engine has no opinion which.
- **Settings → Opening hours** — starts empty, which means *always open*, not closed. Add a rule
  and watch the schedule's free time contract around it.
- **Settings → This business → buffer** — how long a resource stays busy after work ends. Zero is
  back-to-back. Enforced by the exclusion constraint, not merely displayed — widening it far
  enough to overlap two committed jobs is refused by the database.

### 5. Who the work is for — *Customers*, *Locations*

Create a customer, create a location, link them. The customer's detail page is the CRM screen —
locations, documents, a timeline read from `events` (a projection, not a table of its own), and
invoices.

### 6. What it charges — *Pricing*

Price book items, in this business's currency, in integer minor units. A job is priced by copying
catalogue rows onto it — the copy holds no foreign key back, so editing the catalogue never
rewrites a quote already agreed to.

### 7. Run a job — *Work* → the job's own page

Create a work item, open it. `/work/{id}` has no sidebar entry — it's a detail route inside Work.
On it: edit the job, move it through your configured statuses, tick the copied checklist; record
time and costs (observations about what happened); add priced lines from the catalogue (a claim
published in advance); read *job economics* — no margin at all when currencies differ, since
converting would need a rate, and a rate has a date.

### 8. Money

Issue an invoice (snapshots its lines), then record a payment. No `paid` column — standing is
derived on every read. With `STRIPE_SECRET_KEY` set and *Card payments* on, a card control
appears; connect the business's own processor account from Settings → Getting paid — GOLD stores
an `acct_` id, never a key.

### 9. The customer's own view

Customer detail → **portal link** → open `/portal/{token}` in a private window. The token is the
credential, and the page doesn't pretend otherwise. Every word that isn't application state is
the business's own copy from Settings → Public page — no platform sentence appears on a public
surface.

### 10. Trying to break it — the part worth doing twice

- **Double-book a resource.** Overlapping windows on one resource — refused by
  `work_items_resource_not_double_booked`, a partial gist exclusion, never a domain-layer check.
- **Cancel one and re-book the slot.** Only frees up if the status says it releases the resource
  — flip that in Work → Statuses and watch the schedule change.
- **Log in as the second account** under a role missing `work_item.transition` — every screen
  still renders and the forms explain themselves.
- **Found a second business from the same account** and switch between them — identical names,
  statuses and customer emails coexist (M1's claim), felt through the sidebar's *Switch business*.

---

## The other side: the platform console

`/platform` is the first screen built for the people who run GOLD — reachable only by being put
into a Postgres role, not by clicking.

1. **Sign up a third account** at `/sign-up`, normally.
2. **Run `supabase/snippets/add-platform-staff.sql`** in Studio's SQL editor, address and
   name edited at the top — raises if the address matches no user.
3. **Log out and log in again.** The role is a claim on the token, minted at log-in — staying
   signed in after promotion keeps the old token.

`/platform` lists every business — arrival date, currency, modules, last activity — each rendered
in that tenant's own zone and currency.

**Provision a business.** *Provision a business* asks the same four things as founding, plus
whose business it is — that person must already have an account. Log in as that owner: they have
the founding role and every capability, and their *People* list has one row, not you. Nothing in
their organization, role or membership records a GOLD user id — their event log does, saying the
business was provisioned and by whom.

**Try to reach a tenant anyway.** Take an organization id off the console and open
`/organizations/{id}/work` as staff: a 404, since `getOrganization` filters on membership and
staff hold none. Try to write anything (Studio's SQL editor, role set to staff) — `permission
denied`, a missing privilege rather than a policy declining (I21): no write policy names this
role, and it holds no write grant either, so a permissive policy added later still hits a wall.

**One human who both runs GOLD and operates a business needs two accounts.** The hook replaces
the `role` claim outright, so a staff member who is also a tenant member loses the membership half
while signed in as staff.

---

### 11. Make it run itself — *Settings*, *Automations*, *Assets*

**Switch it on.** Settings → *Automations* — the switch names where it's configured and what's
still missing (D31). Switch on *Weather* or *Maintenance* too and each says it needs Automations.

**Write a rule.** Automations → *New rule*. Name it, pick what sets it off, add. It arrives inert
— add a condition (the picker offers job fields and this business's own custom fields) and an
action.

Four kinds of trigger:

| Kind | Fires | Runs |
|---|---|---|
| when something happens | an event: a job created, booked, moved, scheduled | inside the transaction that caused it |
| a set time before a job starts | the moment the offset names | on the next tick |
| when conditions cross a line | a reading at the job's location | on the next tick |
| every so many hours or miles | a counter reading recorded on a machine | inside the write that recorded it |

**Watch it act.** A matching job moves before the page finishes reloading; the job's timeline
names the rule; the rule's *Recently* shows what it did.

**Watch it fail.** Point a rule at a status the type's lifecycle can't reach, create a matching
job — the job is created normally and the rule records a failure with the database's own sentence
(the subtransaction working: a bad rule can't break a customer's booking).

**Write a message.** Automations → *What this business says*. Every word is yours; five
placeholders are the platform's whole contribution. An unconnected channel says so plainly
("this deployment cannot send email messages yet") rather than going silent.

**Record a counter.** Assets → any machine → the reading box. The first reading sets the mark and
raises nothing (a machine already at nine hundred hours shouldn't raise nine back-owed services).
Cross the interval and a job appears, titled with the rule's name.

**Two things you can't do by hand, both deliberate.** A weather reading — exercise that path with
`record_external_reading` over a database connection (as `milestone-m6.test.ts` does). And the
timed/weather tick is `/tasks/automation-tick` in `apps/api`, needing `CRON_SECRET` — without it
scheduled rules simply wait.

---

### 12. Ask it something — *Ask*

Switch *Ask* on in Settings. Type *what work is at risk of being late today*.

**What comes back is built from what you can already see.** The loop reaches this database
through one function, `public.work_at_risk`, called with your own access token — scoped by
membership, not capability. A colleague with fewer capabilities gets the same answer; the portal
has no Ask screen at all.

**It needs two things and says so when it has neither.** `ASSISTANT_API_URL` in `apps/web`, and a
model on that deployment. Missing the first, the screen says this installation can't answer;
missing the second, it says so in the far side's own words.

**A model on your own machine** — the same path a business that won't let rows leave the building
uses in production:

```bash
ollama pull qwen3.5:9b            # tool-calling is what matters; `ollama list` shows which have it
# apps/api/.env
#   ASSISTANT_BASE_URL=http://127.0.0.1:11434/v1
#   ASSISTANT_MODEL=qwen3.5:9b
python apps/api/dev.py            # :8787
# apps/web/.env.local
#   ASSISTANT_API_URL=http://127.0.0.1:8787
```

Both settings are required together — no default model name, since one that resolves to a tag you
don't have makes the deployment look configured and answer 404 on every question.

**Anything hosted speaking the same dialect** is the same three settings, including Gemini's
OpenAI-compatible endpoint. Worth knowing: a free tier is usually free because the provider may
train on what you send, and a tool result is a business's customers and jobs.

**Try a weak model too, once.** `qwen3.5:9b` chains *look the job up, then suggest moving it*
correctly. `llama3.1:8b` cannot — it proposes a move for a job it never looked up, a description
where the id goes. What you should see: the suggestion recorded as **failed, reason beside it, no
button** — judged when written, not when pressed. `answered by` names the model.

**Ask it something it has no tool for** — *which service makes the most money* — and it should
say it can't answer. Report-shaped questions wait for M7's aggregate layer; a tool is a `stable`
Postgres function precisely so nothing can quietly answer with arithmetic in the loop instead.

Below the box: every question you've asked, with row counts. Your own only — a colleague's
questions aren't yours to read.

**Then ask it to do something** — *anything I should move?* A suggestion gets you *Move this job*
with the model's sentence and two buttons; nothing has happened yet. Press *Do it* and the same
function the schedule screen calls runs under your session — a colleague without
`work_item.schedule` gets the policy's refusal on the row; a taken window gets the exclusion
constraint's. Either way it's decided once — the buttons don't come back.

---

## What you cannot reach from any screen

Two capabilities exist in the domain layer, are covered by tests, and have no route, form or
button — the honest residue of M4:

| Capability | Function | What its absence blocks |
|---|---|---|
| Withdraw a customer's portal link | `revokePortalInvite` | The portal page's own comment says "the business revokes it". Today the business cannot. |
| Change an existing member's role | `assignRole` | A role is assigned when somebody is added and never changed afterwards. |

**A third capability was on this list and isn't any more.** `setTypeBookable` — publishing a kind
of work to the public page — is now a section on the **Work** screen under the selected kind,
gated on the booking module. The stand-in snippet is deleted.

**A fourth thing needs database access, and it isn't a debt.** Adding somebody to
`platform_staff` is a hand-run snippet (`supabase/snippets/add-platform-staff.sql`) —
deliberately, since a screen that adds a colleague would be a *staff write*, and D28's own trigger
to revisit that is unmet. Provisioning a tenant was the first staff write and it has landed (D29):
one `execute` on `provision_organization`, no table privilege.

With that snippet run, the booking half of the walkthrough is: Settings → set a URL name, switch
*Public booking* on, open `/book/{slug}` in a private window, take a slot with no account at all —
D22's external actor, a real `auth.users` row from anonymous sign-in, bound to exactly one
organization, holding insert permission on no table whatsoever.

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
| `ai-tools.test.ts` | A tool cannot write, and cannot read a row its caller could not — including with another business's id in its argument | Step 12 above, and the same question asked from two sides |
