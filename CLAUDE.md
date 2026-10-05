# CLAUDE.md

The operating contract for this repository: how to work, what to run, where things go, and the
rules that hold in every change.

**This file points; it does not explain.** Depth lives in `docs/` and in the migrations. When a
section here starts explaining the domain instead of pointing at it, move it and leave a link.

Present tense only. *Why* a decision was taken belongs in `docs/constraints.md`. *What changed*
belongs in `CHANGELOG.md`. Neither belongs here, and the day they arrive here there are three
tellings of one thing and no way to tell which is stale.

## How to work here

- **Ask the question out loud before answering it.** What is the good practice here, how does it
  translate to this platform, and why this way rather than the other one? Show the question, not
  only the conclusion.
- **Look at what is there before proposing what should be there.** What does this screen show
  today, how is it built, and what would be better? Measure it rather than assuming it.
- **Say when something is wrong.** A document that no longer matches the code, a screen that
  repeats itself, a rule with nothing enforcing it — name it rather than working around it.
- **Thin and sharp, and many blades rather than one blunt one.** A rule is one line. If it needs a
  paragraph, the paragraph goes in `docs/constraints.md` and the line here points at it.
- **Simple first.** The plainest thing that does the job, and no structure built before something
  needs it.
- **Look at it before saying it works.** A change to anything a person sees is not done until it
  has been opened in the running app on `pnpm demo` data and screenshotted — at desktop width, at
  the 320px rail if it lives there, and in the state a machine with a provider left unconfigured
  lands in. Source-scanning tests prove a rule, not a screen. Say which of the two you did; never
  report a screen as working from a passing test alone.

## The documents

| Document | Read it when |
|---|---|
| [docs/vision.md](docs/vision.md) | You need to know what this product is and refuses to be |
| [docs/market.md](docs/market.md) | You need to know who buys it, why, and what they pay for |
| [docs/constraints.md](docs/constraints.md) | Before any structural change — holds every decision already taken |
| [docs/domain-model.md](docs/domain-model.md) | You are touching business logic, schema, or auth |
| [docs/roadmap.md](docs/roadmap.md) | You are deciding whether something belongs now |
| [docs/walkthrough.md](docs/walkthrough.md) | You need to drive the running application by hand |
| [docs/ui-spec.md](docs/ui-spec.md) | You are building or changing a screen |
| [docs/testing.md](docs/testing.md) | You are adding, classifying or running a test |
| [docs/public-web-architecture.md](docs/public-web-architecture.md) | You are touching GildOps' site, tenant publishing, public auth, domains, media or legal pages |

`docs/starting_conversation.txt` is an archived source, not a governing document. It is
superseded by `docs/constraints.md` wherever the two disagree.

**Status is not tracked in markdown** (D9). Milestone criteria are in `docs/roadmap.md`; shipped
work is in `CHANGELOG.md`. Do not add checklists to documents, and do not add a running account
of what was built to this one.

## Current state

The Foundation and M1–M8/M11 slices are substantial: tenancy and RBAC, shared business records,
work and Scheduling, tenant Pricing/quotes/invoices/payments/job economics, Automations, reports,
Ask and guided setup, provider callbacks, platform administration, invitations and support
audit, shared UI packages, tenant theming, record surfaces, and the typed public-site
revision/publishing foundation.

The present commercial persistence is flatter than the target model. `platform_products` are
sellable recurring line items, commercial terms record paid periods, wanted-intersection-paid
module state is computed, effective-dated rates and usage/cost ledgers exist, and Twilio has the
deepest provider binding/resource/provisioning path. They are not yet the canonical
Product/Module/Feature catalogue, reusable Plans/Add-ons, Subscription lifecycle, resolved
Limits, or a fully enforced entitlement plane. Entitlement resolution is generalized; write
enforcement is proven for `card_payments` and, at the point of spend, for AI requests (the Agent and guided setup, D83). M17 requires every applicable optional
Product/Module to enforce Plan/Add-on → Entitlement → UI → domain/server → database write
boundaries before migration readiness. Voice is the primary usage writer.

M9 is not met. Calls, conferences, participant/events, inbound/outbound/status/recording
callbacks, provider resources and recording metadata exist. Transcription, analysis, attachment
of that analysis to the timeline, the reviewed domain-action loop, browser softphone and
realtime voice agent do not yet form the required end-to-end front desk.

The remaining active work is M12–M18: catalogue and commercial normalization, BusinessOS,
provider and Voice hardening, Financial Operations separation, tenant public distribution, and
a platform-hardening/dogfood gate before NextFund migration. `domain-model.md` owns the
canonical terms. `roadmap.md` owns the sequence and criteria.

Target architecture and current navigation are separate facts (D68). The target operator
workspaces are CRM, Communications, Marketing, Support, Finance, AI, Automations, Field and Studio.
Current navigation exposes CRM through the legacy `/sales` Home route; Marketing and Support are
registered without empty rows; AI has no Home; and Insights retains deep routes while being
cross-cutting rather than a workspace. Library has a shell — Home and seven empty-state
destinations (Files, Media, Templates, Knowledge, Collections, Sources, Trash) — but no
organization-level collection behind any of them yet; only record-attached Documents exist today.

One domain/runtime capability has no operator UI: `browserTelephoneToken` — the token boundary
exists, but no browser softphone consumes it yet (M9/M14). Resource has no domain-level document
relation. Keep these gaps explicit.

`supabase/migrations/` is the source of truth for the data model. Read it rather than
inferring the schema, and comment the *why* rather than the *what*.

## Commands

**The gate is `pnpm check`, from the root.** Nothing is finished until it passes end to end.
Report a failure verbatim; do not summarise one.

| Command | What it does |
|---|---|
| `pnpm check` | The gate. Both runtimes: `apps/web` typecheck, lint, test, build, then `apps/api` pytest. |
| `pnpm --filter @gold/web check` | The TypeScript half alone, when iterating |
| `pnpm check:api` | The Python half alone (`python -m pytest apps/api/tests`) |
| `pnpm check:fast` | The gate without a database: typecheck, lint, `test:fast`, build. What a change with no schema or RLS in it can iterate on |
| `pnpm test:<tier or category>` | `fast`, `local`, `unit`, `component`, `architecture`, `architecture:db`, `db`, `contract`, `api`, `e2e`, `smoke`, `provider`. Never the gate; `docs/testing.md` says what each runs and needs |
| `pnpm --filter @gold/web dev` | Next.js dev server on :3000 |
| `pnpm demo` | Two populated businesses, in one command. Localhost only; refuses a database that already holds organizations (D37). |
| `pnpm demo:fresh` | `db:reset` then `demo`. What you want after a walkthrough. |
| `pnpm db:start` | Local Supabase (needs Docker). Prints the keys; they belong in `.env.test`, which is gitignored. |
| `pnpm db:reset` | Re-apply every migration from scratch against the local stack |
| `pnpm db:types` | Regenerate `apps/web/lib/db/database.types.ts`. Checked in; a stale one fails the gate (D15). |
| `pnpm db:push` | Apply migrations to the linked remote project |

`@gold/*` is the current live package namespace and these commands must remain operationally
accurate. D69 records the atomic `@gildops/*` migration target; do not pre-rename documentation or
imports ahead of that migration.

- Every test file is classified once in `test-manifest.json`; an unclassified one fails the gate. Python tests need `pip install -r apps/api/requirements-dev.txt`.
- The tests talk to a **real Postgres with real RLS**, as two genuinely signed-in users. A policy
  cannot be proven by a fake, and a service-role client would bypass the thing under test.
  `pnpm db:start` must be running.
