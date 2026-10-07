# ADR-023 — GildOps naming migrates forward without rewriting history

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

The repository still contains load-bearing GOLD technical identifiers and historical migrations.

## Decision

Human-facing prose uses GildOps. Technical namespace changes are bounded migrations. Applied migrations and historical Git evidence are never rewritten just for branding.

## Consequences

- `@gold/*` may remain until an atomic namespace migration.
- New product copy does not perpetuate legacy branding.

## Rejected alternatives

- Global search-and-replace across repository and migration history.

## Enforcement / current owners

- `docs/product.md`
- `docs/architecture.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
