# ADR-015 — Providers sit behind capability adapters

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Vendor SDK vocabulary had begun to leak into domain decisions and makes replacement/fallback expensive.

## Decision

Domains depend on capabilities. Provider-specific SDKs, request/response translation and selection live behind adapter/registry boundaries.

## Consequences

- Provider changes do not rewrite business semantics.
- Operational provider identity remains visible in Platform Administration where needed.

## Rejected alternatives

- Direct provider SDK calls from domain or React code.
- Provider name as a canonical business entity where only capability matters.

## Enforcement / current owners

- `docs/architecture.md`
- `docs/integrations.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
