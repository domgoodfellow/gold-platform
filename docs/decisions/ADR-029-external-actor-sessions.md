# ADR-029 — Public external actors use narrow sessions rather than Membership

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Portal customers and proposal recipients need authenticated continuity without becoming Organization operators.

## Decision

Public/customer flows use narrow external identity/session contexts. Bearer invite links may be exchanged into dedicated sessions; those sessions do not create Membership and are scoped to the specific public lifecycle.

## Consequences

- Portal and proposal identities can remain distinct.
- Revocation/expiry can invalidate access without touching operator accounts.

## Rejected alternatives

- Making customers Organization members.
- Carrying bearer tokens in every subsequent form/action.

## Enforcement / current owners

- `docs/security.md`
- `docs/public-web.md`
- `docs/domain-model.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
