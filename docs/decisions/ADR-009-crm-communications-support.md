# ADR-009 — CRM, Communications and Support own different lifecycles

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Relationship history, conversation history and problem resolution often appear together but answer different business questions.

## Decision

CRM owns the relationship, Communications owns the conversation/channel, and Support owns the problem/request resolution lifecycle.

## Consequences

- A Support Case may relate to a Conversation and Customer without copying them.
- Not every message becomes a Case.

## Rejected alternatives

- Support as another Inbox.
- CRM owning support-resolution state.

## Enforcement / current owners

- `docs/product.md`
- `docs/domain-model.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
