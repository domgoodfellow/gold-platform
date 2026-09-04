# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

This file is the **operating contract**: layout, commands, and the rules that hold in every
change. Depth lives in `docs/` — read the relevant document before designing anything
substantial. Do not restate their content here; when this file starts explaining the domain
instead of pointing at it, the set has begun to rot.

| Document | Read it when |
|---|---|
| [docs/vision.md](docs/vision.md) | You need to know what this product is and refuses to be |
| [docs/market.md](docs/market.md) | You need to know who buys it, why, and what they pay for |
| [docs/constraints.md](docs/constraints.md) | Before any structural change — includes decisions already taken |
| [docs/domain-model.md](docs/domain-model.md) | You are touching business logic, schema, or auth |
| [docs/roadmap.md](docs/roadmap.md) | You are deciding whether something belongs now |
| [docs/walkthrough.md](docs/walkthrough.md) | You need to drive the running application by hand — and for the list of capabilities no screen reaches |

**Status is not tracked in markdown.** Milestone criteria are in `docs/roadmap.md`; task
state lives on the issue board; shipped work goes in `CHANGELOG.md` on merge. Do not add
checklists to documents.

## Current state

**M1's, M2's, M3's, M4's, M5's, M6's, M7's and both of M8's acceptance criteria are met**, each
demonstrated by one test rather than by a table count. M8's *first* criterion did not wait for
M7: the dependency was on the report-shaped questions only, and D34 records both the decision and
what keeps the distinction from rotting.

`apps/web/tests/milestone-m1.test.ts` builds two whole businesses from byte-identical input
in one database and asserts that neither can observe or block the other.

`apps/web/tests/milestone-m2.test.ts` has an operator who is **not the founder** define a
work item type, its statuses and its allowed transitions, walk a work item through that
lifecycle, and commit it to a resource for a window nothing else can double-book — twice,
from identical input, down to the same instants. It touches no SQL, because "without opening
the database" is a claim about the path.

`apps/web/tests/milestone-m3.test.ts` stands up two whole businesses that share no word,
number, status, field, currency or timezone — an equipment hire yard in Amsterdam trading in
euro, a clinic in Tokyo trading in yen — through **one** `configureBusiness` function containing no
branch on which of them it is holding. The structure is the milestone and the assertions
inside it are secondary: had either shape needed a special case, that function could not
exist.

`apps/web/tests/milestone-m4.test.ts` runs one business from a stranger's booking to a settled
invoice — found, read, booked, scheduled, worked, quoted, invoiced and paid — asserting at every
step, including the ones where they successfully wrote, that `app.current_tenant_ids()` is empty
for that stranger. It touches no SQL either.

`apps/web/tests/milestone-m5.test.ts` signs in as somebody who runs GOLD rather than a business
on it, sees every tenant while holding a membership in none, hands one over, and is refused every
write with `permission denied` rather than with a policy declining.

`apps/web/tests/milestone-m6.test.ts` writes a rule on a business that is already live, changes
the world underneath it, and asserts that a job moved and a customer was written to **in a
transaction with no session in it at all**.

`apps/web/tests/milestone-m7.test.ts` stands up a dive school in Cebu and a joinery in Tallinn,
has somebody who is **not the founder** define a report, pin it to a dashboard and share it with a
role their business named itself — and then reads `lib/domain/reporting/` as text and fails if any
word either tenant chose appears in it. The figures are secondary; a platform that shipped a
report called *What the reef brings in* would pass every other assertion in the file.

`apps/web/tests/milestone-m8.test.ts` describes a chimney sweep in Tallinn and a dive school in
Cebu in prose, receives a whole configuration for each — and asserts, at that moment, that both
businesses are still **completely empty**. Not one status, not one price, not one hour. A person
then changes a word and applies, and it is the changed word that reaches the database.

They invert each other deliberately — M1 runs byte-identical input, M2 runs identical input
twice, M3 runs maximally different input through identical code, M4 runs half of itself as
somebody who is a member of nothing, M5 runs as somebody who is a member of *none* of them, M6
is proved by a person doing nothing, M7 is proved by a source file not containing two
businesses' words, and M8 is proved by a machine having done nothing.

The kernel is `organizations`, `memberships`, `events`, `customers`, `roles`,
`field_definitions`, `locations`, `customer_locations`, `resources`, `assets`, `documents`,
`operating_hours` and — the work engine — `work_item_types`, `work_item_statuses`,
`work_item_transitions`, `work_items`, `work_item_type_checklist_items`,
`work_item_checklist_items`, `work_item_time_entries` and `work_item_costs`; and — the
configuration engine — `price_book_items` and `work_item_priced_lines`; and — the automation
engine — `automation_rules`, `automation_conditions`, `automation_actions`, `automation_runs`,
`automation_counter_marks`, `message_templates`, `message_deliveries`, `external_readings` and
`asset_readings`; and — the question tools — `agent_runs` and `public.work_at_risk`; and — the aggregate
layer — `public.invoiced_and_incurred`, `report_definitions`, `report_definition_roles`,
`dashboards` and `dashboard_reports`; the one tenant resolution function and `app.has_capability`; and a vertical
slice behind authentication for each.

Six things about the work engine are load-bearing and easy to undo by accident:

- **There is no overlap check in the domain layer and none may be added.**
  `work_items_resource_not_double_booked` is a partial gist exclusion constraint, and
  `scheduleWorkItem` deliberately does not look before it writes — a check before an insert
  races identically, which is exactly what I6 says.
- **There is one availability calculation** (`freeWindows`), and it is advisory by
  construction. What keeps I5 honest is that it and the constraint agree — `listSchedule`'s
  filters are the constraint's partial predicate written as a query, `status_releases_resource`
  included, and a clause added to one without the other breaks I5 rather than a test.
- **`work_items.status_releases_resource` is a maintained cache and must not become a
  snapshot.** It mirrors the tenant's `work_item_statuses.releases_resource` onto the row
  because an exclusion constraint's predicate must be IMMUTABLE and cannot join, and it is what
  makes cancelling free the resource. Everything else this platform copies onto a row is
  snapshotted so configuration cannot reach backwards (I8); this one is the deliberate
  exception, because a tenant marking "Cancelled" as releasing means it about the jobs already
  in it. Snapshotting it would look like enforcing I8 and would silently unfix cancellation.
  Nobody may write it: it is in no column grant for insert *or* update — `20260902000003` had to
  revoke a table-wide insert grant to make the first half true — and two triggers own it.
- **A type with no configured transitions is frozen, not unconstrained** (I13), and the
  guarantee is `app.check_status_transition`, a trigger — the domain layer re-checks only to
  produce the message.
- **Authorization on `work_items` is split between a policy and a trigger on purpose.** An
  RLS policy sees the old row or the new one, never both, so per-column rules
  (`work_item.transition` vs `work_item.schedule`) live in
  `app.check_work_item_update_capability`. Both are in the database.
- **Nothing holds a working week.** Operating hours are rows a business owns; there is no
  Monday-to-Friday, no weekend, no seeded set and no default, and a business that has
  configured nothing is treated as always open. A default week is the hardcoded business
  hours `constraints.md` forbids, wearing a default's clothing.
