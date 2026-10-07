# ADR-006 — Workspace visibility requires a real surface and Home is the parent

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Placeholder workspace rows and duplicated Home/Overview destinations created navigation that advertised work users could not actually perform.

## Decision

A workspace renders in navigation only when the Organization/user has at least one real reachable operating surface. The row body opens Workspace Home; the chevron controls disclosure; Home is not repeated as a child.

## Consequences

- No coming-soon workspace rows.
- Disclosure state and navigation action are distinct.
- Overview is not a competing canonical page type.

## Rejected alternatives

- Always showing every canonical workspace.
- Making the chevron and row body the same action.

## Enforcement / current owners

- `docs/product.md`
- `docs/ui-system.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
