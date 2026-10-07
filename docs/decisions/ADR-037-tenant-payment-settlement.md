# ADR-037 — Tenant payment processing keeps customer money out of GildOps

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Tenant Finance may collect payment from an Organization's customer. Mixing that settlement with GildOps' own platform billing changes ownership and regulatory/operational risk.

## Decision

Tenant payment processing uses the Organization's payment-processing relationship so customer funds settle to the Organization rather than GildOps. Platform subscription billing remains a separate provider path.

## Consequences

- Separate webhook/credential/ledger paths remain justified even when one provider supplies both.
- Tenant and Platform Finance remain independent.

## Rejected alternatives

- Routing tenant customer payments through GildOps' own merchant balance.

## Enforcement / current owners

- `docs/product.md`
- `docs/integrations.md`
- `docs/security.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