- `apps/web` needs `.env.local` — copy `apps/web/.env.example` and configure
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. **Nothing in
  `apps/web` may hold a service-role key.**
- A change to `supabase/config.toml` needs the stack **restarted, not reset**:
  `npx supabase stop`, then `start`. `db:reset` re-applies migrations against the
  running containers and does not re-read that file.
- Standalone SQL — diagnostics, repairs, helpers — goes in `supabase/snippets/`, never in
  `migrations/`, where it is either mistaken for schema or applied by accident.
- `apps/web/scripts/demo/` calls the domain layer through `@/`, so the gate reads it and a changed
  domain signature breaks the build. `run.ts` holds no branch on which business it is building;
  everything that differs lives in `businesses.ts`.
- `next dev` writes `apps/web/AGENTS.md` and `apps/web/CLAUDE.md`, and re-adds them if deleted.
  They are gitignored, not ours, and not project instruction. Their one true claim: Next 16
  diverges from model training data, and `apps/web/node_modules/next/dist/docs/` is the
  version-correct reference.

## Layout

Nothing is created before a slice needs it.

```text
apps/
  web/              Next.js — every surface a browser reaches, grouped by whose it is (D20)
    app/            routing, route handlers, server data loading and screen composition
      (marketing)/  GildOps' own site, in GildOps' voice
      (auth)/       sign in, sign up
      (public)/     book/{slug}, portal/{token} — a tenant's customers, a tenant's words
      organizations/ the operator shell. Deliberately UNGROUPED — see below. Platform Administration is
                    organizations/[organizationId]/platform/, a sub-scope of GildOps' own organization (D60)
      platform/     the old /platform address: a redirect to the nested one, and nothing else
    features/       product-capability presentation and interaction — see its README
    components/     generic composed app controls and containers
    lib/domain/     the business rules. Nothing in app/ or features/ decides anything
    lib/adapters/   vendors. Domain code imports the capability, never the implementation
    scripts/demo/   the demo builder. Covered by the gate on purpose (D37)
    proxy.ts        Next 16's middleware. Refreshes the session; not the auth boundary (I12)
    tests/          the suites, by level: unit, component, architecture, integration/database — see docs/testing.md
  api/              Python. Provider ingress, automation clock, AI loop and a narrow domain layer; Vercel serverless
    api/            physical HTTP entrypoints — one file per handler
    app/core/       configuration, database handles, the one place a machine token is minted
    app/domains/    a named, narrow set of commands reachable from more than one caller (D2, D51). Not a second `lib/domain/`
    app/ai/         the tool loop and its two registries. No SQL, no arithmetic
    app/channels/   sending a message to a person, as a capability
    app/conditions/ what the world is doing at a place, as a capability
    app/providers/  the infrastructure GildOps operates (Twilio, Stripe, Resend, model vendors) — the only place Python names one
    app/connectors/ the outside apps a business authorizes (OAuth handshakes); never a provider
  desktop/          Electron shell (M10; not before)
packages/           each with a real, immediate consumer inside apps/web (D45); packages/sdk stays deferred
  types/            ContextDescriptor and the other cross-cutting shapes — never Capability, which stays the domain layer's
  schemas/          Zod validation for forms — a better error message, never a second authorization
  ui/               shadcn primitives, subpath-exported (@gold/ui/components/<name>), never one barrel
  config/           shared tsconfig and non-secret static identifiers only — no mutable configuration, ever
supabase/           migrations, policies, snippets
docs/
```

- `apps/` means a deployable this repository ships. `pnpm-workspace.yaml` names its members rather
  than globbing, so pnpm never tries to manage the Python one; a new package adds itself by name
  (D3).
- A shared package needs demonstrated consumption, not speculative reuse. Multiple product
  surfaces inside one deployable count as consumers when they use the same generic responsibility;
  one surface still does not buy a build step and a `dist/` for no isolation.
- **No `src/` under `apps/web`**, and none may be re-added. `@/*` resolves to `apps/web/*` in
  `tsconfig.json` and `vitest.config.mts` — two files, and they must agree.
- **No `api/` directory under `apps/web`.** The API is `apps/api` (D26).
- **A route group is a layout boundary and never a security boundary.** `proxy.ts` decides what an
  anonymous caller may open, by path, and a group does not change a path.
- `organizations/` is ungrouped because `navigation.test.ts` scans `[organizationId]/` for areas,
  and a group folder would hide its children from that scan.
- **Organization context is the normal operating context, and there is one shell.** What a person
  sees is projected by `projectShell` from the organization's entitlements, the member's
  capabilities and — in GildOps' own organization only — their `platform_staff.capabilities`. Platform
  Administration is `/organizations/{goldId}/platform/**`; the address names the context an operator
  is working in and never who owns the data, which stays platform-scoped (D60). GildOps holds no
  exemption (D42, D45), and `platform_staff` is a table checked live (D45, D59).

## Rules that hold in every change

The full set is `docs/constraints.md`. These are the ones generated code breaks most often.

- Business logic lives in the domain layer. Not a component, not a route handler, not a server
  action, not an AI tool. Callers call; they do not decide.
- A second caller of an inline rule extracts it first, then calls it twice. Never copy it.
- Every tenant-owned table carries `organization_id`, has RLS keyed to it, and leads every unique index
  and every exclusion constraint with it (I2). This is the thing that has broken a prior repo.
- A caller is one real use in the same change — a screen, a route, a domain function, an operator
  who needs it Monday — never a second existing call site; that bar is for extracting a function,
  not for writing one. Once a multi-slice plan is approved, each slice is that caller for the
  column, table or abstraction it calls for: build the canonical shape for its first real use
  rather than a narrower stand-in, and do not wait for a second consumer that was never the bar
  (`docs/constraints.md`, "Rules that keep the code sane").
- Nothing is hardcoded that a business might want different: statuses, terminology, prices, hours,
  currency, buffers, the working week, a starter catalogue, a dashboard.
- Nothing a business has not said is filled in on its behalf, and *has not said* is a state the
  schema can hold. `organizations.currency` is nullable for that reason: signing up does not ask,
  and a `default 'EUR'` would have been the platform answering through a column.
- A question is asked where its answer means something. A currency belongs on the pricing screen,
  not on the form somebody meets ninety seconds after registering.
- A table-wide `grant insert`/`grant update` is a promise about every column that table will ever
  have. A migration adding a column the caller must not write has to `revoke` and re-`grant` by
  column. Found twice, both times where two migrations were individually correct and each assumed
  the other had it covered; a comment claiming otherwise does not make it so.
- Money is integer minor units. Time is `timestamptz`.
- A vendor belongs behind an adapter. Domain code names capabilities, never providers.
- An LLM gets domain tools with validation and permissions attached, or it gets nothing.
- What a caller agreed to is copied onto the row, never joined to (I8). There are two deliberate
  exceptions and both are listed below.
- A **Product** is a customer-facing family; a **Module** is a coherent area inside it; a
  **Feature** is a concrete capability; Plans and Add-ons package them; a Subscription resolves
  to Entitlements and Limits. An **engine** is technical ownership of a load-bearing calculation
  or runtime. Name the noun before applying a rule to it (D25, D46).
- Scheduling alone owns time/resource commitment. Booking, Maintenance and Dispatch are policies
  and interfaces over it; only an independent geographic route/travel optimizer may earn another
  engine.
