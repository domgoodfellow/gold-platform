# ADR-018 — AI acts only through authorized domain tools

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Model output is probabilistic and cannot be allowed to become authority merely because it was generated inside GildOps.

## Decision

AI reads and acts through narrow tools that preserve actor, Organization, entitlement, permission and domain validation. Consequential actions use the normal domain operation and approval where required.

## Consequences

- AI output remains untrusted input.
- The model does not receive a general database credential.

## Rejected alternatives

- Direct unrestricted SQL/tooling for the model.
- A shadow AI write path.

## Enforcement / current owners

- `docs/product.md`
- `docs/security.md`
- `docs/architecture.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
