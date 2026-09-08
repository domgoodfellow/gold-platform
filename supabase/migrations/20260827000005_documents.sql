-- Document: a file attached to an entity, with metadata in Postgres and bytes in object
-- storage under a tenant-scoped path prefix.
--
-- Four rules in constraints.md govern this table, and each one decided something here:
--
--   * "Never separate tenants by provisioning. Not a bucket per tenant... files live in
--     shared buckets under a tenant-scoped path prefix, with the row in `documents` as the
--     authority on who owns the bytes." Hence ONE bucket, and a path that begins with the
--     organization id.
--   * "Never serve a private file from a durable public URL." Hence a private bucket and
--     nothing else; every read is a short-lived signed URL minted after a permission check.
--   * "Never expose a service-role key to a client." Hence storage policies that work under
--     the caller's own JWT, so the application never needs a privileged client to upload.
--   * I18. Hence four nullable composite references rather than the obvious design.
--
-- THE OBVIOUS DESIGN IS WRONG, and it is worth saying why because it is what most codebases
-- do. A polymorphic `(entity_type text, entity_id uuid)` pair cannot be a foreign key -- it
-- points at a different table depending on its own contents -- so nothing stops a document
-- from naming another tenant's customer. RLS does not help: a policy on `documents` checks
-- the document's own organization_id and is satisfied. I18 is unimplementable polymorphically,
-- so the attachment is four nullable columns with four composite references and a constraint
-- that exactly one is set. It costs a column per attachable entity, which is the price of the
-- guarantee.
--
-- Note also that the schema-conformance assertion for I18 would NOT have caught the
-- polymorphic version: it checks that foreign keys between tenant-owned tables carry
-- organization_id, and a design with no foreign key at all passes it trivially.

-- work_items needs a unique (organization_id, id) before anything can reference it
-- compositely. Every other entity got one in its own migration; work_items did not, because
-- nothing referenced it until now.
alter table public.work_items
  add constraint work_items_org_id_unique unique (organization_id, id);

create table public.documents (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,

  -- Exactly one of these is set. See the constraint below.
  customer_id     uuid,
  location_id     uuid,
  asset_id        uuid,
  work_item_id    uuid,

  -- Where the bytes live, relative to the bucket. Always begins with the organization id;
  -- the storage policies below are what enforce that, not this column's type.
  storage_path    text        not null check (length(storage_path) between 1 and 1024),

  -- What the person called it. Separate from storage_path because the stored key is
  -- sanitised and uniquified, and the original name is what a download should be called.
  file_name       text        not null check (length(btrim(file_name)) between 1 and 255),
  mime_type       text        not null check (length(btrim(mime_type)) between 1 and 255),
  size_bytes      bigint      not null check (size_bytes > 0),

  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),

  -- Attached to exactly one thing. Zero would be a file belonging to nothing, which the
  -- timeline cannot show; more than one would make "the documents for this customer" and
  -- "the documents for this work item" disagree about the same row.
  constraint documents_exactly_one_owner check (
    (customer_id is not null)::int
    + (location_id is not null)::int
    + (asset_id is not null)::int
    + (work_item_id is not null)::int
    = 1
  ),

  constraint documents_customer_same_org
    foreign key (organization_id, customer_id)
    references public.customers (organization_id, id) on delete cascade,

  constraint documents_location_same_org
    foreign key (organization_id, location_id)
    references public.locations (organization_id, id) on delete cascade,

  constraint documents_asset_same_org
    foreign key (organization_id, asset_id)
    references public.assets (organization_id, id) on delete cascade,

  constraint documents_work_item_same_org
    foreign key (organization_id, work_item_id)
    references public.work_items (organization_id, id) on delete cascade
);

comment on table public.documents is
  'Metadata for a file; the bytes live in the documents bucket under organization_id/. This row is the authority on who owns them.';

