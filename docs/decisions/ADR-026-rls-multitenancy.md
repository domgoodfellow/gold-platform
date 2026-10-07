# ADR-026 — Shared-schema multi-tenancy is enforced with RLS

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

GildOps runs many Organizations in one PostgreSQL schema. Application filters alone cannot provide a trustworthy tenant boundary.

## Decision

Tenant-owned records carry Organization scope and are protected by database authorization/RLS. Cross-tenant relationships are structurally constrained where possible.

## Consequences

- Direct requests cannot bypass tenant filtering.
- Schema review/tests must prove isolation under real Postgres.

## Rejected alternatives

- One database per tenant as the default architecture.
- Client/application filtering as the only tenant boundary.

## Enforcement / current owners

- `docs/security.md`
- `docs/data.md`
- `docs/architecture.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
