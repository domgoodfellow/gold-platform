# ADR-034 — Organization Secret References are write-only and machine-resolved

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

Organizations sometimes need to supply a private value that is neither a Platform provider credential nor an OAuth Connection.

## Decision

Secret References are Organization-owned metadata plus a private secret reference. Users may create/replace/disable them without plaintext readback; only the narrow machine role that requires a named secret may resolve it.

## Consequences

- Platform staff do not automatically gain secret readback.
- Usage/rotation can be audited without exposing the value.

## Rejected alternatives

- Generic settings table with secret flag.
- Reveal/copy stored secret UI.
- List-all-secrets machine API.

## Enforcement / current owners

- `docs/security.md`
- `docs/integrations.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
