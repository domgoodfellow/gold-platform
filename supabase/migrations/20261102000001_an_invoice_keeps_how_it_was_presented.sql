-- An issued invoice keeps how it was presented (Work Order 2G, expand and readers).
--
-- An invoice's money is already frozen: its lines, currency, number and dates never change after
-- issue. What it looked like was not. The business's name, address, colours, fonts and logo were
-- read live, so a document produced next year would carry next year's identity. This records them
-- once, in the same transaction that issues the invoice, for every source -- Work, direct and
-- proposal -- through one trigger, so no issuing function had to change.
--
-- It also prepares the private place an issued invoice's one canonical PDF is kept, and who may
-- read it. Nothing here writes a PDF: `20261102000002` adds the writer, applied once every running
-- application instance reads what this adds (docs/deployment.md).
--
-- A presentation carries no amount, price, payment or status. Those stay with the invoice.

-- ---------------------------------------------------------------------------
-- The snapshot
-- ---------------------------------------------------------------------------

create table public.invoice_presentations (
  invoice_id      uuid        primary key,
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  constraint invoice_presentations_invoice_fk foreign key (organization_id, invoice_id)
    references public.invoices (organization_id, id) on delete cascade,

  -- The built-in layout it is drawn with. A later layout is a new value, never a rewrite of this one.
  layout          text        not null default 'invoice.standard' check (layout in ('invoice.standard')),
  layout_version  integer     not null default 1 check (layout_version > 0),

  -- The seller, as the business described itself at issue. `seller_name` is the legal name when one
  -- was given, otherwise the business's name; `trading_name` is the business's name when it differs.
  seller_name     text        not null check (length(btrim(seller_name)) between 1 and 200),
  trading_name    text        check (trading_name is null or length(btrim(trading_name)) between 1 and 200),
  address_lines   text[]      not null default '{}' check (cardinality(address_lines) <= 6),
  country_code    text        check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  contact_email   text,
  contact_phone   text,
  website_url     text,

  -- The customer, as known at issue. Only what the business holds: no address is invented.
  bill_to_name    text        not null check (length(btrim(bill_to_name)) between 1 and 200),
  bill_to_email   text,

  -- The brand, as chosen at issue. Null colour means the business had said nothing.
  accent          text        check (accent is null or accent ~ '^#[0-9a-f]{6}$'),
  secondary       text        check (secondary is null or secondary ~ '^#[0-9a-f]{6}$'),
  highlight       text        check (highlight is null or highlight ~ '^#[0-9a-f]{6}$'),
  heading_font    text        not null default 'sans' check (heading_font in ('sans', 'serif', 'mono')),
  body_font       text        not null default 'sans' check (body_font in ('sans', 'serif', 'mono')),
  -- The retained copy in the private `finance-documents` bucket, which nobody can replace or
  -- delete. Null when the business had no logo, or its logo had not been retained yet.
  logo_path       text        check (logo_path is null or length(logo_path) between 1 and 500),

  -- How dates are read: the business's own clock at issue.
  timezone        text        not null,
  locale          text        not null default 'en' check (locale in ('en')),

  captured_at     timestamptz not null default now()
);

comment on table public.invoice_presentations is
  'How one issued invoice was presented: seller identity, bill-to identity, brand and layout, recorded in the transaction that issued it. Never edited. Carries no amount, price, payment or status -- the invoice owns those.';

alter table public.invoice_presentations enable row level security;
alter table public.invoice_presentations force row level security;

create policy invoice_presentations_select on public.invoice_presentations
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- A customer reads the presentation of their own invoices, and nothing else.
create policy invoice_presentations_select_external on public.invoice_presentations
  for select to authenticated
  using (
    organization_id = (select app.current_external_tenant())
    and exists (
      select 1 from public.invoices i
       where i.organization_id = invoice_presentations.organization_id
         and i.id = invoice_presentations.invoice_id
         and i.customer_id = (select app.current_external_customer())
    )
  );

revoke all on public.invoice_presentations from anon, authenticated;
grant select on public.invoice_presentations to authenticated;

-- Not even the owner edits one. Deleting stays possible only as part of removing the business.
create function app.invoice_presentation_is_final()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  raise exception 'an invoice''s presentation is recorded once and never changed'
    using errcode = 'GD021';
end;
$fn$;

create trigger invoice_presentations_final
  before update on public.invoice_presentations
  for each row execute function app.invoice_presentation_is_final();

-- ---------------------------------------------------------------------------
-- Building one
-- ---------------------------------------------------------------------------

