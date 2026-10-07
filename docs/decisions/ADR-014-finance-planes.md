# ADR-014 — Tenant Finance and Platform commercial control are separate

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Money flows in opposite directions: customers pay an Organization, while Organizations pay GildOps and GildOps pays providers.

## Decision

Tenant Finance owns customer-to-Organization pricing, quotes, invoices, payments and job economics. Platform Administration owns GildOps plans, subscriptions, retail rates, provider costs and margin.

## Consequences

- Provider cost remains platform-private.
- Tenant Finance can remain ordinary for GildOps' own Organization.

## Rejected alternatives

- One Finance ledger/surface for both directions.
- Exposing wholesale/provider economics through tenant Finance.

## Enforcement / current owners

- `docs/product.md`
- `docs/domain-model.md`
- `docs/architecture.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
