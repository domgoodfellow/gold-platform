"""Provider-independent, caller-independent business commands.

**What lives here.** A command a person, an AI tool, or a worker might all want to perform the
same way -- moving a customer's stage, writing up a call -- gets exactly one implementation, in
one module under this package, named after the Product it belongs to (`crm`, `communications`).
That module decides nothing RLS or a narrow database function would not decide again a moment
later; it exists so the decision has one caller-independent home, on the same terms `app/ai`
already reaches Postgres on rather than as a new authority of its own.

**What does not.** HTTP parsing and auth live in ``api``. Orchestration across authenticated
state, machine credentials, persistence and external calls lives in ``app.services``. Vendor
dialects live in ``app.providers`` and ``app.connectors``. A domain module here imports none of
those boundaries; it forwards the caller's token and calls a narrow database command.

**Incremental on purpose.** Most of this platform's business rules still live in
`apps/web/lib/domain/**`, in TypeScript, and stay there -- moving everything here would be the
rewrite `CLAUDE.md` explicitly refuses. A command is added under this package only once it is
genuinely reachable from more than one caller in a way that would otherwise duplicate a rule
between two languages.
"""

from __future__ import annotations
