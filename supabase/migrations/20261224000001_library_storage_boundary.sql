-- Library's storage boundary: who may remove bytes, what bytes are accepted, and a quota check that
-- cannot be passed twice. (Conversation 13, slice 13.2.)
--
-- The defect this closes: the `documents` bucket let any member of an organization delete any object
-- under that organization's prefix. The metadata row is the authority on whether a file exists, so
-- deleting its bytes left a row whose download was broken. Removing bytes is now allowed only to the
-- person who uploaded them, and only while nothing references the path.

-- ---------------------------------------------------------------------------
-- What references a stored path
-- ---------------------------------------------------------------------------

-- Two tables hold storage paths. A Library file is in `documents`. A file a person imports as a
-- source is in the same bucket under `<organization>/imports/...` and is named by its integration
-- resource, not by a document row. Both count as references.
create index documents_storage_path_idx on public.documents (storage_path);

create function app.storage_path_is_referenced(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (select 1 from public.documents d where d.storage_path = p_path)
      or exists (select 1 from public.integration_resources r where r.storage_path = p_path);
$fn$;

revoke all on function app.storage_path_is_referenced(text) from public;
grant execute on function app.storage_path_is_referenced(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Removal: the uploader, of bytes nothing points at
-- ---------------------------------------------------------------------------

-- Three callers need this and all three are the uploader:
--   * the compensating cleanup when a row cannot be written after its bytes;
--   * an Agent file taken back before it is sent (its row is deleted first, so the path is unreferenced);
--   * a failed import upload.
-- A referenced path is never removable here, whoever asks. Deleting a file as a feature, row and
-- bytes together, is a separate slice with its own retention rules.
drop policy documents_objects_delete on storage.objects;
create policy documents_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (select t::text from app.current_tenant_ids() t)
    and owner_id = (select auth.uid())::text
    and not app.storage_path_is_referenced(name)
  );

-- ---------------------------------------------------------------------------
-- Acceptance: the bucket refuses types a Library file may not be
-- ---------------------------------------------------------------------------

-- Mirrors the formats in `lib/domain/documents/documents.ts`. SVG is not here: it can carry script.
-- Anything not listed, including a generic octet-stream, is refused by the bucket itself, before the
-- application's own content check is reached.
update storage.buckets
   set allowed_mime_types = array[
     'application/pdf',
     'image/png',
     'image/jpeg',
     'image/webp',
     'text/csv',
     'text/plain',
     'text/markdown',
     'application/json',
     'application/xml',
     'application/rtf',
     'application/vnd.ms-excel',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.openxmlformats-officedocument.presentationml.presentation'
   ]
 where id = 'documents';

-- ---------------------------------------------------------------------------
-- Integrity: a checksum of the bytes as they were stored
-- ---------------------------------------------------------------------------

-- Null means not recorded. Files stored before this migration have no checksum, and an unknown
-- checksum is not presented as an empty one.
alter table public.documents
  add column content_sha256 text
  check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$');

-- Inserts are granted by column (20260929000009), so the new column must be granted too. Without
-- this the insert inside create_document is refused with "permission denied for table documents".
grant insert (content_sha256) on public.documents to authenticated;

-- ---------------------------------------------------------------------------
-- Creation: the quota check and the insert are one step, under a lock
-- ---------------------------------------------------------------------------

-- Before this, two uploads could both read the same stored total before either row existed, and
-- both pass. The lock is taken per organization, before the allowance is read, so the second upload
-- sees the first one's row. It is transaction-scoped and released on commit or rollback.
drop function public.create_document(uuid, uuid, uuid, uuid, uuid, text, text, text, bigint);

create function public.create_document(
  p_organization_id uuid,
  p_customer_id     uuid,
  p_location_id     uuid,
  p_asset_id        uuid,
  p_work_item_id    uuid,
  p_storage_path    text,
  p_file_name      text,
  p_mime_type       text,
  p_size_bytes      bigint,
  p_content_sha256  text default null
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_id    uuid;
  d       record;
begin
  if v_actor is null then
    raise exception 'create_document requires an authenticated caller'
      using errcode = '42501';
  end if;

  if (p_customer_id is not null)::int + (p_location_id is not null)::int
     + (p_asset_id is not null)::int + (p_work_item_id is not null)::int > 1 then
    raise exception 'a document is linked to one record when it is uploaded'
      using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('library-storage:' || p_organization_id::text, 0));

  select * into d from public.allowance_decision(p_organization_id, 'storage_bytes', p_size_bytes) limit 1;
  if d.result = 'hard_limit_reached' then
    raise exception 'this business has reached its storage limit: %', coalesce(d.detail, 'the included storage is used up')
      using errcode = '23514';
  end if;

  insert into public.documents
    (organization_id, storage_path, file_name, mime_type, size_bytes, created_by, content_sha256)
  values
    (p_organization_id, p_storage_path, p_file_name, p_mime_type, p_size_bytes, v_actor, p_content_sha256)
  returning id into v_id;

  if p_customer_id is not null or p_location_id is not null
     or p_asset_id is not null or p_work_item_id is not null then
    insert into public.document_links
      (organization_id, document_id, customer_id, location_id, asset_id, work_item_id, created_by)
    values
      (p_organization_id, v_id, p_customer_id, p_location_id, p_asset_id, p_work_item_id, v_actor);
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'document', v_id, 'document.created',
     jsonb_strip_nulls(jsonb_build_object(
       'file_name', p_file_name,
       'size_bytes', p_size_bytes,
       'customer_id', p_customer_id,
       'location_id', p_location_id,
       'asset_id', p_asset_id,
       'work_item_id', p_work_item_id
     )));

  return v_id;
end;
$fn$;

revoke all on function public.create_document(uuid, uuid, uuid, uuid, uuid, text, text, text, bigint, text) from public;
grant execute on function public.create_document(uuid, uuid, uuid, uuid, uuid, text, text, text, bigint, text) to authenticated;

comment on function public.create_document(uuid, uuid, uuid, uuid, uuid, text, text, text, bigint, text) is
  'Records a stored Library file once its bytes are in the bucket, with its checksum, and links it to at most one record. Security invoker: the documents and link insert policies are the authorization. The storage-limit check and the insert run under a per-organization lock, so concurrent uploads cannot both pass the same remaining allowance. Refuses with 23514 at a configured storage hard limit.';
