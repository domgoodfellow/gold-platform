# ADR-054 — Imports translate sources into Businesses and People inside the existing pipeline

**Date:** 2026-11-16
**Status:** Accepted (owner work order: integrate the GuildOps Import Workbench into GildOps)
**Supersedes:** None
**Superseded by:** None

## Context

The standalone GuildOps Import Workbench (Python, v0.4.1) reads unfamiliar exports as candidate Businesses, People, links, addresses and telephones, but writes nothing to GildOps. The Library contact import mapped one source row to one contact, so a row naming a company and its owner became one contact and three rows about one company became three.

## Decision

1. The Workbench's discovery, interpretation and translation are ported to TypeScript in `lib/domain/integrations/translation/`. No Python runtime or separate service is added.
2. A translated import is an ordinary import run. Its plan is the mapping's one `translation` field; each Business group and each Person is its own staging row with a stable key. Matching, review, decisions and apply stay in `stage_import_rows`, `decide_import_row` and `apply_import_run`.
3. Each entity is judged on its own. Uncertain readings are held for a person (`quality`), links are recorded as proposed, and nothing is invented or merged on a name alone.
4. Inspection is a read-only contract an agent may call; writing still requires a person's review and `integration.manage`.

## Consequences

- Migration `20261116142343` adds the `quality` hold, links people to businesses applied in the same run, and raises `import_pipeline_version` to 3.
- The Workbench's README, changelog and export format are kept as reference in `docs/reference/import-workbench/`; its version history is not GildOps'.

## Rejected alternatives

- **Run the Workbench as a Python service.** A second runtime for deterministic string work, with its own session state outside RLS.
- **Import the relational `semantic_*.csv` package.** Several uploads per import for data `contacts_flat.csv` already carries.
- **A new staging table for entities.** The existing staging row already carries normalized values, matching and decisions.
