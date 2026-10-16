-- A file belongs to the organization; a record only references it. (ADR-009)
--
-- Until now `documents` carried exactly one owner column (customer, location, asset, work
-- item) and the file's identity was that link. Library needs a file that exists before anything
-- points at it, and one file that several records can point at, so the identity moves to the
-- file and the relationships move to `document_links`.
--
-- What does not change: the bytes, the bucket, the tenant path prefix, the signed-URL read, the
-- `document.create` capability, the Agent-private scope (`agent_user_id` stays on the file, because
-- a private file is a visibility rule about the file, not a reference to a record), and the
-- `create_document` signature the web app already calls.

-- ---------------------------------------------------------------------------
-- The links: which records a file is referenced by
-- ---------------------------------------------------------------------------

-- A composite reference needs a unique key on the target, as every other tenant table has.
alter table public.documents
  add constraint documents_org_id_unique unique (organization_id, id);

create table public.document_links (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  document_id     uuid        not null,
  customer_id     uuid,
  location_id     uuid,
  asset_id        uuid,
  work_item_id    uuid,
  created_by      uuid        not null references auth.users (id),
  created_at      timestamptz not null default now(),

  -- One target per link row. A file referenced by two records has two rows, which is the point:
  -- the file is one row and the references are many.
  constraint document_links_one_target check (
    (customer_id is not null)::int
    + (location_id is not null)::int
    + (asset_id is not null)::int
    + (work_item_id is not null)::int
    = 1
  ),

  constraint document_links_document_same_org
    foreign key (organization_id, document_id)
    references public.documents (organization_id, id) on delete cascade,
  constraint document_links_customer_same_org
    foreign key (organization_id, customer_id)
    references public.customers (organization_id, id) on delete cascade,
  constraint document_links_location_same_org
    foreign key (organization_id, location_id)
    references public.locations (organization_id, id) on delete cascade,
  constraint document_links_asset_same_org
    foreign key (organization_id, asset_id)
    references public.assets (organization_id, id) on delete cascade,
  constraint document_links_work_item_same_org
    foreign key (organization_id, work_item_id)
    references public.work_items (organization_id, id) on delete cascade
);

comment on table public.document_links is
  'A reference from a Library file to one record. The file is documents; this row says a record uses it. Linking never transfers ownership of the bytes.';

-- Each of these leads with the record, so "the files for this customer" is one index scan and a
-- file can be linked to the same record only once.
create unique index document_links_org_customer_document_unique
  on public.document_links (organization_id, customer_id, document_id);
create unique index document_links_org_location_document_unique
  on public.document_links (organization_id, location_id, document_id);
create unique index document_links_org_asset_document_unique
  on public.document_links (organization_id, asset_id, document_id);
create unique index document_links_org_work_item_document_unique
  on public.document_links (organization_id, work_item_id, document_id);
create index document_links_org_document_idx
  on public.document_links (organization_id, document_id);

alter table public.document_links enable row level security;
alter table public.document_links force row level security;

-- Staff read every link in their business, as they read every document.
create policy document_links_select on public.document_links
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- A customer on the portal reads only links to themselves.
create policy document_links_select_external on public.document_links
  for select to authenticated
  using (
    organization_id = (select app.current_external_tenant())
    and customer_id = (select app.current_external_customer())
  );

-- Whether a file is organization-wide, read without going through documents' own policies. Those
-- policies read document_links, so reading documents from this policy would recurse.
create function app.is_organization_file(p_organization_id uuid, p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.documents d
     where d.organization_id = p_organization_id
       and d.id = p_document_id
       and d.agent_user_id is null
  );
$fn$;

revoke all on function app.is_organization_file(uuid, uuid) from public;
grant execute on function app.is_organization_file(uuid, uuid) to authenticated;

-- Linking is the same authority as creating the file, and it is refused for an Agent-private file.
-- A link to a private file would publish it to every record list in the business.
create policy document_links_insert on public.document_links
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'document.create')
    and app.is_organization_file(organization_id, document_id)
  );

grant select, insert on public.document_links to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: every existing single-owner document becomes one link
-- ---------------------------------------------------------------------------

insert into public.document_links
  (organization_id, document_id, customer_id, location_id, asset_id, work_item_id, created_by, created_at)
select organization_id, id, customer_id, location_id, asset_id, work_item_id, created_by, created_at
  from public.documents
 where customer_id is not null
    or location_id is not null
    or asset_id is not null
    or work_item_id is not null;

-- ---------------------------------------------------------------------------
-- The portal reads through links now, not through a column on the file
-- ---------------------------------------------------------------------------

-- Replaced before the columns go: a policy that names a column blocks dropping it.
drop policy documents_select_external on public.documents;
create policy documents_select_external on public.documents
  for select to authenticated
  using (
    organization_id = (select app.current_external_tenant())
    and exists (
      select 1 from public.document_links l
       where l.organization_id = documents.organization_id
         and l.document_id = documents.id
         and l.customer_id = (select app.current_external_customer())
    )
  );

-- ---------------------------------------------------------------------------
-- The file no longer names an owner
-- ---------------------------------------------------------------------------

alter table public.documents drop constraint documents_exactly_one_owner;
alter table public.documents
  drop column customer_id,
  drop column location_id,
  drop column asset_id,
  drop column work_item_id;

comment on table public.documents is
  'A Library file: metadata for bytes in the documents bucket under organization_id/. Organization-wide unless agent_user_id is set, in which case only that person can read it. Records reference it through document_links.';

-- ---------------------------------------------------------------------------
-- Creation: the file, then at most one link, in one transaction
-- ---------------------------------------------------------------------------

-- The signature is unchanged so the upload action and every existing caller keep working. A file
-- can now be stored with no link at all; the upload form still passes one target, because that is
-- the only surface built so far.
create or replace function public.create_document(
  p_organization_id uuid,
  p_customer_id     uuid,
  p_location_id     uuid,
  p_asset_id        uuid,
  p_work_item_id    uuid,
  p_storage_path    text,
  p_file_name       text,
  p_mime_type       text,
  p_size_bytes      bigint
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

  -- Unchanged from 20261107000002: the storage allowance is checked before anything is written.
  select * into d from public.allowance_decision(p_organization_id, 'storage_bytes', p_size_bytes) limit 1;
  if d.result = 'hard_limit_reached' then
    raise exception 'this business has reached its storage limit: %', coalesce(d.detail, 'the included storage is used up')
      using errcode = '23514';
  end if;

  insert into public.documents
    (organization_id, storage_path, file_name, mime_type, size_bytes, created_by)
  values
    (p_organization_id, p_storage_path, p_file_name, p_mime_type, p_size_bytes, v_actor)
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

comment on function public.create_document(uuid, uuid, uuid, uuid, uuid, text, text, text, bigint) is
  'Records a stored Library file once its bytes are in the bucket, and links it to at most one record. Security invoker: the documents insert policy and the link insert policy are the authorization. Refuses with 23514 when the organization is at a configured storage hard limit.';
