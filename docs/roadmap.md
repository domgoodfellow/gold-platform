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
- Fifteen invariants are stated, all unenforced. That is expected and correct.

### Remaining

Nothing structural. M0 closes the first time `/scope` is used in anger.

---

## M1 — The kernel

> **Done when:** two organizations exist in one database, each with its own users,
> customers, locations, and work items, and no query, index, or constraint belonging to one
> can observe or block the other — demonstrated by a test that creates colliding rows in
> both tenants and expects success.

That test is the milestone. It is also the thing every prior attempt deferred.

Covers: `organizations`, memberships and roles, the tenant resolution function, RLS across
every table created so far, `Customer`, `Location`, `Asset`, `Work Item`, `Resource`,
`Document`, `Event`, and `Field Definition`.

Enforces: **I1, I2, I3, I11, I12** — and `Event` must ship with the first slice that writes
state, because it cannot be backfilled.

Two things that must be right here because they are expensive later:

- Every unique index and exclusion constraint leads with `tenant_id` (I2). The
  colliding-rows test exists specifically to catch this.
- Custom fields land now, not in a later phase (`constraints.md` D7).

---

## M2 — The work engine

> **Done when:** an operator can define a work item type, its statuses, and its allowed
> transitions from the admin UI without opening the database — and a work item moves through
> that lifecycle, consuming a resource for a window that nothing else can double-book.

Covers: work item types and statuses as data, transition validation, assignment, the
scheduling core over Work Item and Resource, availability calculation, checklists, time and
cost capture.

Enforces: **I5, I6, I7, I9, I13**.

`I7` is a database exclusion constraint. An application-level overlap check is not this
milestone.

---

## M3 — The configuration engine

> **Done when:** a new business can be stood up entirely through configuration — modules,
> roles, fields, statuses, forms, terminology, pricing rules, scheduling rules — with no
> migration and no deploy. The test is literally: configure a second business shape without
> a pull request.

Covers: module enablement per tenant, custom forms over field definitions, per-tenant
terminology, pricing rules, business rules, dashboard configuration.

Enforces: **I4, I10**.

This is the milestone that decides whether the platform is a platform. If standing up a
business shape still needs code, M3 is not done regardless of what has been built.

---

## M4 — Vertical one: field service

> **Done when:** one real field-service business runs its operations on GOLD — quotes or
> bookings in, work scheduled and assigned, work completed, invoiced, and paid — and the
> operator has never been given database credentials.

See `constraints.md` D5 for why field service rather than sales.

Covers: the modules this vertical actually needs, extracted at the moment a second caller
appears. Which modules those are is an output of this milestone, not an input.

---

## M5 — The AI layer

> **Done when:** an operator can ask "what work is at risk of being late today" and
> "which customers haven't been contacted in thirty days," and the answers are produced
> through the same domain tools a human uses, under that user's permissions.

Enforces: **I14**.

Do not start with autonomous agents. First make the AI good at *understanding* the system;
operating it follows. Every tool is a domain service that already exists — if a tool needs
new business logic, that logic belongs in the domain layer and the tool is a caller.

---

## M6 — Communications and the dialer

> **Done when:** a call is placed from the platform, recorded, transcribed, analysed, and
> attached to the customer timeline as events — and the analysis proposes actions that the
> domain layer executes rather than performing them itself.

This is where the Python plane arrives (`constraints.md` D2), and where `nextfund-portal`
gets harvested: capability tokens, inbound routing, recording, transcription.

The progression is deliberately staged, and each stage is sellable on its own:
record → understand → assist → automate → delegate.

Live rebuttals and voice agents are the last two stages, not the first.

---

## M7 — Desktop

> **Done when:** the Electron build renders the same React components as the web app, with
> no forked UI, and adds only what a browser genuinely cannot do — device access, local
> printing, tray, hotkeys, headset integration.

Electron is another client, not another product. The `packages/ui` extraction happens here,
at the moment a second consumer exists — and not before (`constraints.md`, never create a
workspace package with one consumer).