- **A direct instruction to build something is evidence on its own.** The two-pieces-of-evidence
  bar exists to stop an engine being invented speculatively, ahead of real use — not to make the
  owner argue with his own documents. Told to build it, build it, and update the row it closes
  out in `constraints.md`'s "Decided, not yet built" table in the same change.

## The load-bearing absences

Each row is something that is **not** in this repository and must not be added. The absence is the
enforcement, and what brings it back is somebody adding what looks like a convenience. `Held by`
is what fails if they do. **An empty cell is an intention, not a guarantee** — the same backlog
`domain-model.md` keeps in its `Enforced by` column.

### Scheduling and the work engine

| Never | Because | Held by |
|---|---|---|
| An overlap check in the domain layer | A check before an insert races identically (I6) | `work_item_resource_assignments_resource_not_double_booked`, a partial gist exclusion on each assigned resource's derived occupancy; `scheduleWorkItem` does not look before it writes |
| A second answer to *what is free* | `freeWindows` is the one calculation (I5) | `listSchedule`'s filters are the constraint's predicate written as a query, and `time_committed` is the third expression; `availability.test.ts` and `reporting.test.ts` fail on any disagreement |
| A write to `work_items.status_releases_resource` | It is a maintained cache, not a snapshot — the deliberate exception to I8, and what makes cancelling free the resource | In no column grant for insert or update; two triggers own it |
| A platform-owned `is_terminal` | Releasing a resource and marking work complete are two tenant questions; one flag could not say both | `releases_resource` and `marks_complete`, both tenant-answered |
| A default working week | A seeded Monday-to-Friday is hardcoded business hours wearing a default's clothing | No seeded hours; a business that has configured none is treated as always open |
| An unconstrained work item type | A type with no configured transitions is frozen, not free (I13) | `app.check_status_transition`, a trigger; the domain layer re-checks only to produce the message |
| A per-column rule in the update policy | A policy sees the old row or the new one, never both | `app.check_work_item_update_capability`, a trigger beside the policy |
| A checklist template joined to a job | Copying is what makes editing a template safe (I8) | The template is copied at creation |
| Customer booking policy inside the feasibility engine, or binding staff scheduling | *May a customer book this* and *can the resources do it* are two questions, and staff are asked only the second (I86) | `feasibility.ts` imports nothing of `lib/domain/booking`; one evaluator and one reader in `policy.ts`; the commit reasserts it (`GD017`); `booking-policy-boundary.test.ts`, `booking-policy.test.ts` |

### Pricing and configuration

| Never | Because | Held by |
|---|---|---|
| A second total | `priceWorkItem` is the price calculation (I4). A total looks like formatting and is pricing; a rule the catalogue cannot express belongs inside that function | `jobEconomics` calls it rather than totalling lines |
| A foreign key from `work_item_priced_lines` to `price_book_items` | The first `join price_book_items`, written for a perfectly good reason, makes every historical quote track today's catalogue (I8) | `prices.test.ts`, from `pg_constraint` |
| A job quoted in two currencies | A business that changes what it trades in has a catalogue in two, because amounts are never converted | `work_item_priced_lines_one_currency`, a gist exclusion on `currency with <>` |
| A currency conversion | A rate has a date, and a date makes this accounting software | `jobEconomics` returns a null margin, and the screen says so |
| An edit to `field_definitions.kind` or `key` | It reinterprets or orphans every value already stored under that key, and surfaces later on an unrelated write | The column grant refuses both, by any path |
| A custom field holding a reference, an amount, a file or a formula | A foreign key inside JSONB is one no constraint can see, and the other three each duplicate an axis that already has policies over it (D7) | Six kinds and no seventh; `app.check_custom_fields` validates each, and a kind with no branch there cannot be defined |
| A stored total | No `subtotal`, `revenue` or `margin` column, and no materialized view (I4) | Nothing stores one; nothing has yet measured a slow query |
| A branch in `configureBusiness` | A branch on business shape is the per-client app studio arriving as a helper | `milestone-m3.test.ts` reads its source and fails on any tenant's word |
| Creation inside `configureBusiness` | Everything after the first step runs against policies keyed to `app.current_tenant_ids()`, and staff are a member of nothing (D29, I21) | Provisioning and configuring are two acts by two parties |

### Automation

| Never | Because | Held by |
|---|---|---|
| A rule that triggers a rule | Chaining is a feature and a cycle is an outage, and the rows cannot tell them apart | Both triggers return immediately when `app.acting_automation()` is already set |
| An action that prices, or that finds a free slot | It would be a second `priceWorkItem` or a second `freeWindows` in a second runtime (I22, I4, I5) | No such action exists; a reschedule shifts by a typed offset and the exclusion constraint decides whether it lands |
| Removing a rule's `exception` block | It is a savepoint. Without it a rule a business wrote badly can fail a customer's booking, which is the worst failure available here | Each rule runs in its own subtransaction |
| A foreign key from `automation_runs` or `message_deliveries` to what produced them | What happened must survive the rule being renamed or deleted (I8) | Both snapshot the name |
| A word the platform adds to a message | Five placeholders and no other contribution — no greeting, no signature, no footer (I24) | The tests compare whole bodies rather than fragments, because a footer is what a `toContain` would miss |
| A unit conversion | A weather rule written in one unit takes no notice of a reading in another | Units are compared |
| A caller setting `app.acting_automation()` | It is what lets a rule write past the per-column capability guard | Set only by `app.run_automation`, on a transaction-local setting; PostgREST issues no `SET` |

### Reception

| Never | Because | Held by |
|---|---|---|
| A carrier credential in a settings form | D39: what a business stores is an identifier, and an identifier grants nothing on its own. A token would need rotating and revoking, which D27 already refused for payments | `telephony_settings` holds one nullable number and no secret; `reception.test.ts` proves the policy refuses a role without `organization.manage` |
| A call leg written by somebody signed in | A leg is created when a telephone rings and changed when the carrier says so; a person typing one invents a call that did not happen | `call_participants` has a select policy and no other; every write goes through `record_call_event` |
| A second ending on a call that already ended | A carrier retries a delivery it thinks was not acknowledged, and the same *completed* arrives three times | `call_events_org_payload_hash_unique`, and a status that only ever moves forward into a terminal one |
| A callback naming its own organization | A webhook that could name a tenant could name somebody else's | `record_call_event` derives it from the call the carrier's identifier already belongs to; `voice_webhook` holds no grant on any table |
| An unsigned callback accepted | Anyone who learns the URL could write calls into a business's record | `verify_signature` over the URL and every parameter; a missing signature is a refusal, not a skip |
| A word the platform speaks to a caller | What a customer hears belongs to the business (I24), and an unrouted number does not even say whose it is | `voice_inbound` declines rather than improvising |
| A signed-in write to an email message's status, provider id or delivery time | A client that can set what the provider answered can mark its own mail delivered; only the runtime that asked the provider, or the provider itself, knows | `messages_insert`/`messages_update` exclude `requested_transport = 'email'`; `claim_email_for_send`/`record_email_send_result` are `provider_operator`-only and `record_email_event`/`record_inbound_email` are `tenant_email_webhook`-only (I71, I72); `email-channel.test.ts` |
| A conversation found by subject, sender or a provider's thread id | Those are what two unrelated mails share; a thread is what the mail says about its own ancestry, inside one business and one address | `app.resolve_email_thread` matches `In-Reply-To`/`References` against Message-IDs under `(organization_id, email_identity_id)`; `email-channel.test.ts` (I72) |
| Received HTML or a received file handed to a screen as it arrived | A stranger's markup runs inside a signed-in application; a stranger's file is never scanned | `sanitizeEmailHtml` is the only path to `safeHtml`; attachments are served only as opaque downloads under the owner's folder (I73); `email-content.test.ts`, `communications-foundation.test.ts` |
| A conversation's status, assignee or customer written by a table grant, or an assignee that is a user id | Who is handling a conversation, and whether it is closed, are facts others read and act on; a column anybody who can read can also set, or an assignee outside this business's membership, would make them guesses | No column grant exists for them; `claim_conversation`, `assign_conversation`, `release_conversation`, `set_conversation_status` and `link_conversation_customer` check authority and what they point at and write the event; `assignee_membership_id` is a tenant-leading key to `memberships` (I74); `inbox.test.ts`, `inbox-boundary.test.ts` |
| A text's status, carrier id or delivery time written by the sender's session, or a carrier callback applied out of order | A sender that can set what the carrier did can mark its own text delivered, and a late `sent` that undoes `delivered` is a state nobody can trust or bill from | `messages_insert` accepts only `queued`; `messages` has no update grant; `record_sms_send_result` refuses delivered/read/undelivered; `app.advance_sms_status` is forward-only for every writer; the carrier's words are translated in `app/providers/twilio/sms.py` (I76); `sms-lifecycle.test.ts` |
| A customer created, edited or guessed for a stranger because they wrote in | Communications associates a conversation with CRM context; it does not own identity, and two customers sharing a number are two candidates, not one answer | `app.resolve_customer` returns a customer only when exactly one in the organization holds the normalized contact point; the only creation is `createCustomerFromConversation`, which calls CRM's `createCustomer` on a person's request (I75); `inbox.test.ts` |
| A sender address supplied by a client | A `From` a browser chose is a number or an address the business may not own; one value naming the sender is the rule, and it is the resource's id | `resolveSmsSender` and `resolveEmailSender` derive the address server-side from a tenant-scoped id; `sendMessage` has no `fromNumber`; `communications-foundation.test.ts`, `messaging-sender.test.ts` (I70) |

