-- An issued invoice has one canonical document (Work Order 2G, writer).
--
-- Applied after `20261102000001` and after every running application instance reads it
-- (docs/deployment.md). Until then no PDF can be stored or recorded, and issuing is unaffected.
--
-- The application draws the PDF from the invoice and its recorded presentation, stores it in the
-- invoice's own folder under a name of its own, and records it here. Rendering and storage happen outside
-- the database, so they may fail after the invoice is issued: the invoice stays issued, nothing is
-- recorded, and the same request may be made again. Concurrent attempts store under different names
-- (storage can let a refused upload overwrite a shared name), and this function records exactly one,
-- once; only the recorded object is ever served.

-- Storing the PDF: someone who may issue this business's invoices, only in an issued invoice's own
-- folder, and only while no document is recorded for it. No update or delete policy exists.
create policy finance_documents_invoice_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'finance-documents'
    and (storage.foldername(name))[2] = 'invoices'
    and exists (
      select 1 from public.invoices i
       where i.organization_id in (select app.current_tenant_ids())
         and i.organization_id::text = (storage.foldername(name))[1]
         and i.id::text = (storage.foldername(name))[3]
         and app.has_capability(i.organization_id, 'invoice.issue')
         and not exists (select 1 from public.invoice_documents d where d.invoice_id = i.id)
    )
  );

create function public.record_invoice_document(
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
  v_actor    uuid := (select auth.uid());
  v_invoice  public.invoices;
  v_document public.invoice_documents;
begin
  if v_actor is null then
    raise exception 'record_invoice_document requires an authenticated caller'
      using errcode = '42501';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id;
  if v_invoice.id is null
     or v_invoice.organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(v_invoice.organization_id, 'invoice.issue') then
    raise exception 'no such invoice, or you may not record its document'
      using errcode = '42501';
  end if;

  -- Already recorded: that is the document, whatever this call carries.
  select * into v_document from public.invoice_documents where invoice_id = p_invoice_id;
  if v_document.invoice_id is not null then
    return v_document;
  end if;

  if p_storage_path is null
     or split_part(p_storage_path, '/', 1) <> v_invoice.organization_id::text
     or split_part(p_storage_path, '/', 2) <> 'invoices'
     or split_part(p_storage_path, '/', 3) <> v_invoice.id::text
     or p_storage_path !~ '^[0-9a-f-]+/invoices/[0-9a-f-]+/[a-z0-9.-]+\.pdf$' then
    raise exception 'that is not this invoice''s document path'
      using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'finance-documents' and o.name = p_storage_path) then
    raise exception 'nothing is stored at that path'
      using errcode = '22023';
  end if;

  insert into public.invoice_documents
    (invoice_id, organization_id, storage_path, sha256, size_bytes, renderer, created_by)
  values
    (v_invoice.id, v_invoice.organization_id, p_storage_path, p_sha256, p_size_bytes, p_renderer, v_actor)
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
    (v_invoice.organization_id, v_actor, 'invoice', v_invoice.id, 'invoice.document_created',
     jsonb_build_object('invoice_id', v_invoice.id, 'number', v_invoice.number,
                        'renderer', p_renderer, 'sha256', p_sha256));

  return v_document;
end;
$fn$;

comment on function public.record_invoice_document(uuid, text, text, bigint, text) is
  'Record the canonical PDF stored for an issued invoice, once. A later call returns the recorded document unchanged. Writes no financial fact.';

revoke all on function public.record_invoice_document(uuid, text, text, bigint, text) from public, anon;
grant execute on function public.record_invoice_document(uuid, text, text, bigint, text) to authenticated;
