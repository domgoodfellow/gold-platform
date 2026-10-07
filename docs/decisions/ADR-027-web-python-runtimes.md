# ADR-027 — Web and Python are two serverless runtimes with one domain model

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Provider callbacks, scheduled execution and AI/provider work need a Python runtime, while the operator/public application is Next.js. A long-lived daemon is not part of the current deployed architecture.

## Decision

The web runtime and Python Vercel handlers are separate execution boundaries sharing canonical persistence/domain semantics. The Python runtime may expose narrow domain commands but is not a second product/domain model.

## Consequences

- Local API routing derives from deployed route configuration.
- Long-lived work must persist state outside process memory.

## Rejected alternatives

- A separate independent Python business model.
- Assuming a serverless function is a resident worker daemon.

## Enforcement / current owners

- `docs/architecture.md`
- `docs/deployment.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
