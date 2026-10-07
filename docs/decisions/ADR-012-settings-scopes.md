# ADR-012 — Settings has five independent scopes

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Settings had duplicate Team/Access routes and mixed personal, tenant, integration and commercial ownership.

## Decision

Settings begins with Organization, Account, Access, Connections and Plan & usage. Peer scopes are not duplicated inside each other.

## Consequences

- Members/Invitations/Roles belong to Access.
- Personal identity belongs to Account.
- Organization configuration does not own Connections or subscription state.

## Rejected alternatives

- One large Organization Settings tree containing everything.
- Duplicate Team and Access pages pointing at the same lifecycle.

## Enforcement / current owners

- `docs/product.md`
- `docs/ui-system.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
