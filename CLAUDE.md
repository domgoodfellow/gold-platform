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

**M1 is under way.** `apps/web` exists, the tenancy kernel is migrated, and the check gate
runs. What exists is deliberately narrow: `organizations`, `memberships`, `events`, the one
tenant resolution function, and a single vertical slice that creates and lists an
organization. Everything else in the layout below is still absent on purpose.

`docs/starting_conversation.txt` is an archived source, not a governing document. It records
the thinking that led here and is superseded by `docs/constraints.md` wherever the two
disagree — in particular D2, D3, D5, and D10-D12, each of which records what the
conversation recommended and why this repo diverges.

## Intended layout

Nothing here is created before a slice needs it. `apps/web`, `infra/supabase`, and `docs`
exist; the rest does not.

```text
apps/
  web/              Next.js — marketing, booking, admin, customer portal
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
