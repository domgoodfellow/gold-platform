---
description: Scope a task against the constraints before any code is written
argument-hint: <one sentence describing the task>
---

Read `docs/constraints.md` and `docs/domain-model.md` before answering.

Task: $ARGUMENTS

Return only:

1. The invariants this touches, by number, and whether any is at risk
2. Any decision record (D-n) that already governs this
3. The exact files you would change, one line of reasoning each
4. What you would NOT change, and why
5. The single thing most likely to be wrong about this plan

If you cannot name an invariant or a decision record for this task, say so explicitly —
that is a finding about the documents, not a reason to proceed on judgment.

Do not write code. Stop here and wait.
