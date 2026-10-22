# ADR-044 — Stored bytes are removed only by their uploader, and only while nothing names them

**Recorded:** 2026-10-16
**Status:** Accepted
**Origin:** Conversation 13 (Library) slice 13.2. Exact implementation history remains in Git and in `supabase/migrations/20261022000086_library_storage_boundary.sql`.

## Context

The `documents` bucket let any authenticated member of an organization delete any object under that organization's path prefix. The `documents` row is the authority on whether a file exists. Deleting its bytes left a row whose signed download was broken, and nothing in the database noticed. The policy had been written to allow one narrow case, the compensating delete after a failed row insert, and it allowed far more.

Two other paths also remove bytes: an Agent file taken back before it is sent, and a failed import upload. Both are the uploader's own, and both happen while the bytes are unreferenced or about to be.

## Decision

An object in the `documents` bucket may be removed only when all of the following hold:

- the caller's tenant owns the path prefix;
- the caller is the object's owner (the uploader, recorded by storage as `owner_id`);
- no `documents` row and no integration resource names the path.

Deleting a file as a feature, row and bytes together, is not covered. It is a separate slice with its own retention rules.

## Consequences

- A stored file cannot lose its bytes while its row exists, whoever asks.
- A colleague cannot clear an uploader's unreferenced bytes.
- Storage removal stays best effort in application code. Under this rule a refused removal leaves only unreferenced bytes, which is the harmless state.
- A future delete-the-file feature must remove the row first, then the bytes, and it will satisfy this rule without a policy change.

## Rejected alternatives

- **Keep any-member delete and check references in application code.** Application code is not the boundary; a direct storage call skips it.
- **Allow delete only by a service role.** Puts a privileged client into the upload path, which the storage policies were written to avoid.
- **Allow delete of any unreferenced object by any member.** Lets one member clear another's upload in the window between its bytes and its row.

## Enforcement / current owners

- `docs/data.md` — Files and storage.
- `supabase/migrations/20261022000086_library_storage_boundary.sql` — `documents_objects_delete` and `app.storage_path_is_referenced`.
- `apps/web/tests/integration/database/library-storage-boundary.test.ts` — removal by owner, by another member, of a referenced document, of an import file, and from another organization.

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.
