# ADR-017 — Files are artifacts and import sources, not Connections

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

CSV, PDF and similar formats were being presented alongside connected applications even though they have no persistent external-system relationship.

## Decision

A file is an artifact/input. File intake and Import Runs process it. File formats are not Connector catalogue entries.

## Consequences

- Imports remain auditable without inventing fake OAuth/connection state.
- Library/File ownership stays distinct from external-system authorization.

## Rejected alternatives

- CSV/Spreadsheet/PDF connector cards.
- Treating upload format as external app.

## Enforcement / current owners

- `docs/product.md`
- `docs/domain-model.md`
- `docs/integrations.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
