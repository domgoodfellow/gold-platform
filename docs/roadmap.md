# Roadmap

Milestone **definitions**, not task lists — a milestone is done when its acceptance criteria are
demonstrably true. Status lives on the issue board and in `CHANGELOG.md`, never here (D9).

One issue per **vertical slice** — schema, domain, route, UI, guard, test — never one per layer.

---

## Order of work

A milestone number is identity, not sequence — cited across hundreds of documents, tests and
migrations, so it is never renumbered, only appended to. M11 sits above M9 in the list below and
runs before it; the number still means M11.

M0–M8 and M11 established the current platform foundation. The active pre-NextFund sequence is:

1. **M12 — catalogue, Plans, Subscriptions and Entitlements.**
2. **M13 — BusinessOS and reusable organization configuration.**
3. **M14 — provider control plane, proven through Voice**, enabling M9 without replacing it.
4. **M15 — Financial Operations boundary and migration.**
5. **M16 — Studio distribution.**
6. **M17 — platform hardening and GildOps dogfood gate.**
7. **M18 — NextFund migration and parity.**
8. **M10 — desktop**, still waiting on demonstrated demand.

Inside M12–M17, preserve this dependency order: normalize catalogue and commercial semantics;
ship platform catalogue/Plan controls; complete BusinessOS; harden provider configuration;
take Voice through the whole control plane; expose CRM configuration; separate Financial
Operations; apply the control-plane pattern to Email, SMS and Automation; finish public
distribution/media/legal/domain work; expose cross-cutting Insights, usage and cost; add provisioning health,
drift and retry; dogfood it; then prove migration readiness. Numbers remain identities, so M9's
front-desk outcome is completed through M14 rather than renumbered.

GildOps runs as an ordinary tenant (customers, work items, scheduling) alongside all of this and is
not itself a milestone — a field only our own pipeline wants is one caller, and building for one
is still refused.

---

## M0 — Founding documents

> **Done when:** `/scope` can be run against the first real slice and returns a named invariant
> and a decision record without the operator supplying either.

Closed the first time `/scope` was used in anger.

---

## M1 — The kernel

> **Done when:** two organizations exist in one database, each with its own users, customers,
> locations, and work items, and no query, index, or constraint belonging to one can observe or
> block the other — demonstrated by a test that creates colliding rows in both tenants and
> expects success. Those entities take per-tenant custom fields through `field_definitions`.

Covers: `organizations`, memberships and roles (including a second member joining one), tenant
resolution, RLS across every table, `Customer`, `Location`, `Asset`, `Work Item`, `Resource`,
`Document`, `Event`, `Field Definition`.

Enforces: **I1, I2, I3, I11, I12, I16, I17, I18**. `Event` ships with the first slice that writes
state, because it can't be backfilled.

- Every unique index and exclusion constraint leads with `organization_id` (I2) — the colliding-rows
  test exists to catch exactly this.
- Custom fields land with their registry, not after it (D7, D18).
- A membership must be exercisable by someone who isn't the founder, or the capability checks
  prove nothing (D19).

---

## M2 — The work engine

> **Done when:** an operator can define a work item type, its statuses, and its allowed
> transitions from the admin UI with no database access — and a work item moves through that
> lifecycle, consuming a resource for a window nothing else can double-book.

Covers: work item types and statuses as data, transition validation, assignment, the scheduling
core over Work Item and Resource, availability, checklists, time and cost capture.

Enforces: **I5, I6, I7, I8, I9, I10, I13, I20**. I7 is a database exclusion constraint — an
application-level overlap check does not satisfy this milestone.

Operating hours are configuration only: no seeded working week, no default. A business that has
configured nothing is treated as always open.

