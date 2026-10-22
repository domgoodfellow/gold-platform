# ADR-049 - Explicit workspace Dashboard navigation

**Date:** 2026-10-22
**Status:** Accepted (owner-approved GuildOps V1 work order)
**Supersedes:** ADR-047 point 1 only
**Superseded by:** None

## Context

The GuildOps V1 work order explicitly replaces the heading-as-Home model. Operators need a selected, named destination for each workspace landing page across desktop, rail and mobile navigation.

## Decision

Each accessible workspace exposes Dashboard first, with Gauge, at its existing canonical landing route. The workspace heading is contextual identity, without a link or selected state. Configuration-only access never grants Dashboard access. Organization Home and Platform Overview retain their names.

All other ADR-047 location and identity contracts stand. ADR-046 contextual ownership and eligibility and ADR-048 sidebar authority remain binding. No dashboard route or duplicate screen is introduced.

## Consequences

Dashboard participates in the same authorized projection, selected state, keyboard order and mobile menu as other operating destinations. Workspace-root page location names Dashboard; descendant trails retain workspace identity. Business navigation ordering cannot move Dashboard below operational destinations.

## Rejected alternatives

Keeping a linked workspace heading would create competing destinations. Adding a dashboard route would fragment stable addresses. A header strip would violate ADR-048.

## Enforcement / current owners

`docs/product.md`, `docs/ui-system.md`, `docs/architecture.md`; `lib/navigation.ts`, `lib/shell.ts`, `lib/route/page-location.ts`, the organization shell and business navigation decorator. Shell projection, location, navigation architecture, component and workspace browser suites enforce the contract.
