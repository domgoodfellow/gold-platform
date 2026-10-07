# ADR-035 — Connector readiness is derived by the runtime that can know it

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

A catalogue status, implemented adapter and environment/provider registration are independent facts. Web-only hard-coded lists drifted from actual operability.

## Decision

Connector availability is derived from catalogue maturity plus runtime implementation/configuration. The API/provider runtime is authoritative for adapter/configuration readiness; tenant UI offers Connect only when the deployment can honor it.

## Consequences

- Platform staff can see why a connector is unavailable.
- Product maturity is not falsified to work around missing configuration.

## Rejected alternatives

- Readiness boolean stored as catalogue data.
- A second hard-coded web registry.

## Enforcement / current owners

- `docs/integrations.md`
- `docs/architecture.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
