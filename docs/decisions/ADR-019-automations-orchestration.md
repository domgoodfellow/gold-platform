# ADR-019 — Automations owns durable orchestration

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Durable triggers/conditions/actions need one runtime even when an action uses AI or another business domain.

## Decision

Automations owns durable orchestration and run history. Actions invoke canonical domain operations; target domains keep their business rules.

## Consequences

- AI can participate inside a Rule without owning it.
- Domain changes do not need duplicated automation SQL logic.

## Rejected alternatives

- A separate automation engine per workspace.
- Automation reimplementing scheduling, CRM or Communications writes.

## Enforcement / current owners

- `docs/domain-model.md`
- `docs/architecture.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
