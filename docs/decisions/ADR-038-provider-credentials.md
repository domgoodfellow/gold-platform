# ADR-038 — Platform provider credentials are private control-plane state

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

GildOps-operated providers require credentials powerful enough to affect many Organizations.

## Decision

Provider Account credentials are Platform-private, stored by reference/write-only where possible, and resolved only by the narrow runtime operation that needs them. Tenant-facing resources expose readiness/identity, not the parent credential.

## Consequences

- Credential rotation does not require exposing plaintext.
- Tenant users can operate their resources without owning parent provider secrets.

## Rejected alternatives

- Provider API keys stored in tenant settings.
- Plaintext provider credential readback.

## Enforcement / current owners

- `docs/integrations.md`
- `docs/security.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
