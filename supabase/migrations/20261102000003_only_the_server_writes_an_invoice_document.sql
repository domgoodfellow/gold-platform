-- Only the server writes an invoice document (Work Order 2G.1, expand).
--
-- `20261102000002` let anyone who may issue invoices put bytes in an invoice's folder and in the
-- business's retained logos, and record any object found there as the invoice's PDF. A member could
-- therefore make a file of their own the business's official invoice, or its logo. This adds the
-- one writer that may do either: `invoice_document_writer`, a machine role the web server signs a
-- 60-second token for after the person's own session has shown they may issue invoices. It draws
-- the PDF itself, stores it under a name it chooses, and records it with a checksum it computed.
--
-- Additive: the member paths `20261102000002` added stay until `20261102000004`, applied once no
-- running application instance still uses them (docs/deployment.md). The member logo path goes now,
-- because no instance depends on it: a logo that cannot be retained falls back to the business name.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'invoice_document_writer') then
    create role invoice_document_writer nologin noinherit;
  end if;
end
$$;

-- PostgREST switches to the token's role as `authenticator`, and Storage as
-- `supabase_storage_admin`, which is a member of `authenticator`.
grant invoice_document_writer to authenticator;
grant usage on schema public, storage, app to invoice_document_writer;
grant select on storage.buckets to invoice_document_writer;
grant select, insert, delete on storage.objects to invoice_document_writer;

comment on role invoice_document_writer is
  'The web server drawing an issued invoice''s PDF or retaining a logo, after the person''s own session showed they may issue invoices. Stores and records invoice documents; nothing else.';

-- Its tokens carry this subject, so Storage records it as the owner of everything it stores.
create function app.invoice_document_writer_id()
returns text
language sql
immutable
set search_path = ''
as $fn$ select '00000000-0000-4000-8000-0000000000c1'::text $fn$;

revoke all on function app.invoice_document_writer_id() from public, anon, authenticated;
grant execute on function app.invoice_document_writer_id() to invoice_document_writer;

-- ---------------------------------------------------------------------------
-- Retained logos, recorded
-- ---------------------------------------------------------------------------

-- Which retained copy belongs to which brand logo, and what its bytes were. An invoice only ever
-- draws a retained copy recorded here, so an object nobody recorded -- including one a member
-- stored under the old policy -- is never drawn.
create table public.invoice_retained_logos (
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  -- The `brand` object key the copy was taken from; brand keys are new for every upload.
  brand_logo_path text        not null check (length(brand_logo_path) between 1 and 500),
  storage_path    text        not null check (length(storage_path) between 1 and 500),
  sha256          text        not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes      bigint      not null check (size_bytes between 1 and 2097152),
  format          text        not null check (format in ('png', 'jpg')),
  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),
  primary key (organization_id, brand_logo_path),
  unique (organization_id, storage_path)
);

-- A stored path is unique within its business, which is how every tenant-owned key here is led.
-- The path begins with the business's id, so this is the same rule `20261102000002` meant.
alter table public.invoice_documents drop constraint invoice_documents_storage_path_key;
alter table public.invoice_documents add constraint invoice_documents_storage_path_key unique (organization_id, storage_path);

comment on table public.invoice_retained_logos is
  'The private, unreplaceable copy of a brand logo that invoices issued with it draw, with its checksum. Written only by record_retained_logo; never changed.';

-- Read only through the writer's functions below; no role reads or writes it directly.
alter table public.invoice_retained_logos enable row level security;
alter table public.invoice_retained_logos force row level security;

revoke all on public.invoice_retained_logos from anon, authenticated;

create trigger invoice_retained_logos_final
  before update on public.invoice_retained_logos
  for each row execute function app.invoice_presentation_is_final();

-- ---------------------------------------------------------------------------
-- Who may ask
-- ---------------------------------------------------------------------------