I8 and I10 belong here, not M3: a recorded **cost** is an observation about a job that already
happened, not a price (which is I4, M3's). Cost capture needs money columns without needing a
pricing engine.

---

## M3 — The configuration engine

> **Done when:** a new business can be stood up entirely through configuration — modules, roles,
> fields, statuses, forms, terminology, pricing rules, scheduling rules — with no migration and no
> deploy. Test: configure a second business shape without a pull request.

Covers: custom forms over field definitions, the price book and quoting from it, the interface.

Enforces: **I4**.

Dashboard configuration and a business-rules runtime were correctly cut (nothing yet to configure
or trigger). **Module enablement was cut by mistake** and shipped in M4 instead: it was argued as
needing "two pieces of evidence," which is the bar for an *engine*, not for a per-tenant switch
with callers on day one (`navigation.ts`, D21's partial-adoption pricing). D25 now pins the two
words apart so the mix-up can't recur.

Pricing rules shipped only as a catalogue-and-quantity — no rule engine (conditions, surcharges),
because nothing asked for one yet; a rule the catalogue can't express belongs inside
`priceWorkItem` (I4).

Terminology: a tenant already names its own things (statuses, roles, fields, display names) —
that's what "standing up a shape" means, and it shipped across M1–M2. What's *not* built is
overriding the platform's own nouns (Work Item, Resource, Customer) in tenant chrome. The second
vertical has now triggered that work; M13 owns its deliberate shape rather than retrofitting it
into this historical milestone.

The interface also lands here for the first time: an operator shell, real responsiveness, and
shared form components extracted at their third caller.

---

## M4 — Vertical one: a real business runs on the platform

> **Done when:** a real business runs its operations on GildOps — quotes or bookings in, work
> scheduled and assigned, completed, invoiced, paid — and nobody at that business has ever held
> database credentials.

Pneu3L is the evidence, not the subject: mobile automotive service, one owner-operator, Montreal,
CAD, `America/Toronto`, Stripe alongside cash. Its binding constraint is travel between jobs, not
job length — and the platform answer is `organizations.buffer_minutes`, a per-tenant number the
exclusion constraint reads, not travel-aware scheduling logic. It onboards fresh; its rows don't
migrate, only its configuration does (D1).

Everything Pneu3L needs sorts into exactly two buckets — a platform capability any business of
this shape would need, or configuration (Pneu3L's own data). There is no third bucket:
Pneu3L-specific code. Run `/scope` when a slice won't sort cleanly.

Covers:

- **The external-actor authorization axis** (D22) — booking, the customer portal, any embedded
  surface. A returning customer broke the plan to make every write an RLS permit policy
  (`customers_org_email_unique` collides with a read policy narrow enough to be safe), so the
  write side became one privileged function with a scope check instead — an outsider holds no
  insert grant on any table.
- **Booking and the customer portal**, unblocked once I5, I6 (M2) and I4 (M3) existed.
- **Quote → invoice → payment.** Stripe is the first vendor behind an adapter. **D26** moves
  `apps/api/` forward for webhook ingress (Python owns it, D2). **D27**: a tenant connects their
  own processor account; GildOps stores an account id, charges land on the business's own account, no
  customer money touches GildOps' balance — the thing that keeps this platform out of being a money
  transmitter.
- **Job economics** — revenue minus cost per job, the number an owner asks for first.
- **The customer timeline**, over `Event` (shipped in M1 for exactly this).
- **Editing and cancelling a work item.** Cancelling needed more than "a status the tenant
  configures": the exclusion constraint's predicate didn't know about status, so a cancelled job
  kept its resource booked. Fixed with `work_item_statuses.releases_resource` — a tenant question
  about their own word, not a platform `is_terminal` flag, because releasing a resource and
  marking work complete are two different questions (this recurs at M7).
- **Module enablement**, arriving late from M3 — see above.
- **The interface**, per D23, so M4 doesn't rebuild M3's screens the way M3 rebuilt M2's.
- **A business's own words on its public page** — one row of tenant copy, rendered at the top of
  any public surface. Not the marketing surface (no pages, no blocks, no theme).

**CRM ships here as a module, not an engine, and both halves matter.** The timeline lands now;
lifetime value, balance and last-contacted land in M9 over M7's aggregate layer. It's a module —
switched on, billed for, shown in navigation — with no `crm` directory owning entities, because
the timeline is a projection of `events` and the intelligence is arithmetic over existing rows. A
module with no engine is the normal case (D25).

**Three domain capabilities shipped with no operator path** — `setTypeBookable`,
`revokePortalInvite`, `assignRole` — which was a debt against this milestone's own criterion.
`setTypeBookable` is now paid: a section on the Work screen, gated on the booking module. The
other two remain, and `docs/walkthrough.md` names where an operator would hit them.

**Module enablement shipped inert once already** — every area belonged to a module marked
`required`, so the enable/disable filter could never remove anything. A required module is the
kernel misfiled: `Area.module` is now optional, and only what a business can genuinely decline
(`billing`, `assets`, `booking`, `portal`, `card_payments`) carries one. Switching `billing` off
now removes the quote/invoice/margin sections everywhere, not just the sidebar entry.

---

## M5 — The platform side

> **Done when:** somebody who runs GildOps — not a business on it — can see every tenant, what each
> has switched on, and what is failing, from a surface holding no membership in any tenant and no
> service-role key. And a business GildOps signs becomes a tenant because GildOps provisioned it,
> through the same `createOrganization` a self-serve door will call once M8 can do the configuring.

Staff are a Postgres role, not a fourth authorization shape stretched from the other three (D28):
a member is scoped by membership, an external actor by its own binding, a machine writer holds no
table grant — cross-tenant read needed its own shape, and the service-role client D14 refuses
would have faked it. "Admin" was already taken by the tenant operator surface (D20), so staff get
`/platform`.

Covers:

- The staff role and its policies — read-only across every tenant.
- The tenant list: who exists, what they've switched on, when they last did anything.
- **Operator-provisioned onboarding** (D29) — one of two doors onto one `createOrganization`, not
  an alternative to self-serve. A new organization is genuinely empty; handing that emptiness to
  an unattended stranger is not a product, which is what closes: `/sign-up` as an *unattended*
  door, not registration itself (an account still isn't a tenant).
- GildOps' own public site, distinguished at last from the tenant marketing surface D20 defers —
  this one is GildOps' own claim about GildOps.

Billing a tenant for what they've switched on is deliberately not here — a price is a number, and
D8 keeps numbers out of this directory.

**The fourth question — what is failing — is deferred to M6 on purpose**, not skipped: nothing in
the schema records a failure yet, so there's nothing to read. M6 closes it with a view over
`automation_runs` and `message_deliveries` rather than a new table, since automation is the first
thing this platform does that can fail with nobody watching.

Provisioning is a staff **write**, and it's the one write `platform_staff` gets: one
`SECURITY DEFINER` function (`create_organization`), no table privilege — the same shape as the
external axis's `create_booking`. I21 is the line this draws: staff may bring a tenant into
existence and may never reach into one that exists.

Creating a business and configuring one came apart here because the database wouldn't let them
stay together — `createRole` and everything after it are keyed to `app.current_tenant_ids()`, and
platform staff are a member of nothing. So GildOps creates, and whoever configures configures — D29's
own axis, arriving because nothing else was possible.

**Corrected by D45, stated here rather than left to mislead.** "Staff are a Postgres role" and
"the one write `platform_staff` gets" were both true when M5 shipped and are not true now: staff
are checked live (`app.is_platform_staff()`/`app.require_platform_staff()`), never a role a
session wears instead of `authenticated`, and there are now several staff-only writes, each its
own staff-checked function. What M5's own criterion asked for — read across every tenant, hold no
membership anywhere by default, write nothing belonging to a tenant that already exists — still
holds exactly as stated; only the mechanism holding it moved. See D45.

---

## M6 — Workflows, automations, and the channels they act through

> **Done when:** a business already live on the platform adds a second technician, writes a
> rule — *when the forecast at a job's location crosses this threshold, move the job and tell the
> customer* — and a forecast change reschedules the job and sends the message. No code change, no
> deploy.

Pneu3L again, as evidence rather than subject. One tenant, deliberately — a second tenant built to
need dispatch would make weather look like an engine, which D11 refuses: weather owns no entity
and no rule, it's a module a weather-dependent tenant switches on. Dispatch isn't something the
platform builds; it's what several configured resources and this runtime add up to.

Covers:

- **The workflow/automation runtime** — trigger, condition, action, branch. Needed a second caller
  to justify extracting it (a booking confirmation is the first, weather the second) — and there
  was in fact no first caller to absorb: M4 shipped no confirmation code at all, so a confirmation
  became a rule a business writes in its own words, not a platform sentence.
- **Four trigger shapes**, not three: schedule, external condition, counter threshold, and event —
  the last runs inside the transaction that caused it, which the other three can't do.
- **Weather** — an adapter plus tenant-written conditions (D11). Its one real prerequisite
  shipped: `locations.latitude`/`longitude`, with the first update policy that table's ever had.
- **Channels** — email, SMS, first outbound voice — each behind an adapter, delivery idempotent
  per recipient per reason.
- `apps/api` gains a scheduler (stood up in M4 for webhook ingress). Serverless, per D24 —
  nothing a worker daemon would hold, since anything surviving between runs lives in Postgres.

**The runtime lives in Postgres, the clock in Python** (D30) — forced, not chosen: a rule tripped
by a stranger's booking has no `app.current_tenant_ids()`, and a rule tripped by the clock has no
person at all. No action may search for a free slot — that's `freeWindows`, and a second one in a
second runtime is exactly what I5 forbids, so a reschedule shifts by a typed offset and the
exclusion constraint decides whether it lands.

`reviewAutomationRules` reads rules back to the business — a status nothing can move into, a
threshold in the wrong unit, two rules fighting over one moment — because a rule that never fires
produces no failed run and looks identical to a quiet week. Arithmetic on existing rows, no model
involved.

Not built: a wall-clock schedule (a report's question, no caller yet), conditions on a counter
rule (nothing to consult before a counter exists), a per-tenant sending identity, and chaining —
an automation may never trigger an automation, since a cycle and a feature look identical from the
rows.

---

## M7 — Reporting and dashboards

> **Done when:** an operator defines a report — entity, fields, filters, grouping, period — pins
> it to a dashboard, and shares it with a role, with nothing about that report or dashboard
> existing in code.

A dashboard is a saved report with a layout and an audience — one machinery, not two, or the two
aggregate layers disagree (the same failure I4 and I5 prevent one level up).

Covers: the aggregate layer, report definitions as per-tenant rows, the four dashboards
(executive, operations, manager, employee) as configuration rather than four screens, and the
operational and financial report sets.

`milestone-m7.test.ts` has a non-founder define a report, pin it, share it with a role in two
businesses sharing no word, then reads `lib/domain/reporting/` and fails on either tenant's word
appearing there. D35 and D36 hold the decisions: an aggregate is a Postgres function pinned to
`priceWorkItem` by a correspondence test; a saved report's audience is a policy.

**The operational report set is deferred, and two things this entry used to claim about it were
wrong.** Work completed *does* have a date (`events.occurred_at`) — what's missing is which status
the business calls finished, a tenant question rather than a platform `is_terminal` (same shape as
M4's `releases_resource`: Cancelled releases the resource and is not completed work — two
questions, not one). And *quoted* revenue needs no schema change (`work_item.line_added`/
`line_removed` already carry `occurred_at`) — it needs a decision between two different questions
(quoted *during* a period vs. quoted-and-unbilled *as at* a date), not a completion column.

**Utilisation**, split in two: `public.time_committed` (the numerator) is built — the third
expression of the exclusion constraint's own predicate, pinned by a correspondence test against
`listSchedule`. The percentage is not a deferral — its denominator is `freeWindows`, and a second
answer to *what is free* is exactly what I5 forbids. A business dividing committed time by its own
opening hours is arithmetic this platform didn't invent for it.

---

## M8 — The AI layer

> **Done when:** an operator can ask "what work is at risk of being late today" and "which
> customers haven't been contacted in thirty days," answered through the same domain tools a
> human uses, under that user's permissions — **and** can describe a business in prose and
> receive a proposed configuration, which a human reviews and applies.

Enforces: **I14**.

Every tool is a domain service that already exists; new business logic belongs in the domain
layer, and the tool is a caller. The two criteria share a milestone number, not a dependency, and
were built separately — the second went first, since asking about work needed no aggregate layer
(a tool is a `stable`, `security invoker` Postgres function under the asking person's own token,
per D34 — it can neither write nor see a row its caller couldn't, and can't hold an aggregate).

**Questions**: `public.work_at_risk`, `public.customers_not_contacted` (over `customer_activity`,
which the customer timeline also reads — a second caller for an inline rule, extracted rather than
copied); `agent_runs`, readable only by whoever asked; an `assistant` module and Ask screen; a
provider-blind loop in `apps/api` over a capability contract (Claude, or anything speaking chat
completions, for a business running its own model). An answer can carry one intended action,
recorded as pending, performed by nobody until a person presses a button — the loop itself writes
nothing and holds nothing that could.

**Onboarding**: `configuration_proposals` (prose, proposed `BusinessShape`, gaps, outcome), a
drafting adapter, a setup screen where a person reads, answers, edits, applies. Applying calls
`configureBusiness` unchanged. D32 holds three load-bearing decisions: the model holds no tool and
no database handle (I14 by absence, not by check); applying adds no capability, since every step
is already gated by an existing policy; a failed apply is recorded in the database's own words
rather than rolled back, since atomicity would mean a second configuration path.

It is not a business template — a template is a named bundle the platform ships; a proposal is
supplied by its caller and nothing in it is seeded. That deferral (business templates, waiting on
two businesses configured by hand) is unchanged.

`ai-tools.test.ts` reads the tool registry from the Python source and asserts from `pg_proc` that
every name resolves to a non-volatile, non-owner-run function, then asks the same question from
four angles — two tenants get their own words back and nothing of each other's, a portal customer
gets nothing from a tool their role can't reach, a member of nothing gets nothing. No model is
called in the test — what D34 decided is structural.

`milestone-m8.test.ts` drafts a full configuration for two businesses sharing no word, and asserts
both are still completely empty afterward — no path exists by which the draft could apply itself,
because the drafting capability holds no database handle. It also edits the reviewed proposal
before applying (proving review is real, not a rubber stamp) and reads both `configureBusiness`
and all three drafting-adapter files, failing on either business's vocabulary appearing in either.

---

## M9 — Vertical two: reception and sales

> **Done when:** a business can run its front desk on GildOps: call placed/answered, recorded,
> transcribed, analysed, attached to timeline, with proposed actions executed through domain
> layer.

Renamed from "Communications and the dialer," which described the plumbing rather than the
business function it serves.

This milestone buys a second host (D24): a call is a persistent media stream for its duration,
which serverless isn't. `apps/api` stays; a realtime deployment target sits beside it.

GildOps is a user of this milestone, not only its vendor — selling configured deployments to
businesses with no system is outbound calling, so GildOps switches the module on like any tenant,
in its own Organization Context, no exemption and no fork (D42, D45). The trigger to build is
call volume, not audience: thirty calls need a phone and a list.

Two-way email lands here too — the half of "communications" that isn't the dialer. Reading a
mailbox so a reply attaches to its job needs an authorization against somebody else's account,
refreshable tokens, and a matching problem with no perfect answer, which is why it waits for the
milestone that owns the front desk.

Customer intelligence (lifetime value, balance, last contact, next action) lands here too — the
first caller that needs a customer reduced to a number, over M7's aggregate layer.

Staged deliberately, each stage sellable alone: record → understand → assist → automate →
delegate. Live rebuttals and voice agents are the last two, not the first.

---

## M10 — Desktop

> **Done when:** the Electron build renders the same React components as the web app, with no
> forked UI, and adds only what a browser genuinely cannot do — device access, local printing,
> tray, hotkeys, headset integration.

Electron is another client, not another product, and it will be `@gold/ui`'s second real
consumer once it exists — `@gold/ui` itself was extracted ahead of that (D45), the day it had an
immediate consumer inside `apps/web`, per `constraints.md`'s own rule that a direct instruction to
build is itself a trigger. What M10 still waits on is Electron, not the package.

---

## M11 — The interface, second pass

> **Done when:** an operator can drive the whole application from a keyboard and always see where
> they are, no destructive action completes without a confirmation, and `ui-spec.md` §4's
> exception list is empty — demonstrated by a test that reads the screens and fails on a control
> spelled by hand, a control file with no focus treatment, and a destructive action with nothing
> between it and the write.

The first milestone appended to the original M0–M10 set — its prerequisite (the control set,
`ui-spec.md`) had already shipped, closing D23's last unpaid bullet.

Closed:

- **Focus** — a shared `FOCUS_RING` (in `class-names.ts`, not copied per file) on `Button`,
  `ButtonLink`, `Disclosure`'s `<summary>`, and every nav link.
- **Confirmation** — `containers/dialog.tsx`, the platform `<dialog>`; `ConfirmSubmit` opens it
  and its Confirm button submits the *original* form via the native `form` attribute, so none of
  the ten replaced call sites needed their server action or `useActionState` wiring changed.
- **The tablet rail** — `org-shell.tsx` had one breakpoint, so tablets got the desktop sidebar.
  Now icon-only between `md` and `lg`, icon-and-label from `lg`, over the same `AREAS` list.
- **Cards and sheets** — already shipped before this milestone opened.
- **A seventh §4 exception** this list had missed: `global-error.tsx` can't load `globals.css`
  (Next skips it on a root-layout failure), so its retry button is inline styles for a real
  reason.

Demonstrated by `milestone-m11.test.ts`: no raw `<button>`/`<select>` under `app/`, every shared
control file contains `focus-visible:ring`, and every `delete`/`remove`/`revoke`/`cancel` action
has a matching `ConfirmSubmit`.

Goes before M9 for D23's own reason, reused: M9 is a new family of screens, and building it over a
control set with no focus states or confirmations repeats the M3-into-M4 mistake at a larger size.

Per-tenant theming and `packages/ui` are now built. `globals.css` remains the executable
token definition rather than gaining a second design-tokens document.

---

## M12 — Catalogue, Plans, Subscriptions and Entitlements

> **Done when:** platform staff can define the canonical Product → Module → Feature catalogue,
> package reusable Plans and Add-ons with allowances, activate an organization's Subscription,
> and both platform staff and the organization can inspect the same resolved Entitlements and
> Limits without SQL or environment edits.

This milestone proves catalogue and entitlement **resolution**, not universal write enforcement.
Normalize/reuse current `platform_products`, modules and commercial terms deliberately rather
than creating a parallel entitlement system. Entitlements remain separate from RBAC capabilities.
Resolution follows platform hard limits,
Plan allowance, Add-on allowance, organization override, user/concurrency limit and provider
operational limit. Existing effective-dated price and usage history remains attributable.

## M13 — BusinessOS and reusable organization configuration

> **Done when:** an administrator can establish shared business identity, positioning, audience,
> offerings, voice and operating context once, and every applicable Product that needs that
> context consumes the authoritative BusinessOS representation rather than maintaining a
> duplicate. At least two independent Product surfaces must prove the shared-context path.

Extend existing Organization, profile, brand, hours, work-type and site owners. Include
terminology and reusable business setup where evidence has made their shape concrete. Keep
Business Offerings separate from Financial Operations' Price Book.

## M14 — Provider control plane, proven through Voice

> **Done when:** platform staff can provision, inspect, diagnose and remediate the capability,
> binding and resources behind an entitled organization's Voice service, and that organization
> can place or receive a call through those resources with Usage, Cost and Health recorded—all
> without SQL, environment editing or the Twilio console.

This proves the provider control plane using the chain Catalogue → Communications → Voice →
Features → Plan/Add-on → Subscription → Entitlements → organization Voice configuration →
provider capability → Twilio binding/resources → runtime → Usage/Cost/Health. It does **not**
mean “Voice is finished”: M9 alone owns recording → transcription → analysis → timeline →
proposed domain action, and depends on M14's operable provider path. The current call,
conference, callback, recording metadata, binding and usage foundation is the starting point.
M14 proves the reusable provider contract through Voice; M17 owns applying the proven pattern
across Email, SMS and Automation. Local-model bindings remain Platform Context only in this
phase.

**The speech providers are the next concrete callers, and their shape is proposed here, not built.**
ElevenLabs and Deepgram are catalogued as providers with no services, no account adapter and no
credential path, and the Providers screen says so (`lib/domain/providers/stages.ts`). The services
worth seeding are only the ones GildOps intends to use: Deepgram *transcription* and *realtime
speech to text*; ElevenLabs *text to speech* and *voices*, and a conversational service only if
that is actually intended. Neither needs the AI Runtime assignment table, which is a *model*
choice (`operator_assistant`, `public_assistant`, `configuration_drafting`): transcription, text to
speech, realtime voice and embeddings are different capability dimensions, and generalizing that
table is justified when one of these is a real caller, not before. The first slice per provider is
an account adapter (verify a credential), then one service, then the assignment dimension it needs.

## M15 — Financial Operations boundary

> **Done when:** a tenant can price, quote, invoice and record or collect payment from its own
> customers through Financial Operations while GildOps independently manages that tenant's Plan,
> Subscription, usage and charges through Plans & Billing; the two flows use separate ownership,
> payment/provider bindings and ledgers, and neither can mutate or settle the other's financial
> records.

Preserve the existing `billing` and `card_payments` persistence keys during migration.
Scope richer pricing rules, discounting, taxes, acceptance, refunds and accounting integrations
from evidence rather than treating the Product boundary as proof they are built.

## M16 — Studio distribution

> **Done when:** an organization can publish its approved site to its own resolved hostname with
> governed media, required legal pages, correct public authentication context and attributable
> booking/form actions.

Build from the revision and publishing foundation. Domain verification, routing, asset
ownership, preview/publish states, legal content and public-to-tenant attribution must be
observable and recoverable.

## M17 — Platform hardening and GildOps dogfood gate

> **Done when:** GildOps runs an ordinary fully-entitled, fully-metered Subscription and routine
> catalogue, provisioning, configuration, health, drift, retry, usage, cost and support work can
> be completed through product controls without Claude, VS Code, GitHub, Supabase Studio, manual
> SQL, provider consoles or environment editing.

Every applicable optional Product/Module must follow Plan/Add-on → Entitlement → navigation/UI
availability → domain/server authorization → database write enforcement at its consequential
write boundaries. A direct RPC or automation may not bypass a missing entitlement. Demonstrate
failures and retries, entitlement/permission/quota/provider-limit behavior, and migration
rehearsal with audit evidence. Remaining CRM self-service, two-way Email, terminology,
cross-product configuration, Insights and usage visibility gaps are complete only insofar as
this externally observable gate requires them. Normative documentation must also encode D68's
workspace model and clearly separate target architecture from current implementation; migration
readiness cannot be declared while governing documents direct work toward a superseded
Sales/Service/Insights workspace model. This is the pre-NextFund hardening gate.

## M18 — NextFund migration and parity

> **Done when:** NextFund's source data and indispensable workflows are inventoried, mapped,
> rehearsed, reconciled and cut over with rollback evidence, and the reason to switch is measured
> without introducing a customer-specific fork.

M18 cannot start as a production migration until M17 passes. Gaps discovered in rehearsal feed
the reusable Product and migration model; they do not bypass it.
