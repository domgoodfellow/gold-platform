# ADR-036 — Travel is derived per Resource as scheduling feasibility

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Travel depends on adjacent scheduled work, route availability and each Resource's movement behavior. Persisting one duration on Work becomes stale.

## Decision

Travel is calculated as a feasibility edge for mobile Resources from authoritative surrounding schedule/location state. Unknown routing is a real third state and is never treated as zero.

## Consequences

- Staff can be warned about unknown travel while authoritative scheduling still controls commitment.
- Public booking must not expose other customers' coordinates.

## Rejected alternatives

- Persisted travel duration on Work Item.
- Defaulting every vehicle/person to mobile.
- Treating routing failure as zero minutes.

## Enforcement / current owners

- `docs/domain-model.md`
- `docs/integrations.md`
- `docs/roadmap.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
