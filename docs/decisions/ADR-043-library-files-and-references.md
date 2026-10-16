# ADR-043 — A Library file is organization-owned; records reference it

**Recorded:** 2026-10-16
**Status:** Accepted
**Origin:** Conversation 13 (Library) slice 13.1. Exact implementation history remains in Git and in `supabase/migrations/20261223000001_library_files_are_organization_owned.sql`.

## Context

Until this decision the stored file was identified by the record it was attached to. `documents` had exactly one owner column among customer, location, asset and work item, and Agent-private files added a fifth owner. The file's identity and the record's relationship were the same row.

That shape cannot support Library. A reusable file has to exist before any record points at it, and one file has to be usable by several records (a supplier price list used by a job and a customer quote, for example). Keeping one owner column forces either a copy of the bytes per record or a file that belongs to a customer it has nothing to do with.

The canonical rule already stated in `docs/domain-model.md` ("the related record does not acquire file ownership merely because the file appears in its UI") had no schema behind it.

## Decision

- The file is the `documents` row. It is organization-owned: its bytes, metadata, lifecycle and provenance belong to the organization, and it needs no record to exist.
- A record that uses a file holds a reference, a `document_links` row with exactly one target (customer, location, asset or work item). Linking never transfers ownership, and deleting a link never deletes the file.
- A file may have any number of links, including none. The same file is one row and one set of bytes however many records reference it.
- The Agent-private scope stays on the file (`agent_user_id`). It is a visibility rule about the file, not a reference to a record. A private file cannot be linked, because a link would put it on a business record list.
- The portal reads a file only through a link to its own customer.
- The table keeps the name `documents` for now. Renaming it to a Library file table is a separate, later change; this decision is about what the row means, not what it is called.

## Consequences

- Creating a file no longer requires a record. The current upload form still passes one target, so the visible behaviour is unchanged until the Library surface lands in slice 13.3.
- Listing a record's files reads the links and follows them to the file.
- Ownership questions have one answer: the file belongs to the organization. The links answer "what uses it", which is an operational question and can have several answers.
- Storage accounting is unaffected: bytes are still counted once, on the file.
- The storage object `DELETE` policy is not changed by this decision. Its defect (any member can delete a file's bytes while the row remains) is slice 13.2, because the fix depends on the storage port that slice introduces.

## Rejected alternatives

- **Keep one owner column and copy bytes per record.** Duplicates storage and makes the same contract appear in two places that drift apart.
- **A polymorphic `(entity_type, entity_id)` link.** Cannot be a foreign key, so nothing stops a link naming another tenant's record (the reason I18 exists).
- **Put a `library_file_id` on every record table.** Spreads Library into each domain and still gives the file one owner.
- **Make Agent-private files links to a private scope.** Keeps the file's visibility on the file, where RLS can enforce it, rather than in a second table.

## Enforcement / current owners

- `docs/domain-model.md` — Document / File and Media definitions.
- `docs/product.md` — Library is shared organization infrastructure.
- `docs/data.md` — tenant scoping and composite references.
- `supabase/migrations/20261223000001_library_files_are_organization_owned.sql`
- `apps/web/tests/integration/database/documents.test.ts` — links, one target per link, duplicate links, cross-tenant links.
- `apps/web/tests/integration/database/agent-attachments.test.ts` — a private file has no links.

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
