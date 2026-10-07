# ADR-011 — Resource and Asset are role-based concepts

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Physical categories are ambiguous: a vehicle may perform work for one business and be the subject of work for another.

## Decision

A Resource is capacity used to perform work. An Asset is a thing tracked or serviced. Classification follows domain role, not physical type.

## Consequences

- The same physical category can map differently across Organizations.
- Scheduling depends on Resource semantics, not generic Asset state.

## Rejected alternatives

- Vehicle/equipment hard-coded globally as Asset or Resource.

## Enforcement / current owners

- `docs/domain-model.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