-- One answer to "what would this business's invoice look like now", used by the trigger at issue
-- and by the draft preview. The logo is the retained private copy of the current brand logo, when
-- one has been retained.
create function app.invoice_presentation_now(
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
  v_retained text;
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
    v_retained := p_organization_id::text || '/logos/' || split_part(v_brand.logo_path, '/', 2);
    if exists (select 1 from storage.objects o where o.bucket_id = 'finance-documents' and o.name = v_retained) then
      v_row.logo_path := v_retained;
    end if;
  end if;

  v_row.timezone    := coalesce(v_org.timezone, 'UTC');
  v_row.locale      := 'en';
  v_row.captured_at := now();
  return v_row;
end;
$fn$;

revoke all on function app.invoice_presentation_now(uuid, uuid, text) from public, anon, authenticated;

-- Every issuing function inserts the invoice; this records its presentation in the same transaction.
-- Definer rights so the row is written whatever the issuer may read, and because no member may
-- insert a presentation directly.
create function app.capture_invoice_presentation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.invoice_presentations;
begin
  v_row := app.invoice_presentation_now(new.organization_id, new.customer_id, new.billed_to);
  v_row.invoice_id := new.id;
  insert into public.invoice_presentations select v_row.*;
  return null;
end;
$fn$;

revoke all on function app.capture_invoice_presentation() from public, anon, authenticated;

create trigger invoices_capture_presentation
  after insert on public.invoices
  for each row execute function app.capture_invoice_presentation();

-- The draft preview: what an invoice issued now would carry. Read-only, and only for someone who
-- may issue this business's invoices.
create function public.preview_invoice_presentation(
  p_organization_id uuid,
  p_customer_id     uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_name text;
begin
  if (select auth.uid()) is null
     or p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'invoice.issue') then
    raise exception 'you may not preview this business''s invoices'
      using errcode = '42501';
  end if;
  if p_customer_id is not null then
    select c.name into v_name from public.contacts c
     where c.organization_id = p_organization_id and c.id = p_customer_id;
  end if;
  return to_jsonb(app.invoice_presentation_now(p_organization_id, p_customer_id, v_name)) - 'invoice_id';
end;
$fn$;

revoke all on function public.preview_invoice_presentation(uuid, uuid) from public, anon;
grant execute on function public.preview_invoice_presentation(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The canonical document, read side
-- ---------------------------------------------------------------------------

create table public.invoice_documents (
  invoice_id      uuid        primary key,
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  constraint invoice_documents_invoice_fk foreign key (organization_id, invoice_id)
    references public.invoices (organization_id, id) on delete cascade,
  storage_path    text        not null unique check (length(storage_path) between 1 and 500),
  sha256          text        not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes      bigint      not null check (size_bytes > 0),
  renderer        text        not null check (length(btrim(renderer)) between 1 and 100),
  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id)
);

comment on table public.invoice_documents is
  'The one canonical PDF of an issued invoice: where it is stored, its checksum and what drew it. Recorded once and never replaced.';

alter table public.invoice_documents enable row level security;
alter table public.invoice_documents force row level security;

create policy invoice_documents_select on public.invoice_documents
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy invoice_documents_select_external on public.invoice_documents
  for select to authenticated
  using (
    organization_id = (select app.current_external_tenant())
    and exists (
      select 1 from public.invoices i
       where i.organization_id = invoice_documents.organization_id
         and i.id = invoice_documents.invoice_id
         and i.customer_id = (select app.current_external_customer())
    )
  );

revoke all on public.invoice_documents from anon, authenticated;
grant select on public.invoice_documents to authenticated;

create trigger invoice_documents_final
  before update on public.invoice_documents
  for each row execute function app.invoice_presentation_is_final();

-- ---------------------------------------------------------------------------
-- The private bucket
-- ---------------------------------------------------------------------------

-- `<organization>/logos/<key>` holds retained logo copies; `<organization>/invoices/<invoice>/<file>`
-- holds canonical PDFs. Private: every read is the caller's own, checked here and again by the
-- route serving it. There is no update or delete policy, so nothing stored here is ever replaced.
insert into storage.buckets (id, name, public, file_size_limit)
values ('finance-documents', 'finance-documents', false, 10485760)
on conflict (id) do nothing;

create policy finance_documents_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'finance-documents'
    and (storage.foldername(name))[1] in (select t::text from app.current_tenant_ids() t)
  );

-- A customer reads their own invoices' PDFs, nothing under `logos`, and nothing else.
create policy finance_documents_objects_select_external on storage.objects
  for select to authenticated
  using (
    bucket_id = 'finance-documents'
    and (storage.foldername(name))[2] = 'invoices'
    and exists (
      select 1 from public.invoices i
       where i.organization_id = (select app.current_external_tenant())
         and i.organization_id::text = (storage.foldername(name))[1]
         and i.id::text = (storage.foldername(name))[3]
         and i.customer_id = (select app.current_external_customer())
    )
  );

-- Retaining the current logo: by someone who may change the brand or issue invoices, under this
-- business's own prefix. A retained copy can never be overwritten (no update policy), so the first
-- copy of a logo is the one every invoice issued with it keeps.
create policy finance_documents_logo_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'finance-documents'
    and (storage.foldername(name))[2] = 'logos'
    and (storage.foldername(name))[1] in (select t::text from app.current_tenant_ids() t)
    and (
      app.has_capability(((storage.foldername(name))[1])::uuid, 'organization.manage')
      or app.has_capability(((storage.foldername(name))[1])::uuid, 'invoice.issue')
    )
  );
