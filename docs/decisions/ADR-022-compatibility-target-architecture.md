# ADR-022 — Compatibility does not define target architecture

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Legacy routes and names remain necessary while callers migrate, but treating them as current architecture prevents cleanup.

## Decision

Compatibility routes and legacy identifiers may remain temporarily; canonical ownership, naming and navigation are defined independently.

## Consequences

- Redirects can protect links without preserving duplicate IA.
- Tests/docs must distinguish compatibility from target state.

## Rejected alternatives

- Keeping both old and new routes as peer canonical paths.
- Removing compatibility before callers migrate.

## Enforcement / current owners

- `docs/architecture.md`
- `docs/ui-system.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
