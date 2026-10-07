# ADR-013 — Entitlement and authorization are independent

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Commercial access and human permission answer different questions and must fail independently.

## Decision

Every protected optional capability may require both Organization entitlement and actor authorization. Neither substitutes for the other.

## Consequences

- Navigation projection can consume both states but is not enforcement.
- RPC/API/automation paths must not bypass missing entitlement.

## Rejected alternatives

- Role capability used as a billing entitlement.
- Plan purchase granting every member operational permission.

## Enforcement / current owners

- `docs/domain-model.md`
- `docs/security.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
