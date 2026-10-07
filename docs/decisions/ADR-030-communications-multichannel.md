# ADR-030 — Communications is multi-channel with one conversation ownership model

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

SMS and email share the operator's conversational task but have different transport semantics.

## Decision

Communications owns conversation/channel continuity. Channel-specific identities and delivery facts remain typed, while Inbox can project several channels into one operator task.

## Consequences

- Unified Inbox does not erase channel-specific data.
- CRM/Support can relate to Conversations without copying them.

## Rejected alternatives

- Separate independent inbox product per channel.
- One fake generic message shape that loses email/SMS semantics.

## Enforcement / current owners

- `docs/product.md`
- `docs/domain-model.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
