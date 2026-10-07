# ADR-024 — Discovery produces durable handoff evidence

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Sales discovery already learns operational facts the customer would otherwise be asked to enter again during setup.

## Decision

Discovery is stored as durable evidence that can seed recommendation, proposal and onboarding. Setup asks the customer to confirm/correct known facts rather than re-enter them.

## Consequences

- Sales and onboarding remain separate lifecycles while sharing evidence.
- Provenance and unresolved requirements can survive the handoff.

## Rejected alternatives

- Blank onboarding wizard after completed discovery.
- Sales notes as disposable prose only.

## Enforcement / current owners

- `docs/product.md`
- `docs/domain-model.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