- **A checklist template is copied onto a job, never joined to it** (I8), which is what makes
  editing a template safe. The same reasoning makes changing a currency safe: every amount
  carries the one it was recorded in.

Four things about the configuration engine are load-bearing in the same way:

- **A priced line copies its catalogue row, and `work_item_priced_lines` holds no foreign key
  to `price_book_items`. None may be added.** The absence *is* the enforcement — a copy that
  is merely not currently joined becomes a join the first time a key makes one look safe, and
  the first `join price_book_items` written for a perfectly good reason would make every
  historical quote track today's catalogue (I8). `prices.test.ts` asserts it from
  `pg_constraint`.
- **There is one price calculation** (`priceWorkItem`), and nothing else may total lines. The
  reason a second one appears is that a total looks like formatting rather than like pricing;
  it is pricing, and the day a minimum charge or a tax lands, every inline `reduce` is a place
  the rule was forgotten. A rule the catalogue cannot express belongs *inside* that function.
- **A job is never quoted in two currencies**, and the guarantee is
  `work_item_priced_lines_one_currency`, a gist exclusion using `currency with <>` — not a
  check before the insert, which races identically. The case is real rather than theoretical:
  a business that changes what it trades in has a catalogue in two currencies, because
  amounts are never converted.
- **A field definition's `kind` and `key` are not editable, by anyone, through any path.** The
  column grant refuses them. Changing a kind reinterprets every value already stored under
  that key and renaming a key orphans them, and neither fails at the edit — both surface later
  as `app.check_custom_fields` refusing an unrelated write to a row that was valid when it was
  made.

**The automation engine is the third, and eight things about it are load-bearing.**

- **The runtime is in Postgres and the clock is in Python** (D30). A rule tripped by a stranger's
  booking runs where `app.current_tenant_ids()` is empty; one tripped by the tick runs where
  there is no person at all. `app.run_automation` is the only thing that performs an action, and
  `apps/api`'s `/tasks/automation-tick` only asks what is due. Neither runtime calls the other:
  the handoff is a row.
- **No action may compute what the domain layer owns** (I22). There is no action that prices
  anything and none that searches for a free slot, because either would be a second
  `priceWorkItem` or a second `freeWindows` in a second runtime (I4, I5). A rescheduling rule
  shifts by an offset the business typed and the exclusion constraint decides whether it lands —
  I6 doing the job it was written for, and a refusal is a recorded failure rather than a silent
  skip. This is the cost of D30 and it is the first thing to revisit if a business asks for the
  next free slot.
- **Each rule runs in its own subtransaction, and that is what makes an inline runtime safe.** An
  event-triggered rule runs inside the transaction that tripped it, so a confirmation is
  immediate; plpgsql's `exception` block is a savepoint, so a rule a business wrote badly rolls
  back its own work and leaves the customer's booking standing. Removing that block would make a
  bad rule able to fail a good write, which is the worst failure this platform could have.
- **An automation may not trigger an automation.** Both triggers return immediately when
  `app.acting_automation()` is already set. Chaining is a feature and a cycle is an outage, and
  the rows cannot tell them apart.
- **`app.acting_automation()` is what lets a rule write past the per-column capability guard**,
  and it is set only by `app.run_automation` on a transaction-local setting. It is an explicit
  third case beside `pg_trigger_depth()`, not an accident of being called from a trigger — the
  tick calls at depth zero. No client can set it: PostgREST issues no `SET`, and no function
  granted to `authenticated` writes it.
- **`automation_runs` and `message_deliveries` hold no foreign key to what produced them, and
  none may be added.** The same absence `work_item_priced_lines` keeps against the price book,
  for the same reason (I8): both snapshot the rule's name, so what happened survives the rule
  being renamed or deleted, and a key is how somebody eventually writes the join that makes last
  month's record report this month's configuration.
- **Units are compared, never converted.** A weather rule written in one unit takes no notice of
  a reading in another, and a counter rule counting hours ignores a reading in kilometres. Same
  refusal `jobEconomics` makes about currency: a conversion has a date.
- **Nothing the platform sends says anything the tenant did not write** (I24). Five placeholders
  and no other contribution — no greeting, no signature, no footer, in the resolver or in either
  sender. The finished words are snapshotted onto the delivery, so editing a template cannot
  reach into an inbox. The tests compare whole bodies rather than fragments, because a footer is
  exactly what a `toContain` would miss.

- **The rules are read back to the business** (`reviewAutomationRules`), and it is not a
  refusal — a rule that looks wrong may be right about statuses somebody is halfway through
  configuring. It catches what `automation_runs` structurally cannot: a rule that never fires
  leaves no failed run, because nothing happened. Deliberately not AI; the language model version
  answers a different question and wants these answers underneath it.

**The onboarding proposal is built, and it is M8's second criterion.** A business describes itself
on `/organizations/{id}/setup`, reads back a proposed `BusinessShape` with the questions the
drafting could not answer, edits any part of it, and applies it through `configureBusiness` —
which is the same function `milestone-m3.test.ts` drives, called by the person, with no second
configuration path anywhere. `configuration_proposals` is the row in between,
`lib/adapters/drafting/` is the third capability adapter and the first needing a vendor SDK, and
drafting is a **module** rather than kernel because every part of a setup has a screen that
predates it. `constraints.md` D32 holds the decisions. What is *not* built is M8's first
criterion — asking the system questions — which waits for M7's aggregate layer.

Four things are easy to undo by accident:

- **The drafting adapter holds no database handle and no domain writer.** That absence is what
  I14 rests on here — the model reaches business state through nothing, which is stronger than a
  tool it may not misuse — and `proposals.test.ts` asserts it from the imports rather than trusting
  it. What the adapter *may* import is the domain's own constant lists, so its schema cannot fall
  out of step with what the platform actually supports.
- **A proposal holds no foreign key to what applying it produces**, asserted from `pg_constraint`,
  for the reason `work_item_priced_lines` keeps the same absence against the price book (I8).
- **Only a draft is editable**, and the update policy is what enforces it. The review is meant to
  be edited — a review a person cannot change is a rubber stamp — and the moment a proposal is
  applied, failed or discarded the row is frozen, so what was applied cannot be rewritten later to
  say something else was. Re-applying after a failure is therefore a **new** draft, never an edit.
- **Applying adds no capability, and a failure is recorded rather than rolled back.** Every step
  is already gated by the capability it needs, so a member below `price.manage` is refused by
  `price_book_items`' own policy — the flow checks nothing. `configureBusiness` stays
  non-atomic: making it atomic means one privileged function taking the shape as JSON, which puts
  the order of those steps in the database and is the second configuration path D29 forbids one
  level up. `applyConfigurationProposal` **reads the row rather than trusting the proposal it was
  handed**, which a test found the hard way — the first version checked a caller's snapshot, and a
  stale one walked past the guard and re-ran the whole sequence.

