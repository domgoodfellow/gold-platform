# ADR-040 — Opportunities close independently of Customer relationships

**Date:** 2026-10-07
**Status:** Accepted
**Supersedes:** None
**Superseded by:** None

## Context

A Customer can represent an ongoing relationship while several pieces of potential business are open, won or lost independently. One Customer stage cannot represent those simultaneous lifecycles. The previous pipeline prototype demonstrates presentation, but its local records and state are not domain authority.

## Decision

CRM owns a first-class Opportunity belonging to one Organization and Customer. Customer relationship stages remain unchanged. Opportunity stages carry explicit Open/Won/Lost semantics; unstaged is separate. A stage's classification is protected after historical use, while its name and order remain configurable. No stages are seeded.

Owner references Membership. Optional value uses integer minor units and currency; expected close is a calendar date. The Opportunity foundation follows Customers' Membership access without introducing a commercial module; create/update capabilities remain separate from Customer permissions.

## Consequences

Customer and Opportunity boards are distinct projections. CRM Home summarizes Opportunities through one tenant-safe SQL aggregate, with values separated by currency. Existing events carry snapshots and appear in Customer history. Opportunity deletion, proposal linkage, forecast and conversion semantics require later decisions.

## Rejected alternatives

- Renaming Customer stages or converting Customer rows into Opportunities loses simultaneous business intent and relationship state.
- Importing the prototype's local state creates a second source of truth.
- Deriving Won/Lost from tenant-authored stage names changes semantics when vocabulary is renamed.

## Enforcement / current owners

- `docs/domain-model.md`, `docs/data.md`, `docs/security.md`, `docs/ui-system.md`
- `supabase/migrations/20261130000001_opportunities_have_their_own_lifecycle.sql`
- `apps/web/lib/domain/opportunities/`
- `apps/web/tests/integration/database/opportunities.test.ts`
