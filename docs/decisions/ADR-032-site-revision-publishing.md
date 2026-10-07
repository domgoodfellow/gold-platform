# ADR-032 — Studio publishes a whole site revision

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Publishing pages independently can expose navigation/content from different versions and makes restore/history ambiguous.

## Decision

Studio publishes one immutable site revision containing pages, navigation and typed sections. Restore copies an older revision forward into a new draft.

## Consequences

- Visitors see a coherent site state.
- Preview and public rendering can share one renderer.

## Rejected alternatives

- Per-page publication pointers.
- Mutable published revision.
- Arbitrary executable page components.

## Enforcement / current owners

- `docs/public-web.md`
- `docs/domain-model.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
