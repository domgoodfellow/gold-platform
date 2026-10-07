# ADR-004 — Canonical operator workspaces

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Commercial catalogue names and historical navigation names drifted from the actual kinds of work operators perform.

## Decision

The canonical operator workspace identities are CRM, Communications, Marketing, Support, Finance, AI, Automations, Field and Studio.

## Consequences

- Workspace keys are stable architectural identities.
- Legacy routes may remain temporarily without redefining ownership.
- A registered workspace may remain invisible until it has real operating surfaces.

## Rejected alternatives

- Sales/Service/Insights as mandatory operator workspaces.
- Generating workspace identity directly from the commercial catalogue.

## Enforcement / current owners

- `docs/product.md`
- `docs/ui-system.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
