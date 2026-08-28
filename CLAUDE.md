# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

This file is the **operating contract**: layout, commands, and the rules that hold in every
change. Depth lives in `docs/` — read the relevant document before designing anything
substantial. Do not restate their content here; when this file starts explaining the domain
instead of pointing at it, the set has begun to rot.

| Document | Read it when |
|---|---|
| [docs/vision.md](docs/vision.md) | You need to know what this product is and refuses to be |
| [docs/constraints.md](docs/constraints.md) | Before any structural change — includes decisions already taken |
| [docs/domain-model.md](docs/domain-model.md) | You are touching business logic, schema, or auth |
| [docs/roadmap.md](docs/roadmap.md) | You are deciding whether something belongs now |

**Status is not tracked in markdown.** Milestone criteria are in `docs/roadmap.md`; task
state lives on the issue board; shipped work goes in `CHANGELOG.md` on merge. Do not add
checklists to documents.

## Current state

**M1's, M2's and M3's acceptance criteria are met**, each demonstrated by one test rather
than by a table count.

`apps/web/tests/milestone-m1.test.ts` builds two whole businesses from byte-identical input
in one database and asserts that neither can observe or block the other.

`apps/web/tests/milestone-m2.test.ts` has an operator who is **not the founder** define a
work item type, its statuses and its allowed transitions, walk a work item through that
lifecycle, and commit it to a resource for a window nothing else can double-book — twice,
from identical input, down to the same instants. It touches no SQL, because "without opening
the database" is a claim about the path.

`apps/web/tests/milestone-m3.test.ts` stands up two whole businesses that share no word,
number, status, field, currency or timezone — an equipment hire yard in Amsterdam trading in
euro, a clinic in Tokyo trading in yen — through **one** `configure` function containing no
branch on which of them it is holding. The structure is the milestone and the assertions
inside it are secondary: had either shape needed a special case, that function could not
exist. The three invert each other deliberately — M1 runs byte-identical input, M2 runs
identical input twice, M3 runs maximally different input through identical code.

The kernel is `organizations`, `memberships`, `events`, `customers`, `roles`,
`field_definitions`, `locations`, `customer_locations`, `resources`, `assets`, `documents`,
`operating_hours` and — the work engine — `work_item_types`, `work_item_statuses`,
`work_item_transitions`, `work_items`, `work_item_type_checklist_items`,
`work_item_checklist_items`, `work_item_time_entries` and `work_item_costs`; and — the
configuration engine — `price_book_items` and `work_item_priced_lines`; the one tenant
resolution function and `app.has_capability`; and a vertical slice behind authentication for
each.

Six things about the work engine are load-bearing and easy to undo by accident:

- **There is no overlap check in the domain layer and none may be added.**
  `work_items_resource_not_double_booked` is a partial gist exclusion constraint, and
  `scheduleWorkItem` deliberately does not look before it writes — a check before an insert
  races identically, which is exactly what I6 says.
- **There is one availability calculation** (`freeWindows`), and it is advisory by
  construction. What keeps I5 honest is that it and the constraint agree.
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

Two about the interface, which M3 owns:

- **Every platform noun lives in `apps/web/src/lib/navigation.ts`**, and one string serves as
  both the navigation entry and the page's `<h1>`, so no *area* page writes a heading of its
  own. A detail route (`/work/{id}`, `/customers/{id}`) does, because its heading is the job's
  title or the customer's name rather than a platform noun — which is why `currentSegment` and
  `areaRootSegment` answer different questions: a detail route is *in* an area for the purpose
  of marking the navigation, and not *at* it for the purpose of the heading. Keeping the nouns
  in one place is what leaves the terminology override `constraints.md` defers a lookup rather
  than an excavation. `navigation.test.ts` fails on a route with no entry *and* an entry with
  no route.
- **The shell is not the authorization boundary.** Every page calls `requireOrganization` for
  itself even though the layout does too, because Next reuses a layout across client-side
  navigations without re-rendering it — a page leaning on its parent would be trusting a cache.
  A layout is no more the boundary than a redirect is (I12). Nothing in the navigation is
  capability-gated: each screen shows itself and explains what a role cannot do.

**A recorded cost is still not a price.** `work_item_costs` is an observation about a job that
happened; a price is a claim the business publishes in advance. They are two tables and
neither is derived from the other.

**No pricing *rule engine* exists, and that is a finding rather than a gap.** Both business
shapes in the M3 test price correctly from a catalogue and a quantity, so nothing called for
one. Quantity is an integer and nothing rounds anywhere — a business billing half-hours prices
per half-hour — and when a fractional quantity earns its way in, how a half-cent rounds is a
pricing decision that belongs in `priceWorkItem`.

**Module enablement, dashboard configuration and business rules are not built**, and
`docs/roadmap.md` records why each was removed from M3's coverage rather than deferred
quietly: there are no modules to enable, no dashboard, and nothing that triggers anything.

`docs/starting_conversation.txt` is an archived source, not a governing document. It records
the thinking that led here and is superseded by `docs/constraints.md` wherever the two
disagree — in particular D2, D3, D5, and D10-D12, each of which records what the
conversation recommended and why this repo diverges.

## Intended layout

Nothing here is created before a slice needs it. `apps/web`, `infra/supabase`, and `docs`
exist; the rest does not.

```text
apps/
  web/              Next.js — admin today; marketing, booking and customer portal are
                    what the directory is FOR, not what is in it (D20)
  desktop/          Electron shell (M7; not before)
services/
  api/              Python/FastAPI — intelligence and realtime plane (M6; not before)
packages/           Empty until a package has two consumers. See constraints.md.
infra/
  supabase/         migrations, policies, seed
docs/
.claude/commands/   The reusable prompts
```

Two layout rules carry reasoning that is easy to lose:

- **`apps/` means "a thing pnpm builds and ships." `services/` means "a thing deployed on
  its own runtime."** Python lives in `services/api/`, not `apps/api/`, because `apps/*` is
  the pnpm workspace glob. `docs/starting_conversation.txt` recommends otherwise;
  `constraints.md` D3 records why we diverge and how to reverse it.
- **`packages/` stays empty until something has two consumers.** A workspace package with
  one consumer buys a build step and a `dist/` for no isolation.

## Commands

**The check gate is `pnpm --filter @gold/web check`** — typecheck, lint, tests, build, in that
order. Nothing is done until it passes end to end. Report a failure verbatim; do not
summarise one.

| Command | What it does |
|---|---|
| `pnpm --filter @gold/web check` | The gate. Run before calling anything finished. |
| `pnpm --filter @gold/web dev` | Next.js dev server on :3000 |
| `pnpm db:start` | Local Supabase (needs Docker). Prints the keys; they belong in `infra/.env.test`, which is gitignored. |
| `pnpm db:reset` | Re-apply every migration from scratch against the local stack |
| `pnpm db:types` | Regenerate `apps/web/src/lib/db/database.types.ts` from the local schema. The file is checked in; a stale one fails the gate (D15). |
| `pnpm db:push` | Apply migrations to the linked remote project |

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
