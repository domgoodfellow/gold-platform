# ADR-021 — Historical committed terms are preserved

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Mutable configuration such as prices, rates or templates must not reinterpret past invoices, usage or completed work.

## Decision

Use snapshots, effective dating or append-only corrections wherever historical meaning must survive later configuration changes.

## Consequences

- Current configuration can evolve without falsifying history.
- Corrections are explicit rather than silent rewrites.

## Rejected alternatives

- Always joining historical records to current configuration.
- Overwriting original financial/provider evidence.

## Enforcement / current owners

- `docs/domain-model.md`
- `docs/data.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