-- The same question as `app.has_capability`, about a named person rather than the session. Only
-- the writer's functions ask it, about the person the server already authenticated.
create function app.member_has_capability(p_user_id uuid, p_organization_id uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
      from public.memberships m
      join public.roles r on r.id = m.role_id
     where m.user_id = p_user_id
       and m.organization_id = p_organization_id
       and p_capability = any (r.capabilities)
  );
$fn$;

revoke all on function app.member_has_capability(uuid, uuid, text) from public, anon, authenticated;

-- Asked under the person's own session before the server uses the writer: who they are, if they
-- may issue this business's invoices. Writes nothing.
create function public.invoice_document_requester(p_organization_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null
     or p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'invoice.issue') then
    raise exception 'you may not create this business''s invoice documents'
      using errcode = '42501';
  end if;
  return v_actor;
end;
$fn$;

revoke all on function public.invoice_document_requester(uuid) from public, anon;
grant execute on function public.invoice_document_requester(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage, for the writer
-- ---------------------------------------------------------------------------

-- Whether an object in `finance-documents` is something an invoice relies on. Definer rights,
-- because the writer reads none of these tables itself.
create function app.finance_document_is_referenced(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (select 1 from public.invoice_documents d
                  where d.organization_id::text = split_part(p_name, '/', 1) and d.storage_path = p_name)
      or exists (select 1 from public.invoice_retained_logos l
                  where l.organization_id::text = split_part(p_name, '/', 1) and l.storage_path = p_name)
      or exists (select 1 from public.invoice_presentations p
                  where p.organization_id::text = split_part(p_name, '/', 1) and p.logo_path = p_name);
$fn$;

revoke all on function app.finance_document_is_referenced(text) from public, anon, authenticated;
grant execute on function app.finance_document_is_referenced(text) to invoice_document_writer;

-- Whether a writer may store a new object at this name: an issued invoice with no document yet,
-- under a name the writer makes; or a retained logo under a name the writer makes.
create function app.finance_document_slot_open(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
    when p_name ~ '^[0-9a-f-]{36}/invoices/[0-9a-f-]{36}/invoice-[a-z0-9-]+-[0-9a-f-]{36}\.pdf$' then exists (
      select 1 from public.invoices i
       where i.organization_id::text = split_part(p_name, '/', 1)
         and i.id::text = split_part(p_name, '/', 3)
         and not exists (select 1 from public.invoice_documents d where d.invoice_id = i.id))
    when p_name ~ '^[0-9a-f-]{36}/logos/retained-[0-9a-f-]{36}\.(png|jpg)$' then exists (
      select 1 from public.organizations o where o.id::text = split_part(p_name, '/', 1))
    else false
  end;
$fn$;

revoke all on function app.finance_document_slot_open(text) from public, anon, authenticated;
grant execute on function app.finance_document_slot_open(text) to invoice_document_writer;

create policy finance_documents_writer_insert on storage.objects
  for insert to invoice_document_writer
  with check (bucket_id = 'finance-documents' and app.finance_document_slot_open(name));

-- To check what it stored, read a retained copy, and read the brand logo it copies.
create policy finance_documents_writer_select on storage.objects
  for select to invoice_document_writer
  using (bucket_id in ('finance-documents', 'brand'));

-- Removing what it stored and nothing recorded: the losing copy of a concurrent attempt, or one
-- whose record failed. Anything an invoice relies on is refused.
create policy finance_documents_writer_delete on storage.objects
  for delete to invoice_document_writer
  using (
    bucket_id = 'finance-documents'
    and owner_id = app.invoice_document_writer_id()
    and not app.finance_document_is_referenced(name)
  );

-- No member stores a retained logo any more; only `record_retained_logo` makes one count.
drop policy finance_documents_logo_insert on storage.objects;

-- ---------------------------------------------------------------------------
-- Recording, for the writer
-- ---------------------------------------------------------------------------

-- Whether the writer itself stored this exact object, at this size and type.
create function app.writer_stored(p_name text, p_size_bytes bigint, p_mimetype text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from storage.objects o
     where o.bucket_id = 'finance-documents'
       and o.name = p_name
       and o.owner_id = app.invoice_document_writer_id()
       and (o.metadata ->> 'size')::bigint = p_size_bytes
       and o.metadata ->> 'mimetype' = p_mimetype
  );
$fn$;

revoke all on function app.writer_stored(text, bigint, text) from public, anon, authenticated;

create function public.record_retained_logo(
  p_actor           uuid,
  p_organization_id uuid,
  p_brand_logo_path text,
  p_storage_path    text,
  p_sha256          text,
  p_size_bytes      bigint,
  p_format          text
)
returns public.invoice_retained_logos
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_row public.invoice_retained_logos;
begin
  if p_actor is null
     or not (app.member_has_capability(p_actor, p_organization_id, 'invoice.issue')
             or app.member_has_capability(p_actor, p_organization_id, 'organization.manage')) then
    raise exception 'that person may not retain this business''s logo'
      using errcode = '42501';
  end if;

  -- The source is the business's brand logo now, not one the caller names.
  if not exists (select 1 from public.brand_settings b
                  where b.organization_id = p_organization_id and b.logo_path = p_brand_logo_path)
     or split_part(p_brand_logo_path, '/', 1) <> p_organization_id::text then
    raise exception 'that is not this business''s logo'
      using errcode = '22023';
  end if;

  select * into v_row from public.invoice_retained_logos
   where organization_id = p_organization_id and brand_logo_path = p_brand_logo_path;
  if v_row.storage_path is not null then
    return v_row;
  end if;

  if p_format not in ('png', 'jpg')
     or p_storage_path !~ ('^' || p_organization_id::text || '/logos/retained-[0-9a-f-]{36}\.' || p_format || '$')
     or not app.writer_stored(p_storage_path, p_size_bytes, case p_format when 'png' then 'image/png' else 'image/jpeg' end) then
    raise exception 'that is not a retained copy the server stored'
      using errcode = '22023';
  end if;

  insert into public.invoice_retained_logos
    (organization_id, brand_logo_path, storage_path, sha256, size_bytes, format, created_by)
  values
    (p_organization_id, p_brand_logo_path, p_storage_path, p_sha256, p_size_bytes, p_format, p_actor)
  on conflict (organization_id, brand_logo_path) do nothing
  returning * into v_row;

  if v_row.storage_path is null then
    select * into v_row from public.invoice_retained_logos
     where organization_id = p_organization_id and brand_logo_path = p_brand_logo_path;
  end if;
  return v_row;
end;
$fn$;

comment on function public.record_retained_logo(uuid, uuid, text, text, text, bigint, text) is
  'Record the writer''s retained copy of a business''s current brand logo, once per brand logo. A later call returns the recorded copy.';

revoke all on function public.record_retained_logo(uuid, uuid, text, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.record_retained_logo(uuid, uuid, text, text, text, bigint, text) to invoice_document_writer;

create function public.record_invoice_document(
  p_actor        uuid,
  p_invoice_id   uuid,
  p_storage_path text,
  p_sha256       text,
  p_size_bytes   bigint,
  p_renderer     text
)
returns public.invoice_documents
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_invoice  public.invoices;
  v_document public.invoice_documents;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id;
  if v_invoice.id is null
     or p_actor is null
     or not app.member_has_capability(p_actor, v_invoice.organization_id, 'invoice.issue') then
    raise exception 'no such invoice, or that person may not record its document'
      using errcode = '42501';
  end if;

  -- Already recorded: that is the document, whatever this call carries.
  select * into v_document from public.invoice_documents where invoice_id = p_invoice_id;
  if v_document.invoice_id is not null then
    return v_document;
  end if;

  if p_renderer is null
     or p_renderer !~ '^invoice-[a-z0-9-]+$'
     or p_storage_path is null
     or p_storage_path !~ ('^' || v_invoice.organization_id::text || '/invoices/' || v_invoice.id::text
                           || '/' || p_renderer || '-[0-9a-f-]{36}\.pdf$')
     or not app.writer_stored(p_storage_path, p_size_bytes, 'application/pdf') then
    raise exception 'that is not a document the server stored for this invoice'
      using errcode = '22023';
  end if;

  insert into public.invoice_documents
    (invoice_id, organization_id, storage_path, sha256, size_bytes, renderer, created_by)
  values
    (v_invoice.id, v_invoice.organization_id, p_storage_path, p_sha256, p_size_bytes, p_renderer, p_actor)
  on conflict (invoice_id) do nothing
  returning * into v_document;

  if v_document.invoice_id is null then
    -- A concurrent call recorded it first.
    select * into v_document from public.invoice_documents where invoice_id = p_invoice_id;
    return v_document;
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_invoice.organization_id, p_actor, 'invoice', v_invoice.id, 'invoice.document_created',
     jsonb_build_object('invoice_id', v_invoice.id, 'number', v_invoice.number,
                        'renderer', p_renderer, 'sha256', p_sha256));

  return v_document;
end;
$fn$;

comment on function public.record_invoice_document(uuid, uuid, text, text, bigint, text) is
  'Record the PDF the server drew and stored for an issued invoice, once, for a person who may issue its invoices. A later call returns the recorded document unchanged. Writes no financial fact.';

revoke all on function public.record_invoice_document(uuid, uuid, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.record_invoice_document(uuid, uuid, text, text, bigint, text) to invoice_document_writer;

-- ---------------------------------------------------------------------------
-- Reading, for the writer
-- ---------------------------------------------------------------------------

-- Everything the writer draws an issued invoice from, for a person who may issue it: the invoice
-- and its lines as issued, its recorded presentation, the business's name and clock for an invoice
-- with none, its recorded document if any, and its retained logo only when that copy was recorded.
-- No payment: the document is the invoice as issued.
create function public.invoice_document_source(p_actor uuid, p_organization_id uuid, p_invoice_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_invoice      public.invoices;
  v_presentation public.invoice_presentations;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id and organization_id = p_organization_id;
  if v_invoice.id is null
     or p_actor is null
     or not app.member_has_capability(p_actor, p_organization_id, 'invoice.issue') then
    raise exception 'no such invoice, or that person may not create its document'
      using errcode = '42501';
  end if;

  select * into v_presentation from public.invoice_presentations where invoice_id = v_invoice.id;

  return jsonb_build_object(
    'invoice', jsonb_build_object(
      'id', v_invoice.id, 'number', v_invoice.number, 'issued_at', v_invoice.issued_at,
      'due_at', v_invoice.due_at, 'currency', v_invoice.currency, 'billed_to', v_invoice.billed_to),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'description', l.description, 'unit', l.unit, 'unit_amount_minor', l.unit_amount_minor,
               'currency', l.currency, 'quantity', l.quantity) order by l.position)
        from public.invoice_lines l
       where l.organization_id = v_invoice.organization_id and l.invoice_id = v_invoice.id), '[]'::jsonb),
    'presentation', case when v_presentation.invoice_id is null then null else to_jsonb(v_presentation) end,
    'organization', (select jsonb_build_object('name', o.name, 'timezone', o.timezone)
                       from public.organizations o where o.id = v_invoice.organization_id),
    'document', (select to_jsonb(d) from public.invoice_documents d where d.invoice_id = v_invoice.id),
    'logo', (select jsonb_build_object('storage_path', l.storage_path, 'sha256', l.sha256, 'format', l.format)
               from public.invoice_retained_logos l
              where l.organization_id = v_invoice.organization_id
                and l.storage_path = v_presentation.logo_path)
  );
end;
$fn$;

revoke all on function public.invoice_document_source(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.invoice_document_source(uuid, uuid, uuid) to invoice_document_writer;

-- The business's current brand logo, for a person who may retain it, and its recorded copy if any.
create function public.invoice_logo_source(p_actor uuid, p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_path text;
begin
  if p_actor is null
     or not (app.member_has_capability(p_actor, p_organization_id, 'invoice.issue')
             or app.member_has_capability(p_actor, p_organization_id, 'organization.manage')) then
    raise exception 'that person may not retain this business''s logo'
      using errcode = '42501';
  end if;
  select b.logo_path into v_path from public.brand_settings b where b.organization_id = p_organization_id;
  return jsonb_build_object(
    'brand_logo_path', v_path,
    'retained', (select l.storage_path from public.invoice_retained_logos l
                  where l.organization_id = p_organization_id and l.brand_logo_path = v_path)
  );
end;
$fn$;

revoke all on function public.invoice_logo_source(uuid, uuid) from public, anon, authenticated;
grant execute on function public.invoice_logo_source(uuid, uuid) to invoice_document_writer;

-- ---------------------------------------------------------------------------
-- An invoice issued now draws only a recorded retained logo
-- ---------------------------------------------------------------------------

-- As in `20261102000001`, except the logo: the recorded copy of the brand logo current in the
-- issuing transaction, or none. A logo changed after its copy was retained has a different key and
-- no recorded copy, so the invoice falls back to the business's name rather than drawing another
-- version.
create or replace function app.invoice_presentation_now(
  p_organization_id uuid,
  p_customer_id     uuid,
  p_billed_to       text
)
returns public.invoice_presentations
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_row      public.invoice_presentations;
  v_org      public.organizations;
  v_identity public.organization_identity;
  v_brand    public.brand_settings;
  v_place    text;
begin
  select * into v_org from public.organizations where id = p_organization_id;
  select * into v_identity from public.organization_identity where organization_id = p_organization_id;
  select * into v_brand from public.brand_settings where organization_id = p_organization_id;

  v_row.organization_id := p_organization_id;
  v_row.layout          := 'invoice.standard';
  v_row.layout_version  := 1;
  v_row.seller_name     := left(coalesce(nullif(btrim(v_identity.legal_name), ''), v_org.name), 200);
  v_row.trading_name    := case
    when v_identity.legal_name is not null and btrim(v_identity.legal_name) <> btrim(v_org.name)
      then left(v_org.name, 200)
  end;
  v_place := concat_ws(' ', nullif(btrim(v_identity.city), ''), nullif(btrim(v_identity.region), ''), nullif(btrim(v_identity.postal_code), ''));
  v_row.address_lines := array_remove(array[
    nullif(btrim(v_identity.address_line1), ''),
    nullif(btrim(v_identity.address_line2), ''),
    nullif(v_place, '')
  ], null);
  v_row.country_code  := v_identity.country_code;
  v_row.contact_email := v_identity.contact_email;
  v_row.contact_phone := v_identity.contact_phone;
  v_row.website_url   := v_identity.website_url;

  v_row.bill_to_name := left(coalesce(nullif(btrim(p_billed_to), ''), 'Customer'), 200);
  if p_customer_id is not null then
    select nullif(btrim(c.email), '') into v_row.bill_to_email
      from public.contacts c
     where c.organization_id = p_organization_id and c.id = p_customer_id;
  end if;

  v_row.accent       := v_brand.accent;
  v_row.secondary    := v_brand.secondary;
  v_row.highlight    := v_brand.highlight;
  v_row.heading_font := coalesce(v_brand.heading_font, 'sans');
  v_row.body_font    := coalesce(v_brand.body_font, 'sans');

  if v_brand.logo_path is not null then
    select l.storage_path into v_row.logo_path
      from public.invoice_retained_logos l
     where l.organization_id = p_organization_id and l.brand_logo_path = v_brand.logo_path;
  end if;

  v_row.timezone    := coalesce(v_org.timezone, 'UTC');
  v_row.locale      := 'en';
  v_row.captured_at := now();
  return v_row;
end;
$fn$;

revoke all on function app.invoice_presentation_now(uuid, uuid, text) from public, anon, authenticated;
