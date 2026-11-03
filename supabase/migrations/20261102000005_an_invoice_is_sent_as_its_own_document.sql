-- An invoice is sent as its own document (Work Order 2H).
--
-- A business sends an issued invoice to its customer from its own verified address, carrying the
-- one canonical PDF `invoice_documents` records. Nothing new sends email: the message is queued by
-- `queue_outbound_email` and leaves through the existing tenant-email runtime, so Communications
-- holds it like any other email. What this adds is the part only the database can decide:
--
--   * who may: a member with both `invoice.issue` and `message.send`, Billing usable;
--   * from where: the business's default sender, resolved by `app.organization_email_sender` --
--     the request names no address and there is no platform fallback;
--   * to whom: the email on the invoice customer's own contact record, which the request must
--     repeat exactly, so a forged or stale address is refused rather than obeyed;
--   * with what: the invoice's recorded PDF, attached where it already is in the private
--     `finance-documents` bucket -- never copied, never named by the request -- with its checksum,
--     which the sender checks against the bytes it reads before the provider sees them. Nobody can
--     replace or remove a recorded document, so the attachment cannot change after it is queued.
--
-- `invoice_emails` records each send with the sender, recipient and document as they were, and
-- never changes. Delivery state stays the message's own; nothing here copies it.

-- ---------------------------------------------------------------------------
-- An attachment says where its bytes are, and what they were
-- ---------------------------------------------------------------------------

alter table public.message_attachments
  add column storage_bucket text not null default 'communications'
    check (storage_bucket in ('communications', 'finance-documents')),
  add column sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$');

comment on column public.message_attachments.storage_bucket is
  'Private bucket holding the bytes. `finance-documents` only for an issued invoice''s recorded PDF, attached by queue_invoice_email.';
comment on column public.message_attachments.sha256 is
  'When set, the bytes the sender reads must have this SHA-256 or the email is not sent.';

-- ---------------------------------------------------------------------------
-- What was sent
-- ---------------------------------------------------------------------------

create table public.invoice_emails (
  organization_id   uuid        not null references public.organizations (id) on delete cascade,
  id                uuid        not null default gen_random_uuid(),
  invoice_id        uuid        not null,
  message_id        uuid        not null,
  conversation_id   uuid        not null,
  email_identity_id uuid        not null,
  -- As they were at send; later changes to the sender or the customer never reach these.
  from_address      text        not null,
  recipient         text        not null,
  customer_id       uuid        not null,
  document_path     text        not null,
  document_sha256   text        not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
  -- An intentional later send of the same invoice names the send it follows.
  sent_again_after         uuid,
  sent_by           uuid        not null references auth.users (id),
  created_at        timestamptz not null default now(),
  primary key (organization_id, id),
  unique (organization_id, message_id),
  foreign key (organization_id, invoice_id) references public.invoices (organization_id, id) on delete cascade,
  -- Removed only with the business itself, like the invoice it records.
  foreign key (organization_id, message_id) references public.messages (organization_id, id) on delete cascade,
  foreign key (organization_id, sent_again_after) references public.invoice_emails (organization_id, id)
);

create index invoice_emails_by_invoice on public.invoice_emails (organization_id, invoice_id, created_at);

comment on table public.invoice_emails is
  'Each time an issued invoice was emailed: the message, the sender and recipient as they were, and the recorded PDF it carried. Written only by queue_invoice_email; never changed. Delivery state is the message''s.';

alter table public.invoice_emails enable row level security;
alter table public.invoice_emails force row level security;

create policy invoice_emails_select on public.invoice_emails
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

revoke all on public.invoice_emails from anon, authenticated;
grant select on public.invoice_emails to authenticated;

create trigger invoice_emails_final
  before update on public.invoice_emails
  for each row execute function app.invoice_presentation_is_final();

-- ---------------------------------------------------------------------------
-- Who may, and what would be sent
-- ---------------------------------------------------------------------------

