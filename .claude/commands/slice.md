---
description: Implement one vertical slice - schema, domain, route, UI, guard, test
argument-hint: <slice name> [governed by D-n or invariant]
---

Implement one vertical slice: schema, domain, route, UI, guard, test.

Slice: $ARGUMENTS

Read `docs/constraints.md` and `docs/domain-model.md` first. These rules hold regardless of
what the task appears to need:

- Business logic goes in the domain layer. Not a component, not a route handler, not a
  server action, not an AI tool.
- If a second caller now needs a rule that is currently inline, extract it first, then call
  it twice. Do not copy it.
- Every tenant-owned table gets `tenant_id`, RLS keyed to it, and `tenant_id` leading every
  unique index and every exclusion constraint.
- Migrations are the source of truth for the data model. Comment the why, not the what.
  Never modify a migration that may have been applied.
- No column, table, enum value, or abstraction without a caller inside this slice.
- Nothing hardcoded that a business might want different: statuses, terminology, prices,
  hours, currency.
- Money is integer minor units. Time is `timestamptz`.
- A vendor belongs behind an adapter. Domain code names capabilities, never providers.

When finished:

1. Run the check gate and report any failure verbatim. Do not summarise a failure.
2. State which invariant this slice newly enforces, and update its `Enforced by` cell in
   `docs/domain-model.md`.
3. If this slice made any document wrong, fix the document in the same change.