**The question tools are built, and they are M8's first criterion.** An operator asks on
`/organizations/{id}/ask`, the loop runs in `apps/api`, and every read it performs happens under
that person's own access token. `constraints.md` D34 holds the decisions. Five things are
load-bearing:

- **A tool is a `stable`, `security invoker` function in Postgres**, and Python holds only its
  name, its sentence and its JSON schema. Not a query in the other runtime: *at risk of being
  late* is a definition, and a definition there is business logic in the wrong place. Postgres
  refuses a write inside a non-volatile function when it runs — at execution rather than at
  `create function`, which is why `ai-tools.test.ts` reads `provolatile` for every registered
  name instead of trusting the migration.
- **The argument is not what narrows, and this is the failure mode a tool layer invites.** A model
  chooses a tool's arguments, so protection that a model can pick the value of is no protection.
  RLS decides and the caller's own JWT is what RLS reads: one business's id handed to another
  business's session returns nothing. **A model is not asked which business either** — the first
  schemas required an id nothing had ever told it, which makes every answer silently empty; the
  loop fills it in and drops one a model supplies.
- **A tool's joins are part of what it discloses.** `work_at_risk` joins `work_item_statuses`, so
  a portal customer — who may read their own jobs and never the business's board vocabulary —
  gets nothing rather than a narrowed list. Each joined table's own policies apply, so a tool
  answers *less*, never wrongly. Found by testing, not by reasoning.
- **This axis has no Postgres role, and that absence is the security model.** `payment_webhook`
  and `automation_runner` hold one because no person is present; here one always is, so
  `apps/api` forwards the token and mints nothing. An `assistant` role reading across tenants and
  filtering by an organization id would be the argument mistake above wearing an identity.
- **A run is readable by the person who asked, and by nobody else in the business** — the one
  place this schema departs from *a member sees their business's rows*, because an answer holds
  whatever its asker could see. `agent_runs` records the question, the answer, and each tool call
  as a name, its arguments and a row count. **Never the rows**, which would put tenant data in a
  table whose policies are not the ones protecting the original.

Two more that are easy to undo:

- **The loop sits above a provider contract and uses no vendor's tool-runner.** `app/ai/loop.py`
  owns iteration, dispatch, the cap and the record; a provider answers *what is the next turn*.
  Taking the SDK's runner would mean a second loop the day a business answers with its own model,
  and an `agent_runs` row that means two things. Two providers ship: Claude by default, and
  anything speaking chat completions — which is how a deployment that must send no rows to
  anybody answers at all.
- **The aggregate-shaped tool is `invoiced_and_incurred`, and it is a tool because it is a
  function** (D35). This entry used to say no such tool existed and that report-shaped questions
  waited for M7; the aggregate layer arriving is what retired that. What has not changed is why
  it was safe to wait: a tool cannot contain a calculation, so the alternative was never a worse
  tool — it was no answer, which the assistant said out loud. *Least profitable service* is still
  refused, and now for a reason in the data rather than a missing layer: grouping by service
  returns no cost, because a cost belongs to a job and a service is one line on one.
- **`schedule_ahead` returns what is booked and never what is free**, which is what keeps it from
  being a second `freeWindows` in a second runtime (I5). It exists because a model asked to move a
  job had no way to see the diary and guessed; a model may now propose a time that looks free, and
  the exclusion constraint still decides whether it lands (I6).
- **A suggestion is judged when it is written, not when somebody presses.** The whitelist's
  validators are extracted and run twice — recording a run, and executing the action — so one that
  could only ever fail is stored as `failed` with its reason and never appears as a button.
  Offering a control whose only outcome is a refusal asks somebody to find the problem by causing
  it. Below the frontier models this is the ordinary case, not the rare one.

**The loop writes nothing; a person does.** An answer can come back with an intended action —
today only *move this job* — recorded on the run as `pending` and performed by nobody until
somebody presses the button, at which point `apps/web` maps the name through **its own**
whitelist and calls `scheduleWorkItem` under that person's session. Four things are easy to undo:
the whitelist lives on the executing side, so a name the loop invents fails closed rather than
dispatching; an action carries no Postgres function, so there is nothing in the Python plane that
could perform one; executing adds no capability, because the policy on `work_items` refuses
exactly as it would for a drag on the schedule, and the exclusion constraint decides whether the
window lands (I6); and a decided action is frozen by `agent_runs_update` rather than only by the
flow. **Rescheduling deliberately cannot reassign** — a test caught the first executor omitting
the resource, which `scheduleWorkItem` reads as *nobody assigned*, so moving a job silently took
the person off it.

**The aggregate layer is built, and it is M7's first slice.** `public.invoiced_and_incurred` is
one `stable`, `security invoker` function — D34's shape for a tool, because a report *is* one the
moment somebody asks the assistant for it — read by the Reports screen and by the loop in the same
change. `constraints.md` D35 holds the decisions. Five things are load-bearing:

- **`priceWorkItem` stays the price calculation and moves nowhere, and a correspondence test is
  what makes that true rather than a claim.** The aggregate expresses the same rule in SQL, which
  I4 forbids unless the two are pinned together — so `reporting.test.ts` totals the same invoices
  through both and fails on any disagreement. **This is I5's mechanism, not a new one**: the
  availability predicate has always lived in a constraint *and* in `listSchedule`'s filters, held
  honest by a test that they agree. When a minimum charge, a tax or a rounding rule lands in
  `priceWorkItem`, that test fails — which is the event I4 exists to catch. Repair it by teaching
  the aggregate the rule, never by relaxing the assertion.
- **It says *invoiced* and never *revenue*, and that word is the design.** Four financial facts
  live here and only two are dated by something a person chose: invoiced (`invoices.issued_at`)
  and incurred (`work_item_costs.incurred_at`). *Received* is a third and waits for a caller
  wanting a cash view. *Quoted* is the fourth and **cannot be reported over a period at all** — a
  priced line's only date is the instant somebody typed it, which is the asymmetry
  `20260903000001` closed everywhere else. So a business that prices here and invoices elsewhere
  sees an **empty report**, which is the honest answer and may describe most of them; that empty
  report in front of a real business is the caller that earns a quote its own date. Do not add the
  column before it.
- **A group is keyed by an entity *and* a currency.** Two rows for one customer is what a business
  that changed what it trades in actually has, and it is the refusal `jobEconomics` expresses as a
  `null` margin — a job screen wants one number, a report is a table. Neither converts.
- **Margin groups three ways and revenue four.** A cost sits on a job; a service is a line on one.
  Grouping by service returns an absent cost and an absent margin rather than zero, because
  splitting a job's costs across its lines means inventing an allocation rule. That is also why
  the assistant still refuses *least profitable service*.
- **No total is stored, and none may be.** No `subtotal`, `revenue` or `margin` column and no
  materialized view — I4's own record names a stored subtotal as the thing that becomes a second
  opinion, and a materialized one is that with a performance excuse. Nothing has measured a slow
  query yet.
