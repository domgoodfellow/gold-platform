# ADR-039 — Setup is a lifecycle over canonical configuration

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Onboarding/setup touches Organization profile, hours, offerings, resources, Connections, commercial state and readiness. Creating a second setup-specific copy would drift.

## Decision

Setup is a lifecycle/readiness map over canonical domain configuration. It may hold proposals/drafts and progress, but applying setup writes through the same canonical domain operations used elsewhere.

## Consequences

- Sales discovery can seed setup without becoming configuration authority.
- Setup completion can be computed from real readiness.

## Rejected alternatives

- A duplicate setup database holding permanent copies of Organization configuration.
- Wizard-only business rules.

## Enforcement / current owners

- `docs/product.md`
- `docs/domain-model.md`
- `docs/roadmap.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
