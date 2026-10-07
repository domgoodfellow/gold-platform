# ADR-010 — Work and Scheduling are separate authorities

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Work describes what must be done; availability and resource commitment are time/resource constraints. Duplicating schedule logic in booking or dispatch causes conflicting answers.

## Decision

Work owns the Work Item and operational lifecycle. Scheduling owns time/resource commitment, availability and feasibility. All consumers use one authoritative scheduling model.

## Consequences

- Booking and internal scheduling consume the same feasibility rules.
- Race-sensitive commitment is enforced authoritatively at write time.

## Rejected alternatives

- A separate booking availability engine.
- Storing scheduling decisions as UI-only state.

## Enforcement / current owners

- `docs/domain-model.md`
- `docs/architecture.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
