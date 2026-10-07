# ADR-025 — Accepted proposals provision through the normal Organization path

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

A sale should not create a special customer-specific tenant path or bypass the product's commercial and access models.

## Decision

An accepted proposal hands off into normal Organization creation, owner Membership, commercial terms/Plan, Entitlements, configuration, readiness and launch.

## Consequences

- Provisioning is reusable across customers.
- Named customers do not become architectural exceptions.

## Rejected alternatives

- A special NextFund/enterprise provisioning codepath.
- Proposal acceptance directly creating ad hoc product flags.

## Enforcement / current owners

- `docs/product.md`
- `docs/roadmap.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
