# ADR-031 — A Call is one business fact over provider legs

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Voice providers represent calls as legs/conferences/participants. Treating each leg as the business call breaks transfers and duration.

## Decision

GildOps models one Call as the business interaction, with provider legs/participants/events beneath it.

## Consequences

- Transfer/leave/end semantics operate on the Call lifecycle.
- Provider callbacks reconcile into one business record.

## Rejected alternatives

- One business Call per provider leg.
- Ending the business call when the first leg disconnects.

## Enforcement / current owners

- `docs/domain-model.md`
- `docs/integrations.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