### Commercial

| Never | Because | Held by |
|---|---|---|
| A rate or a term written by a general table grant | D40's rule, restated: staff hold no `insert`/`update`/`delete` on any table. A rate or a term is a narrow `SECURITY DEFINER` function's job, checked and audited, never a grant somebody widens later | `platform_provider_rates`, `platform_retail_rates`, `organization_commercial_terms` hold no such grant for any role; `public.record_provider_rate`, `public.record_retail_rate`, `public.record_commercial_term` are the only doors — `execute`-granted to `authenticated`, each staff-checked internally by `app.require_platform_staff()` (D45) |
| An RLS policy that reads entitlement | D25 surviving the arrival of money: a module is billing and navigation, never authorization, and a lapsed term must never become an access-control decision | No policy anywhere selects from `organization_commercial_terms`; the refusal is `app.check_module_entitlement`, a trigger |
| GildOps' own provider cost, a reconciliation, or the margin either implies, reaching a tenant | A business is entitled to know what it is charged, never what it costs GildOps to serve it or who GildOps used | `platform_provider_rates` and `usage_cost_reconciliations` have no grant to `authenticated`; `usage_events`'s grant to `authenticated` omits `provider_key`/`provider_currency`/`provider_cost_micros`; `public.organization_commercial_summary` and `public.organization_usage_detail` are `security definer`, staff-checked internally, and never reachable through the withheld columns any other way (D45) |
| A platform table readable by every signed-in caller by default | A booking visitor is `authenticated` (D22). A table is vocabulary, commercial configuration or control plane, and only vocabulary is for everybody (D64) | `catalogue-visibility.test.ts` proves each class from both sides against real row counts; the Stripe price mapping is reached only through `plan_price_provider_reference` |
| Tenant Finance reading the commercial plane, or branching on GildOps' own organization | Finance is customer → business money; what a business buys from GildOps is Settings → Plan & usage and GildOps' own control plane is Platform. A Finance Home showing a Plan, subscription or allowances is the plane collapse (D68) | `finance-boundary.test.ts` reads the imports of `features/finance`, `lib/application/finance` and the Finance routes; Plans & Add-ons and portfolio economics are `PLATFORM_DESTINATIONS` behind `platform.commercial`, and `/finance/plans` and `/finance/economics` only redirect |
| A recorded amount below one minor unit | I10 | Only a *rate* (price per unit) carries micro-minor-unit precision; every disclosed total still rounds once, at render |
| A second retail price list, or a price keyed to a channel | Retail usage pricing is meter-based and effective-dated in `platform_retail_rates`; communications are consumers of it, not a pricing engine (D40, D43) | `usage-boundary.test.ts` asserts no `communication_rates` and no function keyed by a channel; `usage-economics.test.ts` proves resolution by meter, currency and moment |
| A usage event written by anything but `app.record_usage` | Callers report usage; one function decides what it is worth, from the rates in force when it occurred, and refuses provenance that could not be true (I59, D65) | No role holds insert on `usage_events`; `usage-boundary.test.ts` finds no other inserter; composite foreign keys keep a binding, resource, account or rate to its own business, provider and meter |
| A provider named on a meter | Two providers may answer one meter (Deepgram or ElevenLabs, both `transcription_seconds`); a meter that named one could not express the second | `platform_meters` carries no provider column; `platform_provider_rates` is keyed by `(provider_key, meter_id, currency, effective_from)` |
| A provider cost subtracted from a charge in a different currency | Nothing converts, and a guessed margin is worse than none (I10, restated for GildOps' own books) | `organization_commercial_summary` returns `margin_minor` as null whenever the two currencies disagree and the cost is not exactly zero |
| A reconciliation that adds quantity or a customer charge | It would duplicate a fact `usage_events` already recorded once | `usage_cost_reconciliations` has no quantity column and no customer-charge column at all |
| An RLS grant on `payment_requests`/`payment_accounts` for the external axis | D22's rule, one axis over: an external actor holds insert on exactly one table, its own binding — a customer paying their own invoice is a second write, not a wider grant on the same one | No policy for `app.current_external_tenant()` exists on either table; `begin_external_card_payment`, `confirm_external_card_payment` and `external_card_payment_availability` are the only doors, each deriving scope itself and re-proving invoice ownership rather than trusting an earlier read (I42) |
| A stored `locked`/`is_paid` flag, or a status check outside the one resolver | Service access is derived from the Plan and the processor's subscription; a copy would disagree, and a page-local status check is a second grace policy (D57) | `resolveServiceAccess`; `requireOrganization` calls it and `requireOrganizationForBillingRecovery` is the only way past it, for a closed list of users; `service-access-boundary.test.ts` |
| GildOps platform billing (organization → GildOps, D-restated for this plane) sharing an ingress path, a Postgres role, or a signing secret with tenant commerce (customer → tenant, `payment_webhook`) | The two money directions are never one ledger; a leaked platform-billing webhook secret must never mint a token that also writes a tenant's card payments, or the other way round | `platform_billing_webhook` is its own role holding no table grant and exactly two executes (`apply_platform_subscription_event`, `record_platform_billing_notice`), fed by its own Stripe destination and its own `STRIPE_PLATFORM_BILLING_WEBHOOK_SECRET`, distinct from `payment_webhook`'s (I43) |

### Provider bindings and secrets

| Never | Because | Held by |
|---|---|---|
| A binding or a resource written by a general table grant | The same rule as above, restated for a third axis: staff hold no `insert`/`update`/`delete` on any table | `organization_provider_bindings` and `organization_provider_resources` hold no such grant for any role; `begin_provider_binding`, `set_provider_binding_status`, `record_provider_resource`, `set_provider_resource_status` are the only doors — `execute`-granted to `authenticated`, each staff-checked internally by `app.require_platform_staff()` (D45) |
| A function that selects a decrypted secret back out | Staff necessarily holds a generated secret for the one moment it is created; nothing signed in may ever ask for it again through this API — not staff, not a tenant, not the browser. The one door that decrypts is `read_provider_account_credential`, below (D54) | No role holds `select` on `vault.secrets` or `vault.decrypted_secrets`; `store_provider_secret` returns the resource id it acted on, never the secret or the vault row's own id |
| `secret_id` reaching any caller | A vault reference is exactly as sensitive as what it points to handing back | Withheld from every grant on `organization_provider_resources`, the same column-grant mechanism `usage_events` uses for GildOps' own cost |
| A signed-in role executing `read_provider_account_credential` | A staff token could then read GildOps' parent credential from a browser console, and the web runtime holds no signing secret to use it any other way (D14, D54) | Executable by `provider_operator` alone, which only `apps/api` wears after proving the caller is staff; `provider-accounts.test.ts` asserts `has_function_privilege` false for `authenticated`, no table grant, and exactly three narrow executes (D62 added `resolve_ai_runtime_assignment`). `platform_provider_accounts.secret_id` is in no column grant |
| A provider named in `lib/domain/` | I15, extended: a resource-type string like `twilio_subaccount` is a vendor's name wearing a different shape | `organization_provider_resources.resourceType` is opaque `string`; `lib/adapters/telephony/registry.ts` alone knows `telephonyProviderKey()` and `TELEPHONY_RESOURCE_TYPES` |
| A React page or constant owning the list of outside apps | The connector list is catalogue data an admin edits; a second list in code disagrees the day someone edits the first (D55) | `platform_connectors`; `integration_connections_insert` refuses a `planned` or private connector at the table; `connector-catalogue.test.ts` |
| A signed-in role executing a tenant-credential door, or `secret_id` selectable on `integration_connections` | A business's own OAuth token is read back only to be used, and the person it belongs to must not be able to read it from a console either (D56) | `integration_operator` alone holds the five executes and no table grant; `secret_id` is in no column grant; `integration-credentials.test.ts` |
| A connection standing in for the assistant's permission | "Connected" and "the assistant may read this" are two decisions; one implying the other would give an assistant everything a sync finds tomorrow | `assistant_resource_grants` is per resource with no default row; `public.assistant_may_read_resource` also needs the resource and connection active; `assistant-grants.test.ts` |
| A vendor's client secret, a token or the OAuth state secret in `apps/web` | The web runtime relays a browser and proves nothing about a token (D14, D56) | `apps/api/app/connectors/` and `app/domains/integrations/` do the handshake; `integration-credentials.test.ts` scans `apps/web` for the names |
| A tenant selecting another organization's bound resource as its own | A number or a domain typed by hand must not let GildOps use somebody else's scope (D39) | `app.phone_number_owner`, `security definer`, checked inside `set_calling_number`; a number bound to a different organization is refused, one bound to nobody is unaffected |
| A subaccount's own credential used to place a call | GildOps' master account can already address any subaccount by naming it in the request path (D39); a second credential per business is a second thing to rotate for no isolation gained | `telephonyProvider(actingAccountSid)` authenticates with GildOps' master token throughout; only the acting account in the URL path changes |
| A tenant submission, a DNS write, or platform staff marking a provider resource active/verified | A sending domain's readiness and a custom domain's verification are the provider's own fact; a form being submitted or a DNS record landing is not the provider confirming anything (D44, D54) | `record_email_domain_provisioning` and `set_custom_domain_verification`/`record_custom_domain_registration` are `provider_operator`-only and hold no grant to any signed-in role; `email-sending-domains.test.ts` and `test_web_delivery_domains.py` prove neither a tenant nor platform staff can write either state directly, and `test_email_provisioning.py` proves publishing DNS is never itself recorded as verification |

### Files and imports

| Never | Because | Held by |
|---|---|---|
| A file format as a connector (CSV, Spreadsheet, PDF, Markdown, a generic *File upload* card) | A Connection is a persistent relationship with an outside system; a file is an artifact, and Browse would say the two are one thing (D63) | `connector-catalogue.test.ts` fails on a seeded format; `platform_connectors_connection_method_check` has no `file` value; `file-boundary.test.ts` |
| A connection made so an upload has somewhere to hang | An import consumes a file directly; Google Drive is a Connection, a sheet fetched through it is an artifact | `integration_resources_has_an_owner` allows no connection only for a stored file |
| A consumer, a schema or a vendor in `lib/domain/files/` | Intake, format and policy are one boundary every consumer calls; the CRM importer, the Agent and a future Knowledge ingest each own what they do with a file | `file-boundary.test.ts` |
| A format claimed as supported before its reader exists | *Recognized*, *parseable*, *uploadable* and *usable by* are four claims (D31) | `formats.ts` derives the last two from `consumers`; `file-intake.test.ts` |
| A permission per file type (`enable_csv`, `enable_pdf`) | Which types an organization admits is policy, and who may act is capability; a per-extension permission fuses the two | `FileIngestionPolicy` in `policy.ts`; no such capability exists |

### Human authentication

| Never | Because | Held by |
|---|---|---|
| A second `Authorization: Bearer ...` parser in a handler | A rule a second caller extracts rather than copies; three handlers had already copied it | `apps/api/app/auth/bearer.py`; `ai_ask.py`, `crm_change_customer_stage.py`, `voice_wrap_up_call.py` all call `require_caller` |
| `SUPABASE_JWT_SECRET` read on a human-auth path | It is a signing secret for four narrow machine roles, and holding it for people would mean this runtime could mint a human's identity, not merely verify it (D26, D52) | `app.auth.supabase` verifies locally against the project's JWKS, or by asking Supabase's own Auth server — never that secret; `test_auth.py` proves `require_caller`'s signature carries nothing secret-shaped |
| An unverified JWT claim used to build an authenticated `CallerContext` | A claim this runtime did not check is a claim a forged token can set to anything; a later PostgREST refusal does not undo a provider call already made on the strength of it | `verify_access_token` never returns without either a local signature check or a 200 from Supabase's own Auth server (D52); `test_auth.py`'s ordering test proves a rejected token never reaches a domain/provider call |
| "Checked and fine" and "could not check" treated alike | An unreachable JWKS endpoint or Supabase Auth server is not evidence about the token | Both raise `AuthError(503, ...)`, never an authenticated context (D52) |
| An authorization decision inside `apps/api/app/auth/` | It answers *who*, never *what they may do* — folding permission in here is D25's mistake on a new axis | RLS, `app/domains/**`'s own commands, and `app.is_platform_staff()` remain the only deciders (D52) |
| Platform authority read from a JWT `role` claim | The design D45 retired once already, on the Postgres-role axis; a claim a caller's own token asserts is not a fact GildOps checked | `CallerContext.role` is exposed read-only for inspection; nothing branches on it |

### The AI axis

| Never | Because | Held by |
|---|---|---|
| A Postgres role for the assistant | A person is always present here. A role reading across tenants and filtering by an organization id is the argument mistake wearing an identity | `apps/api` forwards the caller's token and mints nothing |
| Asking the model which business | A value a model chooses is no protection; RLS decides, and it reads the caller's own JWT | The loop fills the id in and drops one a model supplies |
| A `volatile` tool | Postgres refuses a write inside a non-volatile function at execution rather than at creation | `ai-tools.test.ts` reads `provolatile` for every registered name |
| Rows in `agent_runs` | That table's policies are not the ones protecting the original | It records a name, its arguments and a row count |
| A conversation readable by anyone but its starter, or history from another conversation sent with a question | An answer holds whatever its asker could see, and a thread is a set of answers (D34, I48) | `agent_conversations_select` is creator-only; a run's composite key carries the asker; `agent-conversations.test.ts` |
| A file attached to a question readable by anyone but its asker, or sent to a model as anything but bounded text | An attachment is part of a question (D34, I49); and nothing here reads a PDF or an image, so a model would be handed bytes it cannot use | `documents_agent_file_is_safe` and the owner-only `documents` policies; `agent-attachments.test.ts` |
| A model id, a model vendor's SDK or a model credential in `apps/web`, or a second place that chooses which model answers | Which provider, account and model answers a capability is `platform_ai_runtime_assignments`' decision, read only by `apps/api` (D62); drafting once held its own key and a model name in source (D83) | `ai-runtime-boundary.test.ts` scans `apps/web` for the three; `configuration_drafting` is an assignment row like the other two |
| AI usage written from a guess, per call *and* per request, or by anything but `public.record_ai_usage` | A token count the provider did not give is a guess billed as a fact, and counting a call twice bills it twice (D83) | `Turn.usage` is the provider's own report, `None` when absent; the loop sums once, `app/ai/metering.py` writes once; `usage-boundary.test.ts` finds no other inserter into `usage_events`; `test_ai_usage.py`, `ai-usage.test.ts` |
| An AI request spent before the business is known to hold the module, or a public request naming its own business or instructions | `assistant.ask` is a role's permission, not the business's purchase (D25); the secret on a public request proves who called, not that what it sent is true (D17, D22) | `app.module_entitled` asked by `apps/api` before a provider is resolved; `resolve_public_assistant` derives the business, instructions and entitlement from the deployment id; `test_handlers.py`, `ai-usage.test.ts` |
| A write performed by the loop | A person presses the button, and a name the loop invents must fail closed | The whitelist lives in `apps/web`; an action carries no Postgres function; `agent_runs_update` freezes a decided action |
| A reschedule that omits the resource | `scheduleWorkItem` reads an absent resource as *nobody assigned*, so moving a job silently takes the person off it | The executor passes it |
| A vendor's tool-runner | A second loop the day a business answers with its own model, and an `agent_runs` row that means two things | `app/ai/loop.py` owns iteration, dispatch, the cap and the record |
| A database handle or domain writer in the drafting adapter | The model reaches business state through nothing, which is stronger than a tool it may not misuse (I14) | `proposals.test.ts` asserts it from the imports |
| An edit to an applied proposal | What was applied must not be rewritten later to say something else was | Only a draft is editable, by policy. Re-applying after a failure is a new draft, never an edit |
| A second configuration path | `applyConfigurationProposal` calls `configureBusiness`, the same function the milestone test drives | It reads the row rather than the caller's snapshot — a stale one walked past the guard once |
| A select grant on `platform_ai_runtime_assignments`, staff included | The row is not the decision's own visibility (D62, same pattern as `organization_commercial_terms`, D40) | No role holds any table privilege on it; `platform_ai_runtime_assignment_overview` and `record_ai_runtime_assignment` are the only two doors |
| An assigned AI provider that fails falling over to another vendor | Explicit beats implicit; a silent vendor swap hides an outage behind a different cost, vendor and data-handling promise (D62) | `app.ai.runtime.resolve_provider` raises rather than retrying with `app.ai.registry`'s fallback once an assignment exists |

### Reporting

| Never | Because | Held by |
|---|---|---|
| A saved report with a query of its own | It would be a second answer to a question that already has one, and it would arrive looking like an optimisation | `runReportDefinition` passes stored arguments to `invoiced_and_incurred`; `reporting.test.ts` compares whole rows from the saved and ad-hoc paths |
| A divergence between `priceWorkItem` and the aggregate | I4 forbids a second calculation unless the two are pinned together | `reporting.test.ts` totals the same invoices through both. When a tax or rounding rule lands, teach the aggregate — never relax the assertion |
| An audience filter in a page | A listing narrowed in TypeScript is a second, weaker copy of the policy | `report_definitions_select`; a report shared with a role the caller does not hold returns no row |
| A role list on a dashboard | Who sees a dashboard follows from which of its reports they can read. Two lists disagree eventually, and then the answer is whichever policy ran last | `dashboards_select` runs `report_definitions_select` in a subquery under the caller's own rights |
| A JSONB filter column | It would accept another business's customer id and produce an empty report nobody could explain (I18) | Typed columns with a composite key |
| A seeded dashboard | Including the four `roadmap.md` names. They are configuration, not four screens | None is seeded |
| The word *revenue* | Only invoiced and incurred are dated by something a person chose. A priced line's only date is the instant somebody typed it | The function says invoiced. A business that prices here and invoices elsewhere sees an empty report, which is the honest answer |
| An allocation of a job's costs across its lines | A cost belongs to a job; a service is one line on one | Grouping by service returns an absent cost and an absent margin rather than zero |

### Tenancy and access

| Never | Because | Held by |
|---|---|---|
| A service-role key in `apps/web` | D14 | Anon key only |
| A tenant id in a public URL | The id must be one the server resolved, never one a URL supplied (D17) | `/book/[slug]` resolves through `public.booking_organization` |
| An organization id accepted by a privileged public write | A parameter the caller supplies is a parameter the caller chose, no matter which layer read it first (D17, D22) | `submit_public_inquiry` takes no such argument; the target comes from `platform_settings`, readable by no role through PostgREST, set by hand (D42) |
| A platform sentence on a public page | A claim a business makes about itself is configuration | `public-profile.test.ts` scans the source of `app/(public)/`, so this fails at the gate rather than in front of a customer |
| An insert, update or delete grant to `authenticated` on `memberships` or `platform_staff` (the table) | Staff may bring a tenant into existence and may never reach into one that exists (I21). Every other narrow-door write staff make is a function with `app.require_platform_staff()` inside it, not a table grant — a check can be argued with; a missing privilege cannot | Neither table carries such a grant to any role; `platform-staff.test.ts` asserts `permission denied` on both, specifically, rather than merely a failure |
| A Postgres role a session wears instead of `authenticated` to signal platform authority | It costs the same session a real organization membership for as long as it holds that role — the thing D45 retired, precisely because the owner said not to want it | `app.is_platform_staff()`/`app.require_platform_staff()` read `platform_staff` live, under whichever role the caller already is (D45) |
| `security_definer` on `platform_tenants` | It would be the service-role client D14 refuses, with extra steps | `pg_class.reloptions`, read by the test rather than trusting the definition |
| An `organization_id` on `platform_staff` | Not being scoped to a tenant is the entire point, which puts it outside I2 rather than in breach of it | No such column |
| A `customer_id` on `external_actors` | An outsider who can write a customer id onto their own binding can write somebody else's | The column grant refuses it; the binding is immutable, and `created_by` is what scopes an outsider to their own rows |
| Leading `external_actors_one_tenant_per_user` with `organization_id` | It would permit exactly the row it forbids — one actor spanning two tenants. I2 inverted on purpose | On `user_id` alone; `schema-conformance.test.ts` names it as the exception, so a second cannot arrive by matching a loosened rule |
| A second write path for an outsider | Every write about the business goes through `create_booking`, one function whose first act is the scope check | An external actor holds insert on exactly one table, its own binding; `booking.test.ts` asserts the refusals table by table |
| A caller deciding for itself whether a business opens on Setup or Today | SETUP is a lifecycle state with one default destination, and hand-built entry links are how two callers come to disagree about it (D53) | `organizationHomeHref` takes `operationalState` as a required argument; `landing.test.ts` and `setup-lifecycle.test.ts` fail on a caller that builds the entry URL itself |
| A page that leans on its layout for authorization | Next reuses a layout across client-side navigations without re-rendering it, so the page would be trusting a cache (I12) | Every page calls `requireOrganization` for itself |
| A public write that signs out a session it did not begin | A business owner submitting their own public form was signed out of Studio, because the code ended every session it touched and not only the one it made (I79) | `openPublicSession` is the only helper that ends a public session; `anonymous-session.test.ts`; `forms-boundary.test.ts` fails on any other `auth.signOut(` in `lib/domain`, `features` or `app` besides the sign-out screen |
| A portal link's token carried past its exchange, or a portal operation that takes an organization, a customer or a token from the browser | The link is a credential for one request; every later one needs only the session, and a value the browser supplies is one it chose (D80) | `[token]/route.ts` exchanges and redirects with no-referrer; `requirePortalContext` opens every portal action; `portal-session-boundary.test.ts` |
| A portal customer on the account session's cookie, or an account bound as a customer | One browser can be a signed-in owner and a customer at once, and neither may replace or end the other (D80) | `gold-portal`, `HttpOnly`, path `/portal`; `claim_portal_invite` takes an anonymous caller only; `forms-boundary.test.ts`, `portal.test.ts` |
| A portal session that outlives its link | A cookie valid for days must still stop when the business withdraws the link | `app.current_external_customer()` reads the link and the expiry live; `portal.test.ts` |
| A proposal link's token carried past its exchange, a proposal action that takes an organization, a customer or a token from the browser, or a proposal recipient on the portal's or the account's cookie | The link is a credential for one request; a render cannot keep the session it makes, and a decision on terms the recipient did not see is the failure here (D82) | `[token]/route.ts` exchanges into `gold-proposal` and redirects; `requireProposalAccessContext` opens every action; both responses lock and refuse a replaced version; `proposal-session-boundary.test.ts`, `proposal-access.test.ts` |
| A booking's answers recorded by a second call after the booking | A booking whose answers a second write lost is the failure the business asked to avoid (D81) | `create_booking` records through `app.record_form_submission` in its own transaction; `booking-intake.test.ts` |
| An anonymous session founding a business | `create_organization` is granted to `authenticated`, which a booking visitor also holds (D22) | The function's own guard; `tenancy.test.ts` and `provisioning.test.ts` each assert the message, and neither alone is the guarantee |
| A `SECURITY DEFINER` function in `app` executable by `PUBLIC` or `anon` | A privileged function is granted to the roles that need it by name; the schema being unexposed is a fact that can change, and would open every one at once | `function-surface.test.ts` reads `pg_proc` and pins the short list a signed-in role may run |
| A definer function that answers for an organization id without proving the caller belongs to it | A parameter the caller chose is no scope (D17); `organization_launch_blockers` once told any signed-in user another business's module and payment state | The public door checks membership or `is_platform_staff()` and calls an `app` core with no grant; `launch-blockers-access.test.ts` proves the cross-tenant, external and signed-out refusals |

### The interface

Not every row below is the same kind of rule. `docs/constraints.md` D23 names four: **hard
invariant** (dependency direction, authorization, tenant isolation — strong tests belong here),
**product contract** (an IA decision — tested where changing it changes the product), **pattern/
default** (a preferred composition, not a law a later screen must obey), and **implementation
detail** (exact classes/JSX ordering — not worth an architecture-static test unless it guards a
demonstrated correctness or accessibility bug). Do not add a source-scanning test for an ordinary
visual preference; that is what turned a pattern into permanent doctrine here before.

An empty state describes the truth and may give concise, honest guidance toward the next step —
avoid misleading, manipulative or duplicate advice, but do not treat contextual copy as forbidden.

| Never | Because | Held by |
|---|---|---|
| A page container centred with `mx-auto` and no `w-full` | An auto side margin cancels flex stretch, so the box shrinks to its own text — which is how every surface outside the shell shipped | `layout.test.ts`, a source scan; jsdom computes no layout, so nothing that renders could have caught it |
| Platform items in a customer's business, or for somebody whose staff row does not name them | Platform is a scope: membership of GildOps is not platform authority, and the control plane never sits beside a tenant's own work (D45, D59) | `projectShell` takes `platform` as an input that is `null` unless the organization is GildOps' own and the caller is staff (`organization-shell.tsx`); `shell-projection.test.ts`; `adaptive-shell.test.ts` proves each Platform area's layout, and each page, refuses a row that does not name it |
| A Platform address spelled by hand, or Platform data filtered by the organization in its URL | The address names the context an operator is in, never who owns the records; a hand-written `/platform/...` link is the old namespace coming back (D60) | `platformHref` is the one way to write one; `adaptive-shell.test.ts` finds any other, and `platform-control-plane.test.ts` refuses any use of `goldId` but a link |
| Any organization but GildOps' own serving Platform, however trusted the caller | Staff may bring a tenant into existence and never reach into one (I21); membership of a business is not Platform authority | `requirePlatformScope`: GildOps' own Plan, then membership, then a live `platform_staff` permission, in that order; `adaptive-shell.test.ts` |
| A page of a workspace drawn as its peer | Work, Schedule, Resources, Locations and Assets are pages of Operations; five rows beside Customers say the opposite (D60) | `Area.parent`, read by `projectShell`; `navigation.test.ts` checks every parent is a real workspace in the same section |
| A sidebar row for a workspace with no real page, or a dropdown holding anything but real pages | A placeholder is a promise the product cannot keep; *coming soon* belongs in the catalogue (D68) | Current `WORKSPACES` rows are implementation state and visibility derives from reachable pages; `navigation.test.ts` refuses a page with no route. The target set is documented separately in D68 |
| An old Product key (`crm`, `operations`, `insights`, ...) written back to the catalogue, or reporting made a ninth Product | The customer-facing set is the eight Gild Products; the shared Workspace is a different kind of row (D61) | `platform_catalog_products_key_check` and `_workspace_kind`; `gild-taxonomy.test.ts` |
| A failed read of platform staff treated as *not staff* | Schema drift then looks like an authorization decision and Platform vanishes without a word | `platformPermissions` and `isPlatformStaff` throw; `platform-permissions-read.test.ts` (I53) |
| A renderer, a role name or a breakpoint deciding what somebody may reach | Entitlement and permission are separate, both required, and resolved once; a second rule per breakpoint is how phone and desktop disagree (D59) | `org-shell.tsx` and `more-menu.tsx` name no capability, module or role; `adaptive-shell.test.ts` |
| A Settings entry inheriting its workspace's operating capability | Configuring is not operating: `field.manage` configures call outcomes, `call.place` makes calls (D59) | `ConfigTarget.permission`; `settings-map.test.ts` |
| Setup gated on the drafting module | Setup is kernel; Agent-assisted drafting is an optional accelerator inside it (D59) | `setup` has no module or capability on its `AREAS` row; `adaptive-shell.test.ts` |
| A permanent sidebar row for configuration, or an Ask row | A row is a place somebody works; configuring how another workspace behaves is reached from Settings, and the Agent is a rail on every workspace | `Area.sidebar: false` on Pricing, Custom fields, Team, Integrations and Setup; `settings-map.test.ts` fails if one is left unreachable; `navigation.test.ts` fails on an `ask` area |
| A shell action in the list of areas | *Leave this business* is not somewhere to go, and a list holding both makes sixteen areas look like eighteen | Switch business and Sign out live in the header; `navigation.test.ts` fails on an `AREAS` entry with no route behind it |
| GildOps' header on a tenant's public page | `SiteShell` says GildOps twice. On `/book/{slug}` that is our wordmark on somebody else's shop front (D20) | `public-profile.test.ts` scans `app/(public)/` for it, beside the sentences it already refuses |
| A heading on an area page | One string in `navigation.ts` is both the navigation entry and the `<h1>`; an area's root page reads it with `areaLabel`. A detail route writes its own, because a job's title is not a platform noun | `navigation.test.ts` fails on a route with no entry and on an entry with no route |
| A page title or page action in `WorkspaceHeader` | It is the global bar; a control belongs to the layer whose scope it has, and *Configure* on Agent's row put one page's controls on the workspace's (`ui-spec.md` §2a). The breadcrumb trail is the one page-supplied thing it hosts, published through `PageLocation`, never written there by hand | `WorkspaceHeader` accepts no slot but that one; every page renders one page identity — `PageHeader` or a `components/patterns/` archetype (`ui-spec.md` §2d) — and its location publishes into the bar rather than the page; `workspace-shell.test.ts` scans both |
| An interleaved `AREAS` list | An operator must never reach today's work by going through settings (D23), and the sidebar rules between sections — a broken run draws a divider through the middle of one | `navigation.test.ts` asserts each group is one unbroken run, in `AREA_GROUPS` order, Home first and Settings last |
| A navigation section named for the billing axis | *Module* is what a tenant switches on (D25), and Reports, Assets, Automations and Reception are all modules — a section by that name would have to hold areas belonging to all three sections | `AREA_GROUPS` names what an operator does: home, workspaces, operations, settings |
| A `required: true` module | That is the kernel misfiled. It shipped once with every area inside a required module, and module enablement could not change a single line of navigation | `navigation.test.ts` fails if no area belongs to an optional module |
| A module that hides only its own area | Switching `billing` off must also remove the quote, invoice and margin sections from every job screen | `modules.test.ts`; `20260829000010` fixed the half-switch booking shipped |
| A module without `configuredAt` | A switch with no route to its inputs looks finished and does nothing, which is what card payments did (D31) | Required by `Module`; `outstandingModuleSetup` says what is still missing |
| Capability-gated navigation as the general rule | Each kernel or general-purpose screen shows itself and explains what a role cannot do. Hiding is on a module, not a role, for most of `AREAS` (I12) | `Area.relevantCapabilities` is the one narrow, explicit exception — a genuinely feature-specific area (Insights, Automation, Communications) whose entire content sits behind one capability, layered on top of the module gate, never instead of it. A kernel or general operational area (Home, Work, Customers, Schedule, Locations, Resources) carries none. Direct navigation to the route underneath is unaffected either way — RLS decides that regardless of what the sidebar shows |
| A colour keyed to what a status means | The platform does not know what a tenant's status means; *Klaar* and *Awaiting parts* are the same shape of row | One neutral treatment, the tenant's word rendered as written (`ui-spec.md` §7) |
| A colour literal in a screen | `globals.css` holds the roles and is the only place a value lives. Refusing a tokens *document* (D8) was once read as refusing the tokens, and the screens carried two reds nobody chose | Nine roles in `@theme`; `ui-spec.md` §3 |
| A tenant colour outside the three accent roles | A business overriding its page, its rules or `danger` can make its own screens unreadable, or recolour a refusal | `BrandStyle` writes three variables and no others |
| A second contrast calculation | The one that gets forgotten is the one on the screen a customer sees — I4 and I5's reasoning, about colour | `lib/domain/branding/palette.ts`; `branding.test.ts` asserts AA over a spread of colours in both schemes |
| A parallel semantic button system for one surface | Ordinary application actions use the shared semantic `Button`/`ButtonLink` contract; a feature may still reach for an appropriate `packages/ui` primitive for a genuinely different low-level interaction — this is not a blanket primitive ban | `ui-spec.md` §4, whose acceptance test is an absence: no file under `app/` spells a control by hand |

## Where the reasoning lives

Every entry above has a decision record behind it. Read it before changing the thing it governs.

| Subject | Start at |
|---|---|
| The two runtimes, and what may live in Python | D2, D30, D51 |
| Repository shape, workspaces, migrations, the gate | D3, D13, D15, D16 |
| Statuses, custom fields, terminology | D6, D7, D18 |
| Tenant identity, and the caller's own JWT | D14, D17 |
| The external actor axis | D22 |
| The interface, and the control set | D23, `docs/ui-spec.md` |
| Home, target workspaces, canonical projections, Library, Insights, and operator against catalogue taxonomy | D68 (with D58 and D67 for history/invariants) |
| Modules against engines | D25 |
| Payments, and whose account holds the money | D26, D27, D33 |
| Platform staff, provisioning, the two doors | D28, D29 |
| Platform Context, Organization Context, one identity holding both, the `Admin` rename, invitations, support sessions, the package layer | D45 |
| One adaptive shell, platform permissions, configuration against operating permission, roles as bundles and presets | D59 |
| Automation, and the switch that leads to its inputs | D11, D30, D31 |
| The onboarding proposal | D32 |
| The AI tool loop | D34 |
| The aggregate layer and saved reports | D35, D36 |
| The demo builder | D37 |
| The dialer, and whose telephone account it is | D38, D39 |
| What reaching somebody costs, and who pays first | D40 |
| What a business is buying, and what a lapse does | D41 |
| GildOps' own business, and why staff is a second account | D42 |
| The commercial catalogue, entitlement's build, provider cost and margin | D43 |
| Provider bindings, provisioning and where a generated secret lives | D44 |
| GildOps' own provider account, its write-only credential, and reconciliation | D54 |
| The canonical Product/Module/Feature catalogue, Plans/Add-ons, and how they coexist with the legacy commercial layer | D46, D50 |
| The API's human-auth boundary, JWKS verification, and the Supabase key rename | D52 |
| Connectors as catalogue data, against providers and connections | D55 |
| A tenant's OAuth credential, the fifth machine role, one contract for two suites | D56 |
| Catalogue Product history and the shared catalogue row | D61, D67 |
| GildOps naming, legacy identifiers and forward namespace migration | D69 |
| A generic Provider Account for an API-key-only provider, and AI Runtime assignment | D62 |
| Files, imports and policy, against Connections | D63, D55 |
| Usage, its provenance, and retail and provider rates as one model | D65, D40, D43 |
| Which platform tables a member, a booking visitor and staff may each read | D64 |
| Settings as one destination, and its five scopes | D71, D45 |

## When you finish a change

State which invariant in `docs/domain-model.md` the change newly enforces, and fill in its
`Enforced by` cell. That column is the real backlog: an invariant with nothing in it is an
intention, not a guarantee. The same is true of an empty `Held by` cell above.

If a change makes a document wrong, fix the document in the same commit. Do not soften its
wording until it stops contradicting the code — that is how a constraint file with teeth degrades
into advice.

If a change adds a rule that belongs here, add **one line**. If it needs a paragraph, the
paragraph belongs in `docs/constraints.md` and the line here points at it.
