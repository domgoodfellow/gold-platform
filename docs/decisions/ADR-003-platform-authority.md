# ADR-003 — Platform authority is explicit and independent

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Platform staff need cross-organization control-plane capability, but ordinary GildOps team members should not automatically receive it.

## Decision

Platform authority is represented and checked explicitly. Membership, role name or ownership of GildOps' Organization does not confer it.

## Consequences

- Platform permissions can be granular.
- Cross-tenant actions require explicit control-plane paths.
- Support access can be audited rather than hidden in universal bypasses.

## Rejected alternatives

- A special Postgres login mode the user must switch into.
- `if admin then allow everything` checks scattered through code.

## Enforcement / current owners

- `docs/security.md`
- `docs/architecture.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
