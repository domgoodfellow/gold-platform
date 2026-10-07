# ADR-001 — Person, Organization and Platform Administration are separate scopes

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Identity, tenant operation and SaaS control have different authority and lifecycle. Earlier implementations blurred platform staff, organization membership and personal account state.

## Decision

GildOps models three distinct operating scopes: Person, Organization and Platform Administration. URLs, UI and authorization must preserve the distinction.

## Consequences

- Personal settings are not Organization settings.
- Organization membership does not imply Platform authority.
- Platform Administration does not become a special tenant.

## Rejected alternatives

- One universal admin/application scope.
- Inferring scope from the current route or sidebar alone.

## Enforcement / current owners

- `docs/domain-model.md`
- `docs/architecture.md`
- `docs/security.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
