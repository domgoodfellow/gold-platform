# ADR-005 — Workspace taxonomy is independent of the commercial catalogue

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Plans, Products, Modules and Features describe what GildOps sells. Workspaces describe where an operator performs work. The two relationships are many-to-many.

## Decision

Plan, Product, Module, Feature, Workspace and Page are separate concepts. Navigation is not generated from sellable catalogue rows.

## Consequences

- One workspace may compose several Products/Features.
- One Product may contribute to several workspaces.
- Commercial restructuring need not rewrite information architecture.

## Rejected alternatives

- One sidebar row per Product.
- Billing route access directly from catalogue hierarchy.

## Enforcement / current owners

- `docs/product.md`
- `docs/architecture.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
