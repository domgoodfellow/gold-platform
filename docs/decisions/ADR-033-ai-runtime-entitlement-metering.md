# ADR-033 — AI runtime selection, entitlement and metering are centralized

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Multiple AI entry points had independent provider/model configuration and could spend before commercial access was checked.

## Decision

Platform runtime assignment decides which provider/model fulfills each AI capability. Entitlement is checked at the point of spend and provider-reported usage is recorded once into normalized meters after it is known.

## Consequences

- Drafting/operator/public AI share provider assignment infrastructure.
- Missing usage remains unknown rather than estimated as fact.

## Rejected alternatives

- Hard-coded model IDs/keys per feature.
- Separate AI usage ledger.
- Estimating provider usage when the provider did not report it.

## Enforcement / current owners

- `docs/architecture.md`
- `docs/security.md`
- `docs/data.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
