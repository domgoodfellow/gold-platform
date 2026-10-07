# ADR-020 — One commercial Usage Event ledger supports multiple provider cost components

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Customer-facing usage and provider billing units differ. One sold event can incur several independent provider costs.

## Decision

GildOps records one normalized tenant Usage Event and may attach multiple Provider Cost Components to it.

## Consequences

- Retail metering remains stable if provider billing decomposition changes.
- Provider cost reconciliation remains platform-private.

## Rejected alternatives

- One usage ledger per provider.
- Exposing raw provider billing units as the primary product model.

## Enforcement / current owners

- `docs/domain-model.md`
- `docs/data.md`
- `docs/architecture.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