create function app.may_email_invoices(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select (select auth.uid()) is not null
     and p_organization_id in (select app.current_tenant_ids())
     and app.has_capability(p_organization_id, 'invoice.issue')
     and app.has_capability(p_organization_id, 'message.send')
     and exists (select 1 from public.usable_modules(p_organization_id) m where m = 'billing');
$fn$;

revoke all on function app.may_email_invoices(uuid) from public, anon, authenticated;

-- The invoice customer's address, or why there is none to send to. One answer for the dialog
-- and for the send.
create function app.invoice_email_recipient(p_organization_id uuid, p_invoice public.invoices, out address text, out problem text)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if p_invoice.customer_id is null then
    problem := 'This invoice is not linked to a customer record, so there is no address to send it to.';
    return;
  end if;
  select nullif(lower(btrim(c.email)), '') into address
    from public.contacts c where c.organization_id = p_organization_id and c.id = p_invoice.customer_id;
  if address is null then
    problem := 'The customer has no email address. Add one to their contact record first.';
  elsif address !~ '^[^@\s]{1,64}@[^@\s]+\.[^@\s]+$' or length(address) > 254 then
    problem := 'The customer''s email address is not a valid address. Correct it on their contact record first.';
    address := null;
  elsif app.notification_suppressed(p_organization_id, address) then
    problem := 'Email to the customer''s address bounced or was reported as unwanted, so it is not sent there again. Update their contact record with an address that works.';
    address := null;
  end if;
end;
$fn$;

revoke all on function app.invoice_email_recipient(uuid, public.invoices) from public, anon, authenticated;

-- What sending this invoice now would use, for the dialog. Writes nothing.
create function public.invoice_email_preview(p_organization_id uuid, p_invoice_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_invoice   public.invoices;
  v_document  public.invoice_documents;
  v_recipient record;
  v_sender    jsonb;
begin
  if not app.may_email_invoices(p_organization_id) then
    raise exception 'you may not email this business''s invoices' using errcode = '42501';
  end if;
  select * into v_invoice from public.invoices where organization_id = p_organization_id and id = p_invoice_id;
  if not found then
    raise exception 'no such invoice' using errcode = '42501';
  end if;
  select * into v_document from public.invoice_documents where organization_id = p_organization_id and invoice_id = v_invoice.id;
  select * into v_recipient from app.invoice_email_recipient(p_organization_id, v_invoice);
  begin
    select jsonb_build_object('address', s.from_address, 'name', s.from_name) into v_sender
      from app.organization_email_sender(p_organization_id) s;
  exception when others then
    v_sender := jsonb_build_object('problem', sqlerrm);
  end;

  return jsonb_build_object(
    'sender', v_sender,
    'recipient', jsonb_build_object(
      'address', v_recipient.address, 'problem', v_recipient.problem, 'customer_id', v_invoice.customer_id,
      -- Whether the customer confirmed this mailbox themselves, through the portal.
      'confirmed_by_customer', v_recipient.address is not null and exists (
        select 1 from public.customer_notification_recipients r
         where r.organization_id = p_organization_id and r.customer_id = v_invoice.customer_id
           and lower(r.email_address) = v_recipient.address and r.withdrawn_at is null)),
    'document', case when v_document.invoice_id is null then null
                     else jsonb_build_object('size_bytes', v_document.size_bytes, 'file_name', 'invoice-' || v_invoice.number || '.pdf') end,
    'sent_before', exists (select 1 from public.invoice_emails e where e.organization_id = p_organization_id and e.invoice_id = v_invoice.id)
  );
end;
$fn$;

revoke all on function public.invoice_email_preview(uuid, uuid) from public, anon;
grant execute on function public.invoice_email_preview(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Sending
-- ---------------------------------------------------------------------------

create function public.queue_invoice_email(
  p_organization_id uuid,
  p_invoice_id      uuid,
  p_recipient       text,
  p_subject         text,
  p_text            text,
  p_idempotency_key text,
  p_send_again          boolean default false
)
returns public.invoice_emails
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor     uuid := (select auth.uid());
  v_invoice   public.invoices;
  v_document  public.invoice_documents;
  v_recipient record;
  v_sender    record;
  v_previous  public.invoice_emails;
  v_row       public.invoice_emails;
  v_message   uuid;
begin
  if not app.may_email_invoices(p_organization_id) then
    raise exception 'you may not email this business''s invoices' using errcode = '42501';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'sending an invoice needs an idempotency key' using errcode = '22023';
  end if;

  -- The same submission, not a second one: checked first, so a retry after any later failure
  -- returns the send already made.
  select e.* into v_row
    from public.invoice_emails e
    join public.messages m on m.organization_id = e.organization_id and m.id = e.message_id
   where e.organization_id = p_organization_id and m.idempotency_key = p_idempotency_key;
  if found then
    if v_row.invoice_id <> p_invoice_id then
      raise exception 'that submission was for another invoice' using errcode = '22023';
    end if;
    return v_row;
  end if;
  if exists (select 1 from public.messages where organization_id = p_organization_id and idempotency_key = p_idempotency_key) then
    raise exception 'that submission was for another message' using errcode = '22023';
  end if;

  select * into v_invoice from public.invoices where organization_id = p_organization_id and id = p_invoice_id;
  if not found then
    raise exception 'no such invoice' using errcode = '42501';
  end if;

  -- The recorded PDF, as the writer stored it; nothing the request says.
  select * into v_document from public.invoice_documents where organization_id = p_organization_id and invoice_id = v_invoice.id;
  if not found then
    raise exception 'This invoice has no PDF yet. Create it first.' using errcode = '55000';
  end if;
  if not app.writer_stored(v_document.storage_path, v_document.size_bytes, 'application/pdf') then
    raise exception 'This invoice''s PDF could not be verified, so it is not sent.' using errcode = '55000';
  end if;
  if v_document.size_bytes > 10485760 then
    raise exception 'This invoice''s PDF is larger than an email may carry (10 MB), so it is not sent.' using errcode = '54000';
  end if;

  -- A later send of the same invoice is a separate, deliberate act.
  select * into v_previous from public.invoice_emails
   where organization_id = p_organization_id and invoice_id = v_invoice.id
   order by created_at desc limit 1;
  if v_previous.id is not null and not coalesce(p_send_again, false) then
    raise exception 'This invoice has already been emailed. Choose Send again to send it once more.' using errcode = 'GD022';
  end if;

  select * into v_recipient from app.invoice_email_recipient(p_organization_id, v_invoice);
  if v_recipient.address is null then
    raise exception '%', v_recipient.problem using errcode = '55000';
  end if;
  if lower(btrim(coalesce(p_recipient, ''))) <> v_recipient.address then
    raise exception 'The recipient is not this invoice''s customer''s address. Review the invoice again.' using errcode = '22023';
  end if;

  -- The business's own sender, or a refusal that says what to fix. Never a platform address.
  select * into v_sender from app.organization_email_sender(p_organization_id);

  v_message := public.queue_outbound_email(
    p_organization_id, v_sender.email_identity_id, v_recipient.address, p_subject, p_text, null, null,
    p_idempotency_key, v_invoice.customer_id, '[]'::jsonb);

  update public.messages set intent = 'transactional'
   where organization_id = p_organization_id and id = v_message;

  insert into public.message_attachments
    (organization_id, message_id, filename, content_type, size_bytes, storage_path, storage_state, storage_bucket, sha256)
  values
    (p_organization_id, v_message, 'invoice-' || v_invoice.number || '.pdf', 'application/pdf', v_document.size_bytes,
     v_document.storage_path, 'stored', 'finance-documents', v_document.sha256);

  insert into public.invoice_emails
    (organization_id, invoice_id, message_id, conversation_id, email_identity_id, from_address, recipient, customer_id,
     document_path, document_sha256, sent_again_after, sent_by)
  select p_organization_id, v_invoice.id, m.id, m.conversation_id, v_sender.email_identity_id, v_sender.from_address,
         v_recipient.address, v_invoice.customer_id, v_document.storage_path, v_document.sha256, v_previous.id, v_actor
    from public.messages m where m.organization_id = p_organization_id and m.id = v_message
  returning * into v_row;

  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'invoice', v_invoice.id, 'invoice.emailed',
          jsonb_build_object('invoice_id', v_invoice.id, 'number', v_invoice.number, 'message_id', v_message,
                             'from', v_sender.from_address, 'to', v_recipient.address,
                             'document_sha256', v_document.sha256, 'sent_again', v_previous.id is not null));

  return v_row;
end;
$fn$;

comment on function public.queue_invoice_email(uuid, uuid, text, text, text, text, boolean) is
  'Queue an issued invoice''s recorded PDF to its customer from the business''s own sender, once per submission. The address, sender and document are the database''s; the request may only confirm the recipient it was shown.';

revoke all on function public.queue_invoice_email(uuid, uuid, text, text, text, text, boolean) from public, anon;
grant execute on function public.queue_invoice_email(uuid, uuid, text, text, text, text, boolean) to authenticated;