- **`report.read` gates the summing, not the rows, and it is checked inside the function.**
  `20260902000006` said a capability over what a tool reaches would be a mistake, because a tool
  reshapes rows its caller could already read; that is right about rows and an aggregate has
  none. *What this business billed each customer this year* is in no table and cannot be
  assembled one row at a time, so it is a disclosure that did not previously exist. The invoices
  and costs underneath stay readable by every member because a job screen shows them.
  `schema-conformance.test.ts` therefore reads **function bodies as well as policies** for I16 —
  a clarification rather than a loosening, since `add_member_by_email` has enforced `role.manage`
  in a function since M1. Expect the first live tenant to notice that **a capability is never
  granted retroactively**: hand-configured roles need it adding on the Roles screen.

**A report is a row now, and its audience is a policy** (D36, M7's second and third slices).
`report_definitions` holds a grouping, a period and up to three filters — and nothing else,
because for this report set the entity *is* the grouping, the fields are the three money columns
and the calculation is the subtraction. Four of the six things `starting_conversation.txt` §17
lists are already fixed, so what remains is three columns and a check constraint rather than a
query language. Four things are easy to undo:

- **A saved report is arguments, and running one calls the same aggregate.** `runReportDefinition`
  passes the stored grouping, period and filters to `invoiced_and_incurred` and does nothing else.
  A saved report that grew its own query would be a second answer to a question that already has
  one, and it would arrive looking like an optimisation — `reporting.test.ts` compares whole rows
  from the saved path and the ad-hoc path.
- **The audience is `report_definitions_select` and must never become a filter in a page.** A
  report shared with a role the caller does not hold returns *no row*, which is what lets a
  dashboard render what each viewer can read with nothing in code deciding it. A listing narrowed
  in TypeScript would be a second, weaker copy of that rule.
- **A filter is a typed column with a composite key, never JSON** (I18). One JSONB column would
  have been less work and would have accepted another business's customer id, producing an empty
  report nobody could explain instead of a refusal.
- **`report.manage` is authoring and `report.read` is reading**, and they are plausibly two
  people. `report.manage` sees every report deliberately: somebody who can create and share one
  can recreate it in ten seconds, so hiding it protects nothing and would make a report
  undeletable by the person meant to delete it.

`setReportRoles` re-reads what it removed, because **a delete RLS filters to nothing is not an
error** — found by a test, where clearing an audience you may not manage came back clean without
changing anything. The check is against the database's own answer rather than a capability read in
TypeScript.

**A dashboard is a layout of pinned reports, and it has no audience of its own.** That absence is
the design: who sees a dashboard follows from which of its reports they can read, asked by
`dashboards_select` with `report_definitions_select` running inside the subquery under the
caller's own rights. A second role list would be a second thing to keep in step, and the day the
two disagreed the answer would be whichever policy ran last. Three consequences:

- **One dashboard shows different people different tiles, with nothing in code deciding it.** A
  pin whose report a viewer may not read is not returned, so the tile is *absent* rather than
  rendered empty — and a dashboard none of whose reports are theirs does not appear at all, name
  included. A filter in a page would be a second, weaker copy of that and must not be added.
- **The platform seeds no dashboard**, including the four `roadmap.md` names — executive,
  operations, manager, employee. That entry calls them *configuration rather than four screens*,
  and shipping them as rows would be the hardcoding `constraints.md` forbids arriving as a
  convenience, exactly like a starter catalogue or a seeded status list.
- **A pin cascades when its report goes**, unlike a report's filters, which are `set null`. A
  tile pointing at a report that no longer exists is not a tile with a hole in it; a report with
  one fewer filter still means something.

**M7's criterion is met** — an operator defines a report, pins it to a dashboard and shares it
with a role, with nothing about either in code — and `milestone-m7.test.ts` is what says so.
`today` is deliberately still not a configured dashboard: if the first dashboard and the machinery
for dashboards had landed together, nothing would test whether that machinery could express
something that already existed.

**A second measure is built, and it is the first that is not money.** *Work marked complete* is
`public.work_marked_complete`, and shipping it is what took `requires: 'billing'` off the
reporting module — a business that invoices somewhere else now has something to read. Four things
are load-bearing:

- **Which status means finished is the tenant's answer** (`work_item_statuses.marks_complete`),
  and it is a **second** question rather than a reuse of `releases_resource`. Cancelled frees the
  resource and is not completed work; one flag could not have said both, which is exactly why M4
  refused a platform-owned `is_terminal`. **This is M4's shape, not M4 being overturned.**
- **It reads the event log, not the work item.** A job's current status says what is true now;
  *finished in August* is a question about what happened then, and only `events` knows. So
  answering the question later counts history correctly rather than only what happens next —
  and the consequence is on screen: a job finished in August and reopened in September was
  finished in August.
- **It counts jobs, not events.** A job finished, reopened and finished again inside one period
  was done once; counting the moves would make a business that corrects a mistake look busier
  than one that does not.
- **`marked` is the honest word.** `events.occurred_at` records when somebody moved the job, not
  when the work stopped — the same discipline that makes the financial set say invoiced. The
  other instant is a caller-supplied date on `change_work_item_status` and its own slice.

`report_definitions.measure` arrived with it, and it is **D36 predicting its own extension**: the
fields stay fixed *per measure*, so a report gained one value from a closed list rather than a
query language. `GROUPINGS_FOR` is what says completed work has no service grouping — a job is
finished as a whole — and a report that could only ever fail is refused when it is **saved**
rather than when somebody clicks it, which is D34's reasoning about intended actions.

**The third measure is committed time, and it is the one that had to argue for itself.** What
counts as a commitment is `work_items_resource_not_double_booked`'s partial predicate, which
already lived in two places — the constraint and `listSchedule`'s filters, held together by
`availability.test.ts` agreeing in both directions. `public.time_committed` is the **third**
expression, admitted on exactly D35's terms: `reporting.test.ts` runs the same jobs through
`listSchedule` and through the aggregate and fails on any disagreement, including through a status
change that frees a resource. A clause added to one of the three and not the others breaks I5
rather than a test.

- **It is the numerator of utilisation and deliberately not utilisation.** A percentage needs
  opening hours minus commitments, which is `freeWindows` — and a second answer to *what is free*
  is what I5 forbids outright. No correspondence test would make that safe, because the second
  answer is the one somebody books against. So the platform gives the time and a business that
  wants a percentage divides by its own hours.
- **Time is clipped to the period.** A job crossing a month boundary belongs to both months in
  the proportion it held; counting it whole in each reports more time than exists.
- **`formatMinutes` is the one place minutes become words**, and it gives hours and minutes
  rather than decimal hours — *7h 30m* is what a timesheet reads like, and 7.5 invites being
  multiplied by a rate.

**Two claims this file made and had to withdraw** are recorded in `roadmap.md` M7 rather than
quietly fixed: work completed was never missing a date, and that missing answer had nothing to do
with quoted revenue, which needs no new column at all.

**Standing a business up is two acts by two parties, and the second of them is one function
that must never learn what kind of business it is holding.** GOLD creates the business —
`provisionOrganization` — and whoever does the configuring configures it:
`configureBusiness` (`lib/domain/onboarding/configure.ts`) takes an organization id and a
`BusinessShape` — the word for its work, its statuses, its transitions, its form and that
form's order, its prices, its hours, its roles — and performs a fixed sequence of domain calls
with no branch in it.

**The split is D29's axis, and the database is what forced it rather than a preference.** The
first version after founding closed stood the business up through the operator door and carried
on configuring in the same call, which fails at the second step: `createRole` and everything
after it run against policies keyed to `app.current_tenant_ids()`, and platform staff are a
member of nothing. That is I21 refusing exactly what it says it refuses — staff may bring a
tenant into existence and may not reach into one. So a name, a zone and a currency are settled
when the business is created, and everything in `BusinessShape` is settled afterwards by
somebody inside it. **Do not put creation back inside this function**; it cannot work, and the
attempt is what the paragraph above is a record of. It was `milestone-m3.test.ts`'s local helper
until it was extracted for the AI onboarding flow to call, and the milestone test now reads *its*
source and fails on any tenant's word appearing there. **That second caller is not built yet** —
every caller today is a test — which is a debt this file names rather than a claim it makes: the
extraction happened ahead of the caller, against this repository's own rule, and D32 is where the
caller is decided. A branch on business shape inside it is
the per-client app studio `vision.md` refuses, arriving as a helper rather than as a fork. Two
things it deliberately is not: it creates no customer and no job, because a business that has
just been configured has neither and inventing one would be the platform speaking for it; and
it is **not atomic**, so a failure part-way leaves a partly-configured business — which is a
state every screen already handles, because it is also the state of one being configured by
hand. Making it atomic means putting the order of those steps in the database, and no caller
has yet needed that.

Six about the interface, which M3 owns and M4 extends:

- **Every platform noun lives in `apps/web/lib/navigation.ts`**, and one string serves as
  both the navigation entry and the page's `<h1>`, so no *area* page writes a heading of its
  own. A detail route (`/work/{id}`, `/customers/{id}`) does, because its heading is the job's
  title or the customer's name rather than a platform noun — which is why `currentSegment` and
  `areaRootSegment` answer different questions: a detail route is *in* an area for the purpose
  of marking the navigation, and not *at* it for the purpose of the heading. Keeping the nouns
  in one place is what leaves the terminology override `constraints.md` defers a lookup rather
  than an excavation. `navigation.test.ts` fails on a route with no entry *and* an entry with
  no route.
- **`AREAS` carries a `group`, and operational must precede configuration.** D23 adopts that
  separation as a decision — "an operator must never reach today's work by going through
  settings" — and until M4 nothing held it but the order somebody typed. The sidebar rules
  between the two groups and `navigation.test.ts` fails on an interleaved list.
- **The shell is not the authorization boundary.** Every page calls `requireOrganization` for
  itself even though the layout does too, because Next reuses a layout across client-side
  navigations without re-rendering it — a page leaning on its parent would be trusting a cache.
  A layout is no more the boundary than a redirect is (I12). Nothing in the navigation is
  capability-gated: each screen shows itself and explains what a role cannot do.
- **The kernel is not a module, and `MODULES` must never list one that cannot be switched
  off.** `Area.module` is optional; absent means kernel — work, the schedule, customers,
  locations, resources, fields, roles and settings, which no business chose and none can
  decline. What is a module is what a business can genuinely refuse: `billing`, `assets`,
  `booking`, `portal`, `card_payments`. A `required: true` module is the kernel misfiled, and
  it is not a naming quibble: the first version of this list marked four that way, every area
  belonged to one of them, and module enablement shipped unable to change a single line of
  navigation. `navigation.test.ts` now fails if no area belongs to an optional module —
  every assertion it had before checked that two lists agreed, and two lists agree perfectly
  when the filter between them is dead. `constraints.md` D25 carries the full record.
- **A module that hides an area must hide what that area does elsewhere.** Switching `billing`
  off removes Pricing *and* the quote, invoice and margin sections from every job screen.
  Hiding the area alone would be half a switch, which is the failure the booking module
  already shipped once and `20260829000010` fixed in the database.
- **A module whose whole expression is inside another's surface declares it** (`Module.requires`).
  Weather and maintenance are both configured on the Automations screen, because a weather rule
  *is* an automation rule — a link a second switch can break, which is the D31 dead end arriving
  by a longer route. `navigation.test.ts` refuses that link unless the dependency is declared, at
  which point the settings screen says what is missing instead.
- **A switch leads to its inputs, and `Module.configuredAt` is required of every module** (D31).
  Turning one on renders a link to where it is set up, and `outstandingModuleSetup` says what is
  still missing before it does anything. This is written from a shipped failure: *Card payments*
  could be switched on while the section that connects an account was hidden behind
  `paymentProvider()` returning null on a deployment with no processor keys — the business turned
  the switch on and the page said nothing, which from the operator's side is what finishing looks
  like. A deployment that cannot support a module now says so rather than disappearing. Two lines
  it does not cross: it hides on a *module*, never on a role (I12), and its sentences describe
  application state only — never a word put in a tenant's mouth.

**Automation added no capability without a screen, and that is the standard now.** Every rule,
condition, action, template, counter reading and coordinate is written from a form. The one thing
M6 could not put on screen is which channels an installation can actually send on, because that
is configured in a different deployment — so a message queued for a channel nobody can send is
recorded as failed with a sentence saying so, rather than silently never arriving.

**Two domain capabilities have no route, and the one that mattered now has one.**
`revokePortalInvite` and `assignRole` are tested and reachable from nothing on screen.
`setTypeBookable` was the third and the sharp one — *publishing to the public booking page* was
something only somebody with database access could do, against a milestone whose criterion is
that nobody at the business has been given any. It is now a section on the Work screen, gated on
the booking module because a module hides what it owns everywhere, and
`infra/supabase/snippets/publish-bookable-type.sql` is deleted rather than left as a second way
to do it. `docs/walkthrough.md` names the remaining two where an operator would hit them and
`docs/roadmap.md` M4 records the debt; do not add a third without noticing.

**`add-platform-staff.sql` is not that fourth, and the distinction is the point.** Adding a
colleague to `platform_staff` also needs database access, and it is a *decision* rather than a
debt: the table has no insert policy and no grant to any application role because a screen for it
is a staff **write**, which is exactly D28's trigger to revisit and is not spent. Nothing is owed
until somebody makes it. The first staff write with a real claim is provisioning a tenant (D29),
which M5 owes.

**Cancellation was the first place "configuration is enough" was checked and found short.**
`roadmap.md` recorded that cancelling needed no new code — a status the tenant configures and a
transition into it. That was right about D6 and wrong about I7, whose predicate knew nothing
about status. The fix is one tenant-answered question, not a platform-owned `is_terminal`; see
M4 in `docs/roadmap.md` for why the distinction is the whole point.

**The external actor is one axis and it is decided (D22, amended by the booking slice).** An
outsider is a row in `external_actors` binding one `auth.users` id — from anonymous sign-in, so
`auth.uid()` is real and I11 is untouched — to **exactly one** organization. The scope function
is `app.current_external_tenant()`, which returns at most one uuid and is deliberately not
`app.current_tenant_ids()`; nothing shares a name or a signature between them. Three things are
easy to undo by accident:

- **The binding is immutable, and `created_by` is what scopes an outsider to their own rows.**
  The first draft put a `customer_id` on the binding, which meant granting an outsider `update`
  on it — and an outsider who can write a customer id onto their own binding can write somebody
  else's. Do not add that column back without a caller and a different mechanism.
- **`external_actors_one_tenant_per_user` is on `user_id` alone**, not led by
  `organization_id`. That is I2 inverted on purpose: one actor may never span two tenants.
  `schema-conformance.test.ts` names it as its one exception.
- **A public URL never carries a tenant id.** `/book/[slug]` resolves through
  `public.booking_organization`, which answers only for a business that publishes a bookable
  type — so the id the binding is made against is one the server resolved, never one a URL
  supplied. That is D17 applied where there is no membership to re-derive against.
- **No platform sentence appears on a public page.** `constraints.md` forbids hardcoding a
  claim a business makes about itself, and a booking page is exactly that; the tenant's own
  words come from `organization_profiles` and the platform speaks only where it describes
  application state. A business that has configured nothing renders its own name and stops.
  `public-profile.test.ts` scans the public routes' source, so this fails at the gate rather
  than in front of a customer.
- **An external actor holds insert permission on exactly one table — its own binding — and on
  nothing else.** Every write *about the business* goes through `create_booking`, one
  `SECURITY DEFINER` function whose first act is the scope check, and reads stay entirely on RLS.
  `booking.test.ts` asserts the refusals table by table.

  **This entry used to say "no insert permission on any table", and that was never true.**
  `beginBooking` has always inserted the binding directly, under the visitor's own session,
  because there is no scope to check against until the binding exists. The sentence described the
  design rather than the code, and it hid two real holes for the whole life of the axis, both
  fixed by `20260902000002`: the insert policy checked `user_id = auth.uid()` and nothing about
  which organization was named, so any authenticated caller could bind to any tenant; and
  `customer_id` was insertable, because `20260829000003` granted `insert` on the whole table and
  the column arrived eight migrations later and inherited it — which made an outsider *be* the
  customer they named, for reading, since `app.current_external_customer()` is what
  `invoices_select_external` and `payments_select_external` narrow to and they narrow to nothing
  else. Two migrations each said the other had it covered.
- **A binding may only name a business that publishes bookings**, and the predicate is
  `app.publishes_bookings` — one definition, called by `booking_organization` to resolve a slug
  and by `external_actors_insert` to admit a binding. It was inline in the first of those until
  the second needed it, which is the extract-then-call-twice rule arriving at a policy.

**Platform staff are the fourth caller shape, and it is a Postgres role (D28, M5).** A member is
scoped by `app.current_tenant_ids()`, an external actor by `app.current_external_tenant()`, the
`payment_webhook` writer by holding no table grant at all — all three narrow by construction.
Staff need the opposite, read across every tenant, and are members of none, so every policy in
this database declines for them. The role is `platform_staff`; a user listed in the
`platform_staff` table arrives in it because `custom_access_token_hook` rewrites their token's
`role` claim, so identity still reaches Postgres as the caller's own JWT and D17 is applied
rather than bypassed. Four things are easy to undo by accident:

- **It reads and writes nothing, and that is enforced twice** (I21). No write policy names the
  role, *and* the role holds no `insert`, `update` or `delete` grant on any table — so a
  permissive policy added later still hits a missing privilege. `platform-staff.test.ts` asserts
  the `permission denied` message rather than merely a failure, because the difference between a
  policy declining and a privilege not existing is the whole guarantee.
- **`platform_tenants` is `security_invoker` and must stay so.** A view defaults to running as
  its owner, which would make it the service-role client D14 and D28 both refuse, with extra
  steps. The test reads `pg_class.reloptions` rather than trusting the definition, because
  dropping that flag is one word and nothing else about the view would look different.
- **`using (true)` is correct here and nowhere else.** The narrowing is the role, not the row.
  A staff policy calling `app.has_capability` would be asking a tenant's authorization question
  on an axis that has no role to ask about — which is why this axis gets no `app` schema usage.
- **`platform_staff` carries no `organization_id` and never will**, which puts it outside I2
  rather than in violation of it: not being scoped to a tenant is the entire point.
- **The one write staff hold is `provision_organization`, and it is an `execute` rather than a
  grant** (D29, and D28's trigger to revisit firing once). The role still holds no `insert`,
  `update` or `delete` on any table. **I21's line is that staff may bring a tenant into existence
  and may never reach into one that exists** — which holds because no function on this axis takes
  an organization id. A write grant on `organizations` and `memberships` was the obvious
  alternative and is indistinguishable, at the privilege level, from letting staff rename a live
  business and add themselves to it.
- **The staff member does not become a member of what they provision**, and `created_by` on the
  organization, its founding role and its membership is the *owner*. The tenant's own rows carry
  no GOLD user id anywhere, which is the whole of D28's objection to solving this with a
  membership. The event is the deliberate exception: `actor_id` is the staff member because they
  are who acted, and the readable half is snapshotted into the payload as a name (I8).
- **Both doors write `organization.created`, and only the payload differs.** That is D29's
  correction expressed as a row — provisioned and self-served are two doors onto one creation
  path, not two kinds of tenant. A reader filtering on the action keeps working; one asking how a
  business arrived reads `provisioned`. `provisioning.test.ts` builds one business through each
  door and compares what came out, because "one creation path" is a claim that decays silently.

**Founding is open to a registered account, and closed to everybody else.**
`create_organization` is granted to `authenticated` and to nothing else (`20260901000001`), so
a business comes into existence either because somebody at GOLD provisioned it or because
somebody who registered with an address founded it — two doors onto one creation path, which is
D29's actual axis. **Registration stays open because an account is not a tenant**: provisioning
names an owner who must already have an `auth.users` row, and creating one needs the admin API
`apps/web` may not hold, so closing `/sign-up` literally would leave provisioning nobody to hand
a business to. D29's consequence line said "closes `/sign-up`" and that was the wrong target,
recorded rather than quietly reinterpreted.

**This paragraph said the opposite for a day and the code was right.** `20260830000005` revoked
the grant on D29's argument — an empty business with nobody on the far side doing the
configuring is not a product — and `20260901000001` put it back on the argument that migration
could not see: somebody who signs up gets a page saying they belong to no business and, with the
grant revoked, **no way forward at all**. Closing a door is only honest when the person standing
at it can get in another way, and being provisioned is not something they can reach from a
screen. Supabase's advisor reports this function as executable by signed-in users, and that is
the design rather than a breach.

**The function is not dropped and must not be, and its guard is now the one doing the
refusing.** It keeps `20260830000001`'s guard — an anonymous session may not found a business —
which was found the expensive way. An anonymous visitor from the booking flow arrives on the
same `authenticated` role as a registered one (D22), so while the grant was revoked that guard
was unreachable and the missing grant refused first; now it is the outer guard again.
`tenancy.test.ts` asserts the message rather than merely a failure, and `provisioning.test.ts`
asserts the same rule at the door a person actually uses; neither alone is the guarantee.

**Every test fixture provisions.** `apps/web/tests/helpers/founding.ts` is the one place a test
business comes into existence, replacing twenty-nine local copies — and the point is that the
suite now exercises the real path rather than a shortcut around it. A founding path only the
tests could reach would be the second creation path D29 forbids.

**The staff console answers three of M5's four questions, and the fourth is deferred with its
reason recorded.** Who exists, what they have switched on and when they last did anything are on
screen; *what is failing* is not, because nothing in this schema records a failure — a
`DomainError` is raised, rendered and dropped. A failed-thing table here would be a table with no
writer. M6's automation is the first thing that can fail with nobody watching, and `roadmap.md`
M5 records the deferral rather than leaving it as a gap somebody finds by looking.

**A recorded cost is still not a price.** `work_item_costs` is an observation about a job that
happened; a price is a claim the business publishes in advance. They are two tables and
neither is derived from the other. `jobEconomics` subtracts one from the other and is the only
thing that may: it **calls** `priceWorkItem` rather than totalling lines, and `totalCost` is
the one place costs are added. **It returns `null` for margin rather than converting a
currency** — a rate has a date, and a date makes this accounting software. A job priced in one
currency with costs in another has two totals and no margin, and the screen says so.

**`events` has a reader now**, and reading it found two things worth keeping. Payloads are thin
about vocabulary and thick about snapshots, and that split is correct: a status name is a row
the tenant owns and is resolved at render (D6), while an amount or a title is a term somebody
agreed to and is snapshotted (I8). And an event can name the *other* side of what it records —
`location.linked` names the location and carries the customer in its payload — so a reader
filtering on `entity_id` silently misses it. That is a standing hazard of a polymorphic subject,
not a bug that was fixed once.

**No pricing *rule engine* exists, and that is a finding rather than a gap.** Both business
shapes in the M3 test price correctly from a catalogue and a quantity, so nothing called for
one. Quantity is an integer and nothing rounds anywhere — a business billing half-hours prices
per half-hour — and when a fractional quantity earns its way in, how a half-cent rounds is a
pricing decision that belongs in `priceWorkItem`.

**Two words that are not interchangeable, and confusing them already deleted a feature.** A
**module** is what a tenant switches on, is billed for, and sees in their navigation — CRM,
Bookings, Dispatch — and it is a row, never a directory. An **engine** is code that owns
entities and rules, and it is the only thing `constraints.md`'s two-pieces-of-evidence bar
governs. They are not one-to-one: Scheduling, Dispatch, Bookings and Maintenance are four
modules over one scheduling engine, and CRM is a module with no engine at all. Before applying
any rule from *Scope and abstraction*, name the noun it governs. `constraints.md` D25 has the
full record and `docs/roadmap.md` M3 has what it cost.

**Dashboard configuration and business rules are not built** — no dashboard, nothing that
triggers anything — and `docs/roadmap.md` records that as a removal rather than a quiet
deferral. **Module enablement was removed from M3 with them and should not have been**; it
lands in M4 and the reasoning is in both documents above.

`docs/starting_conversation.txt` is an archived source, not a governing document. It records
the thinking that led here and is superseded by `docs/constraints.md` wherever the two
disagree — in particular D2, D3, D5, and D10-D12, each of which records what the
conversation recommended and why this repo diverges.

## Intended layout

Nothing here is created before a slice needs it. `apps/web`, `infra/supabase`, and `docs`
exist; the rest does not.

```text
apps/
  web/              Next.js — every surface a browser reaches, grouped by whose it is (D20)
    app/            routes; components with one caller sit beside their route
      (marketing)/  GOLD's own site. GOLD's voice — NOT the per-tenant marketing surface,
                    which D20 still defers. The two shared one word until M5.
      (auth)/       sign in, sign up. The one group with a layout — both pages shared it.
      (public)/     book/{slug} and portal/{token}: a tenant's own customers, a tenant's own
                    words. `public-profile.test.ts` scans these and no platform sentence
                    may appear in them.
      (platform)/   the staff console, for us rather than for a tenant (D28). No sidebar and
                    no `navigation.ts` entry: those nouns belong to a business and this is
                    not one.
      organizations/ the operator shell. Deliberately UNGROUPED: `navigation.test.ts` scans
                    `[organizationId]/` for areas, and a group folder inside it would hide
                    its children from that scan.
    features/       UI a second *surface* needs — see its README. Empty until that happens.
    components/     shared controls, extracted at the third caller (D23)
    lib/domain/     the business rules. Nothing in features/ or app/ decides anything.
    lib/adapters/   vendors. Domain code imports the capability, never the implementation.
    proxy.ts        Next 16's middleware. Refreshes the session; not the auth boundary (I12).
    tests/          the suites. They run against a real Postgres — see Commands.
  api/              Python. Webhook ingress (M4, D26), the automation clock (M6, D24, D30) and
                    the tool loop (M8, D34); retrieval and realtime later. Serverless functions
                    on Vercel — never a daemon, which D24 forbids outright
    app/core/       configuration, the database handles, one place that mints a machine
                    token — and one that pointedly does not, forwarding a caller's instead
    app/ai/         the tool loop and the two registries it reads. No SQL, no arithmetic
    app/channels/   sending a message to a person, as a capability
    app/conditions/ what the world is doing at a place, as a capability
    app/integrations/ the only place this repo's Python names a vendor
    app/api/        the HTTP entrypoints — one file, one route. NOT `apps/api/api/`:
                    `vercel.json` configures the vendor's default away (see its README)
  desktop/          Electron shell (M10; not before)
packages/           Empty until a package has two consumers. See constraints.md.
infra/
  supabase/         migrations, policies, seed
docs/
.claude/commands/   The reusable prompts
```

**`apps/api` exists as of M4, and as of M8 it holds three endpoints.** D26 brought it forward from M6:
Stripe calls in with no human session, D2 gives webhook ingress to Python, and the alternative
was a route under `apps/web/app/api/` — a second thing called *api*, inside the app that is
not the API. **There is no `api/` directory under `apps/web` and none may be added.** M6 added the second:
`/tasks/automation-tick`, running as `automation_runner` — a Postgres role holding no grant on
any table and a handful of executes, which is `payment_webhook`'s shape on a second axis. M8
added the third, `/ai/ask`, which breaks that pattern deliberately: it has **no role**, mints
nothing, and forwards the asking person's own token, because unlike the other two it is called by
somebody who is sitting there (D34). That is also what brought `app/ai/` — the loop, the tool
registry, the provider registry — and `app/integrations/anthropic/`, the first vendor SDK in this
runtime. There is still no `domains/` and no `workers/`. Its tests are `python -m pytest apps/api/tests`, and **they are
in the check gate as of M8** — `pnpm check` runs them after the TypeScript half. They were left
out for two milestones while this runtime was two handlers that decided nothing; the loop
arriving is what made the gap worth closing rather than naming.

**A route group is a layout boundary and never a security boundary.** Nothing is protected by
living in `(auth)` or reachable by living outside it — `proxy.ts` decides what an anonymous
caller may open, by path, and a group does not change a path. `(platform)` is the newest proof:
it exists as of M5, and what keeps a member out of `/platform` is that `platform_tenants` runs
`security_invoker` — a member selecting from it sees their own organizations and a stranger sees
nothing. The staff check on the page is courtesy of the same kind `proxy.ts` is; delete it and
the page shows a non-staff visitor an empty list, which is ugly and still correct. The console
was a Postgres role before it was a directory, which is the order D28 required.

Four layout rules carry reasoning that is easy to lose:

- **`apps/` means "a deployable this repository ships."** `apps/web`, `apps/api` and
  eventually `apps/desktop` are all that, which is the layout
  `docs/starting_conversation.txt` prescribes. `pnpm-workspace.yaml` therefore names its
  members instead of globbing `apps/*`, so pnpm never tries to manage the Python one — the
  trade is that a new workspace package must add itself to that file by name (D3).
- **`packages/` stays empty until something has two consumers.** A workspace package with
  one consumer buys a build step and a `dist/` for no isolation.
- **There is no `src/` under `apps/web`, and none may be re-added.** `app/`, `components/`,
  `features/`, `lib/`, `proxy.ts` and `tests/` sit directly under it, which is the layout
  `docs/starting_conversation.txt` draws. Next supports both and `create-next-app` scaffolded
  the other one; a directory that contains everything except `tests/` distinguishes nothing,
  and `apps/web` is already the boundary `src/` was nesting inside. `@/*` resolves to
  `apps/web/*` in `tsconfig.json` and `vitest.config.mts` — two files, and they must agree.

## Commands

**The check gate is `pnpm check`, from the root** — `apps/web`'s typecheck, lint, tests and
build, then `apps/api`'s pytest. Nothing is done until it passes end to end. Report a failure
verbatim; do not summarise one.

**It grew the Python half at M8, and the gap it closes was real.** `apps/api` had tests from M4
and nothing ran them, which was tolerable while that runtime was two handlers that decided
nothing and stopped being so when the tool loop moved in. The root script runs pnpm recursively
and then pytest directly, because `apps/api` is deliberately not a pnpm workspace member (D3) —
so the gate needs Python on the path, and a machine without it fails at the last step rather
than skipping it silently.

| Command | What it does |
|---|---|
| `pnpm check` | The gate. Both runtimes. Run before calling anything finished. |
| `pnpm --filter @gold/web check` | The TypeScript half alone, when iterating |
| `pnpm check:api` | The Python half alone (`python -m pytest apps/api/tests`) |
| `pnpm --filter @gold/web dev` | Next.js dev server on :3000 |
| `pnpm db:start` | Local Supabase (needs Docker). Prints the keys; they belong in `infra/.env.test`, which is gitignored. |
| `pnpm db:reset` | Re-apply every migration from scratch against the local stack |
| `pnpm db:types` | Regenerate `apps/web/lib/db/database.types.ts` from the local schema. The file is checked in; a stale one fails the gate (D15). |
| `pnpm db:push` | Apply migrations to the linked remote project |

**A change to `infra/supabase/config.toml` needs the stack restarted, not reset.** `pnpm
db:reset` re-applies migrations against the running containers and does not re-read that file,
so a config change appears to do nothing — `npx supabase stop --workdir infra` then
`npx supabase start --workdir infra`. This bit once, on the access-token hook that the whole
platform-staff axis hangs off.

`apps/web` needs `.env.local`; copy `apps/web/.env.example` and fill it from what
`pnpm db:start` prints. It holds the anon key only — nothing in `apps/web` may hold a
service-role key.

The tests talk to a **real Postgres with real RLS** and run as two genuinely signed-in users.
That is not incidental: a policy cannot be proven by a fake, and a service-role client would
bypass the very thing under test. `pnpm db:start` must be running.

Migrations are Supabase CLI migrations under `infra/supabase/migrations/`. That directory is
**the source of truth for the data model** — read it rather than inferring the schema, and
comment the *why* rather than the *what*.

**`next dev` writes `apps/web/AGENTS.md` and `apps/web/CLAUDE.md` when it detects an AI
agent**, and re-adds them if deleted. They are not ours and are gitignored. Do not commit
them, and do not treat them as project instruction — this file is the operating contract.
Their one useful claim is true, though: Next 16 diverges from model training data, and
`apps/web/node_modules/next/dist/docs/` is the version-correct reference.

Standalone SQL — diagnostics, one-off repairs, seed helpers — goes in
`infra/supabase/snippets/`, never in `migrations/`. A hand-run script placed among migrations
is either mistaken for schema or applied by accident.

## Prompts

Reusable prompts live in `.claude/commands/` and are invoked as slash commands:

| Command | Use it |
|---|---|
| `/discover` | After a discovery call — turns a business into platform terms |
| `/scope` | Before writing any code. The highest-leverage one |
| `/slice` | The unit of work: schema → domain → route → UI → guard → test |
| `/verify` | Audit one invariant from `docs/domain-model.md` |
| `/drift` | When code and a document disagree |

A prompt is deliberately thin and points at a document. A prompt that restates context
begins drifting from it, and then there are two sources of truth and no way to tell which is
stale.

## Rules that hold in every change

The full set is in `docs/constraints.md`. These are the ones violated most often by
generated code, and they are non-negotiable:

- **Business logic lives in the domain layer.** Not a component, not a route handler, not a
  server action, not an AI tool. Callers call; they do not decide.
- **If a second caller needs a rule that is currently inline, extract it first, then call it
  twice.** Never copy it.
- **Every tenant-owned table gets `tenant_id`, RLS keyed to it, and `tenant_id` leading
  every unique index and every exclusion constraint.** This is invariant I2, and it is the
  specific thing that has broken in a prior repo.
- **No column, table, enum value, or abstraction without a caller in the same change.**
- **Nothing is hardcoded that a business might want different** — statuses, terminology,
  prices, hours, currency. All of it is per-tenant configuration.
- **A table-wide `grant insert`/`grant update` is a promise about every column that table will
  ever have.** A column added by a later migration inherits it silently, so a migration that
  adds a column the caller must not write has to `revoke` and re-`grant` by column — writing "in
  no column grant" in its own comment does not make it so. This has been found twice
  (`external_actors.customer_id`, `work_items.scheduled_during`), and both times two migrations
  were individually correct and each assumed the other had it covered. `schema-conformance.test.ts`
  now asserts the platform-maintained columns hold no grant.
- **Money is integer minor units. Time is `timestamptz`.**
- **A vendor belongs behind an adapter.** Domain code names capabilities, never providers.
- **An LLM gets domain tools with validation and permissions attached, or it gets nothing.**

## When you finish a change

State which invariant in `docs/domain-model.md` the change newly enforces, and fill in its
`Enforced by` cell. That column is the real backlog: an invariant with nothing in it is an
intention, not a guarantee.

If a change makes a document wrong, fix the document in the same commit. Do not soften its
wording until it stops contradicting the code — that is how a constraint file with teeth
degrades into advice.
