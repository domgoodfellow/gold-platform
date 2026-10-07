# ADR-028 — Schema evolves through forward SQL migrations with generated types

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Database integrity is load-bearing and must be reviewable independently of application ORM state.

## Decision

PostgreSQL schema changes are explicit forward SQL migrations. Applied migrations are immutable. TypeScript database types are generated from the schema and checked in as derived artifacts.

## Consequences

- Schema history remains reproducible.
- Generated types catch drift but do not replace schema truth.

## Rejected alternatives

- Editing applied migrations.
- Hand-maintained TypeScript schema types as authority.

## Enforcement / current owners

- `docs/data.md`
- `docs/development.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
