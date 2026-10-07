# ADR-007 — Insights, Library and Settings are shared surfaces, not operator workspaces

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Several important cross-cutting capabilities do not represent one ongoing operating domain.

## Decision

Insights is cross-cutting analysis, Library is shared Organization infrastructure and Settings configures the environment. None is a canonical operator workspace.

## Consequences

- They may have routes and deep navigation.
- Contextual entry points can appear from workspaces without transferring ownership.

## Rejected alternatives

- A global Insights workspace.
- Treating Settings as another business workspace.

## Enforcement / current owners

- `docs/product.md`
- `docs/ui-system.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