-- I2: leads with organization_id. Two tenants can hold the same storage path only if the
-- path did not begin with their organization id, which the storage policies forbid -- so this
-- is belt and braces, and cheap.
create unique index documents_org_path_unique
  on public.documents (organization_id, storage_path);

create index documents_org_customer_idx on public.documents (organization_id, customer_id);
create index documents_org_location_idx on public.documents (organization_id, location_id);
create index documents_org_asset_idx on public.documents (organization_id, asset_id);
create index documents_org_work_item_idx on public.documents (organization_id, work_item_id);

alter table public.documents enable row level security;
alter table public.documents force row level security;

create policy documents_select on public.documents
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy documents_insert on public.documents
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'document.create')
  );

grant select, insert on public.documents to authenticated;

-- ---------------------------------------------------------------------------
-- The bucket
-- ---------------------------------------------------------------------------

-- One bucket for every tenant. A bucket per tenant is provisioning-based separation, which
-- constraints.md refuses: it grows operationally with every customer and proves nothing that
-- a path prefix plus a policy does not already prove.
--
-- public = false is the whole security posture. There is no durable URL to leak; every read
-- is signed and short-lived.
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 26214400)
on conflict (id) do nothing;

-- The tenant-scoped path prefix, enforced rather than merely conventional. The first path
-- segment must be an organization the caller belongs to.
--
-- Compared as text rather than cast to uuid: a key whose first segment is not a uuid would
-- raise on `::uuid` inside a policy, which turns a malformed upload into an error instead of
-- a refusal. Text comparison simply does not match.
create policy documents_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (
      select t::text from app.current_tenant_ids() t
    )
  );

create policy documents_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (
      select t::text from app.current_tenant_ids() t
    )
  );

-- Delete exists for one caller: the compensating cleanup in uploadDocument, which removes
-- the object when the metadata insert fails. Bytes are written before the row, because bytes
-- with no row are unreferenced and unreachable, while a row with no bytes is a broken link
-- someone sees. Deleting a document as a feature -- row and bytes together -- has no caller
-- yet and gets its own slice.
create policy documents_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (
      select t::text from app.current_tenant_ids() t
    )
  );

-- ---------------------------------------------------------------------------
-- The new capability
-- ---------------------------------------------------------------------------

alter table public.roles drop constraint roles_capabilities_known;

alter table public.roles
  add constraint roles_capabilities_known
  check (capabilities <@ array[
    'customer.create',
    'role.manage',
    'field.manage',
    'location.create',
    'resource.create',
    'work_item.create',
    'asset.create',
    'document.create'
  ]::text[]);

update public.roles
   set capabilities = capabilities || array['document.create']::text[]
 where 'customer.create' = any (capabilities)
   and not ('document.create' = any (capabilities));

-- ---------------------------------------------------------------------------
-- Creation as one transaction
-- ---------------------------------------------------------------------------

-- No `custom` column and no field definitions entry. A document's metadata is what the
-- storage layer reports about the bytes, not something a business configures, and nothing
-- has asked otherwise.
create function public.create_document(
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
begin
  if v_actor is null then
    raise exception 'create_document requires an authenticated caller'
      using errcode = '42501';
  end if;

  insert into public.documents
    (organization_id, customer_id, location_id, asset_id, work_item_id,
     storage_path, file_name, mime_type, size_bytes, created_by)
  values
    (p_organization_id, p_customer_id, p_location_id, p_asset_id, p_work_item_id,
     p_storage_path, p_file_name, p_mime_type, p_size_bytes, v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'document', v_id, 'document.created',
     jsonb_build_object('file_name', p_file_name, 'size_bytes', p_size_bytes));

  return v_id;
end;
$fn$;

revoke all on function public.create_document(uuid, uuid, uuid, uuid, uuid, text, text, text, bigint) from public;
grant execute on function public.create_document(uuid, uuid, uuid, uuid, uuid, text, text, text, bigint) to authenticated;
