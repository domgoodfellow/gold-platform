---
description: Audit one invariant from the domain model against the actual tree
argument-hint: <invariant number, e.g. I7>
---

Prove invariant $ARGUMENTS from `docs/domain-model.md` holds in the current tree.

Show me the function, test, or database constraint that enforces it.

- If it is enforced only by convention, say so plainly. That is the finding.
- If a test covers it, name the test.
- If nothing enforces it, propose the cheapest thing that would — and do not implement it
  yet.
- If it is enforced somewhere other than what the `Enforced by` cell claims, correct the
  cell.

Do not claim an invariant holds because the code appears to do the right thing. Appearing to
is what conventions do, right up until they stop.
