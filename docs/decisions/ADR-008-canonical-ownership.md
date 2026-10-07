# ADR-008 — One canonical owner per business fact

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

The same Customer, conversation or financial fact appears in multiple workflows. Copying it into each workspace creates conflicting lifecycles.

## Decision

Each durable business fact has one canonical owner. Other workspaces consume it through projections, relations or domain operations.

## Consequences

- Invocation does not transfer ownership.
- Cross-workspace UI may summarize without duplicating authoritative state.

## Rejected alternatives

- Workspace-specific copies of Customer or Conversation.
- Shared database tables mutated directly by every module without ownership.

## Enforcement / current owners

- `docs/domain-model.md`
- `docs/architecture.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
