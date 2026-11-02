-- An invoice says where it came from, and nothing that reads invoices assumes Work (ADR-051).
--
-- The first half of direct invoicing, and deliberately the half that issues nothing new. Every
-- invoice so far was issued from a Work item, and several readers took that as a law: the
-- reporting function joined `work_items` inside, so an invoice with no Work would have vanished
-- from every revenue figure without an error, and both payment writers filed their timeline
-- event against the invoice's Work item, which `events.entity_id not null` would have refused.
-- This migration makes the source explicit and those readers and writers honest about it. The
-- writer that creates a direct invoice is the next migration, applied only once every running
-- application instance reads `source` (docs/deployment.md, ADR-051 rollout).
--
-- Also closes a hole the source change would otherwise have widened: `authenticated` could
-- insert straight into `invoices`, `invoice_lines` and `payments` -- any number, any amount, any
-- currency -- because `issue_invoice` and `record_payment` ran as their caller and relied on that
-- grant. Both now run as their owner with the checks the insert policies used to make, and the
-- direct grants and policies are gone. Nothing in the application wrote to these tables directly.

-- ---------------------------------------------------------------------------------------------
-- The source, and the only reference combinations it allows
-- ---------------------------------------------------------------------------------------------

-- Constant default: existing rows read 'work_item' without a rewrite, and an older application
-- instance still calling `issue_invoice` keeps producing exactly what it always did.
alter table public.invoices
  add column source text not null default 'work_item'
    constraint invoices_source_known check (source in ('work_item', 'direct'));

-- What makes a retried direct issuance the same issuance: the caller's key, and a fingerprint of
-- what that key asked for, so the same key cannot quietly stand for a different invoice.
alter table public.invoices
  add column issuance_key         uuid,
  add column issuance_fingerprint text;

alter table public.invoices alter column work_item_id drop not null;

-- A Work invoice names its Work and carries no issuance key; a direct invoice names no Work and
-- always does. The customer is not part of this check on purpose: it is snapshotted as `billed_to`
-- and the contact may later be deleted (`on delete set null`), exactly as for a Work invoice.
alter table public.invoices
  add constraint invoices_source_reference check (
    (source = 'work_item' and work_item_id is not null and issuance_key is null and issuance_fingerprint is null)
    or
    (source = 'direct' and work_item_id is null and issuance_key is not null and issuance_fingerprint is not null)
  );

-- `invoices_org_work_item_unique` stays exactly as it is: a direct invoice's null Work never
-- collides, so one invoice per Work item is still the database's guarantee.
create unique index invoices_org_issuance_key_unique
  on public.invoices (organization_id, issuance_key)
  where issuance_key is not null;

-- ---------------------------------------------------------------------------------------------
-- The one numbering authority
-- ---------------------------------------------------------------------------------------------

-- Next number for one business, serialized per business. Before this, two invoices issued at the
-- same instant both read the same `max` and the unique index failed one of them; now the second
-- waits for the first to commit and takes the following number. Both issuers call this, so there
-- is still exactly one sequence per organization.
create function app.allocate_invoice_number(p_organization_id uuid)
returns integer
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_number integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('invoices.number:' || p_organization_id::text, 0));
  select coalesce(max(i.number), 0) + 1 into v_number
    from public.invoices i
   where i.organization_id = p_organization_id;
  return v_number;
end;
$fn$;

revoke all on function app.allocate_invoice_number(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Issuing from Work: unchanged in what it produces, now its own authority
-- ---------------------------------------------------------------------------------------------

create or replace function public.issue_invoice(
  p_work_item_id uuid,
  p_issued_at    timestamptz,
  p_due_at       timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor    uuid := (select auth.uid());
  v_item     public.work_items;
  v_customer text;
  v_currency text;
  v_issued   timestamptz := coalesce(p_issued_at, now());
  v_number   integer;
  v_invoice  uuid;
begin
  if v_actor is null then
    raise exception 'issue_invoice requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- What the caller's own policies used to decide, decided here: the Work item must belong to a
  -- business this person is a member of (`work_items_select`), and they must hold
  -- `invoice.issue` there (the retired `invoices_insert` policy). Another tenant's item is absent.
  select * into v_item from public.work_items where id = p_work_item_id;

  if v_item.id is null
     or v_item.organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(v_item.organization_id, 'invoice.issue') then
    raise exception 'no such work item, or you may not invoice it'
      using errcode = '42501';
  end if;

  -- The currency is the quote's, snapshotted. A job with no priced lines has not been quoted
  -- and cannot be invoiced: an invoice for nothing is a document nobody meant to send, and it
  -- is different from an invoice for zero, which is a decision somebody made.
  select l.currency into v_currency
  from public.work_item_priced_lines l
  where l.organization_id = v_item.organization_id
    and l.work_item_id = p_work_item_id
  limit 1;

  if v_currency is null then
    raise exception 'this job has nothing priced on it'
      using errcode = 'GD002';
  end if;

  select coalesce(c.name, 'Customer') into v_customer
  from public.contacts c
  where c.organization_id = v_item.organization_id
    and c.id = v_item.customer_id;

  -- **The number follows the order invoices were issued in, not the dates written on them.**
  -- A business that back-dates one out of order gets a number that does not match its date,
  -- which is the business's to notice: numbering by date would mean renumbering documents
  -- already sent, which is worse than either.
  v_number := app.allocate_invoice_number(v_item.organization_id);

  insert into public.invoices
    (organization_id, source, work_item_id, customer_id, billed_to, number, currency,
     issued_at, due_at, created_by)
  values
    (v_item.organization_id, 'work_item', p_work_item_id, v_item.customer_id,
     coalesce(v_customer, 'Customer'), v_number, v_currency, v_issued, p_due_at, v_actor)
  returning id into v_invoice;

  -- The copy. Ordered so the document reads the way the quote did.
  insert into public.invoice_lines
    (organization_id, invoice_id, description, unit, unit_amount_minor, currency, quantity, position)
  select
    v_item.organization_id, v_invoice, l.description, l.unit, l.unit_amount_minor,
    l.currency, l.quantity, row_number() over (order by l.created_at)
  from public.work_item_priced_lines l
  where l.organization_id = v_item.organization_id
    and l.work_item_id = p_work_item_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_item.organization_id, v_actor, 'work_item', p_work_item_id, 'invoice.issued',
     jsonb_build_object(
       'invoice_id', v_invoice,
       'number', v_number,
       'currency', v_currency,
       'issued_at', v_issued
     ));

  return v_invoice;
end;
$fn$;

revoke all on function public.issue_invoice(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.issue_invoice(uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Money arriving: the timeline event follows the invoice's source
-- ---------------------------------------------------------------------------------------------

create or replace function public.record_payment(
  p_invoice_id         uuid,
  p_amount_minor       bigint,
  p_received_at        timestamptz,
  p_note               text,
  p_provider           text,
  p_provider_reference text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor   uuid := (select auth.uid());
  v_invoice public.invoices;
  v_id      uuid;
begin
  if v_actor is null then
    raise exception 'record_payment requires an authenticated caller'
      using errcode = '42501';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id;

  -- What `invoices_select` and the retired `payments_insert` policy decided between them.
  if v_invoice.id is null
     or v_invoice.organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(v_invoice.organization_id, 'payment.record') then
    raise exception 'no such invoice, or you may not record against it'
      using errcode = '42501';
  end if;

  -- **The currency is the invoice's and is never an argument.** A payment in another currency
  -- against this invoice would need a rate, a rate has a date, and that is the accounting
  -- system `vision.md` refuses to be.
  insert into public.payments
    (organization_id, invoice_id, amount_minor, currency, received_at, note,
     provider, provider_reference, created_by)
  values
    (v_invoice.organization_id, p_invoice_id, p_amount_minor, v_invoice.currency,
     coalesce(p_received_at, now()), nullif(btrim(p_note), ''),
     nullif(btrim(p_provider), ''), nullif(btrim(p_provider_reference), ''), v_actor)
  returning id into v_id;

  -- A Work invoice's money stays on its Work item's timeline, as before; a direct invoice has no
  -- Work, so the event is the invoice's own.
  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_invoice.organization_id, v_actor,
     case when v_invoice.work_item_id is null then 'invoice' else 'work_item' end,
     coalesce(v_invoice.work_item_id, v_invoice.id),
     'payment.recorded',
     jsonb_build_object(
       'invoice_id', p_invoice_id,
       'payment_id', v_id,
       'amount_minor', p_amount_minor,
       'currency', v_invoice.currency,
       'provider', nullif(btrim(p_provider), '')
     ));

  return v_id;
end;
$fn$;

revoke all on function public.record_payment(uuid, bigint, timestamptz, text, text, text) from public, anon;
grant execute on function public.record_payment(uuid, bigint, timestamptz, text, text, text) to authenticated;

create or replace function public.record_provider_payment(
  p_request_id         uuid,
  p_provider           text,
  p_provider_reference text,
  p_amount_minor       bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor   constant uuid := '00000000-0000-4000-8000-0000000000a1';
  v_request public.payment_requests;
  v_id      uuid;
begin
  -- By primary key: our own uuid, handed to the processor as a correlation token and returned
  -- inside a payload whose signature has already been checked. The row carries the organization,
  -- the invoice and the currency, and the caller names none of them.
  select * into v_request
  from public.payment_requests
  where id = p_request_id
    and provider = p_provider;

  if v_request.id is null then
    raise exception 'no payment was requested under that reference'
      using errcode = 'GD003';
  end if;

  insert into public.payments
    (organization_id, invoice_id, amount_minor, currency, received_at,
     provider, provider_reference, created_by)
  values
    (v_request.organization_id, v_request.invoice_id, p_amount_minor, v_request.currency,
     now(), p_provider, p_provider_reference, v_actor)
  on conflict (organization_id, provider, provider_reference)
    where provider is not null
    do nothing
  returning id into v_id;

  if v_id is null then
    -- The redelivery path: the same answer as the first delivery.
    select p.id into v_id
    from public.payments p
    where p.organization_id = v_request.organization_id
      and p.provider = p_provider
      and p.provider_reference = p_provider_reference;

    return v_id;
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  select
    v_request.organization_id, v_actor,
    case when i.work_item_id is null then 'invoice' else 'work_item' end,
    coalesce(i.work_item_id, i.id),
    'payment.recorded',
    jsonb_build_object(
      'invoice_id', v_request.invoice_id,
      'payment_id', v_id,
      'amount_minor', p_amount_minor,
      'currency', v_request.currency,
      'provider', p_provider
    )
  from public.invoices i
  where i.organization_id = v_request.organization_id
    and i.id = v_request.invoice_id;

  return v_id;
end;
$fn$;

-- ---------------------------------------------------------------------------------------------
-- No direct writers
-- ---------------------------------------------------------------------------------------------

drop policy invoices_insert on public.invoices;
drop policy invoice_lines_insert on public.invoice_lines;
drop policy payments_insert on public.payments;

revoke insert, update, delete on public.invoices, public.invoice_lines, public.payments from authenticated, anon;

-- ---------------------------------------------------------------------------------------------
-- Readers that report the source
-- ---------------------------------------------------------------------------------------------

-- New columns are appended, so the shape every existing reader selects is unchanged.
create or replace view public.finance_invoice_records with (security_invoker = true) as
 select i.id,
    i.organization_id,
    i.work_item_id,
    i.customer_id,
    i.billed_to,
    i.number,
    i.currency,
    i.issued_at,
    i.due_at,
    i.created_by,
    t.total_minor,
    coalesce(p.paid_minor, 0::bigint) as paid_minor,
    t.total_minor - coalesce(p.paid_minor, 0::bigint) as outstanding_minor,
    t.total_minor <= coalesce(p.paid_minor, 0::bigint) as settled,
    t.total_minor > coalesce(p.paid_minor, 0::bigint) and i.due_at < now() as overdue,
    i.source
   from public.invoices i
     join lateral ( select sum(l.unit_amount_minor * l.quantity)::bigint as total_minor
           from public.invoice_lines l
          where l.organization_id = i.organization_id and l.invoice_id = i.id) t on true
     left join lateral ( select sum(p_1.amount_minor)::bigint as paid_minor
           from public.payments p_1
          where p_1.organization_id = i.organization_id and p_1.invoice_id = i.id) p on true;

create or replace view public.finance_payment_records with (security_invoker = true) as
 select p.id,
    p.organization_id,
    p.invoice_id,
    p.amount_minor,
    p.currency,
    p.received_at,
    p.provider,
    p.provider_reference,
    p.note,
    p.created_by,
    i.number as invoice_number,
    i.billed_to,
    i.customer_id,
    i.work_item_id,
    i.source as invoice_source
   from public.payments p
     join public.invoices i on i.organization_id = p.organization_id and i.id = p.invoice_id;

-- Revenue no longer depends on Work existing. A Work invoice is attributed exactly as before,
-- through its Work item (customer, location and resource as the job reads now); a direct invoice
-- has only the customer it was issued to, so it lands in a customer or service report and in the
-- unattributed group of a location or resource report, and a location or resource filter leaves
-- it out -- it has neither.
create or replace function public.invoiced_and_incurred(
  p_organization_id uuid,
  p_grouping        text,
  p_from            date default null,
  p_to              date default null,
  p_customer_id     uuid default null,
  p_resource_id     uuid default null,
  p_location_id     uuid default null
)
returns table (group_id uuid, group_label text, currency text, invoiced_minor bigint, incurred_minor bigint, margin_minor bigint)
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_zone text;
  v_from timestamptz;
  v_to   timestamptz;
begin
  -- An aggregate is a disclosure no row-level read makes, so the capability is checked here
  -- (20260903000003; `schema-conformance.test.ts` reads function bodies for I16).
  if not app.has_capability(p_organization_id, 'report.read') then
    raise exception 'you may not read this business''s figures'
      using errcode = '42501';
  end if;

  if p_grouping not in ('customer', 'service', 'resource', 'location') then
    raise exception 'unknown grouping: %', p_grouping using errcode = '22023';
  end if;

  select o.timezone into v_zone
    from public.organizations o
   where o.id = p_organization_id;

  v_zone := coalesce(v_zone, 'UTC');
  v_from := case when p_from is not null then p_from::timestamp at time zone v_zone end;
  v_to   := case when p_to   is not null then p_to::timestamp   at time zone v_zone end;

  return query
  with billed as (
    select case when i.work_item_id is null then i.customer_id else w.customer_id end as customer_id,
           a.resource_id,
           w.location_id,
           l.description,
           l.currency,
           -- The price rule, in the second of its two expressions (`reporting.test.ts`).
           l.unit_amount_minor * l.quantity as amount_minor
      from public.invoices i
      join public.invoice_lines l
        on l.organization_id = i.organization_id
       and l.invoice_id = i.id
      left join public.work_items w
        on w.organization_id = i.organization_id
       and w.id = i.work_item_id
      left join public.work_item_resource_assignments a
        on (p_grouping = 'resource' or p_resource_id is not null)
       and a.organization_id = w.organization_id
       and a.work_item_id = w.id
       and (p_resource_id is null or a.resource_id = p_resource_id)
     where i.organization_id = p_organization_id
       and (v_from is null or i.issued_at >= v_from)
       and (v_to is null or i.issued_at < v_to)
       -- A Work invoice still could not be counted without its Work (the foreign key cascades),
       -- so this keeps the inner join's meaning for that source.
       and (i.work_item_id is null or w.id is not null)
       and (p_customer_id is null
            or (case when i.work_item_id is null then i.customer_id else w.customer_id end) = p_customer_id)
       and (p_resource_id is null or a.resource_id is not null)
       and (p_location_id is null or w.location_id = p_location_id)
  ),
  spent as (
    select w.customer_id,
           a.resource_id,
           w.location_id,
           c.currency,
           c.amount_minor
      from public.work_item_costs c
      join public.work_items w
        on w.organization_id = c.organization_id
       and w.id = c.work_item_id
      left join public.work_item_resource_assignments a
        on (p_grouping = 'resource' or p_resource_id is not null)
       and a.organization_id = w.organization_id
       and a.work_item_id = w.id
       and (p_resource_id is null or a.resource_id = p_resource_id)
     where c.organization_id = p_organization_id
       and (v_from is null or c.incurred_at >= v_from)
       and (v_to is null or c.incurred_at < v_to)
       and (p_customer_id is null or w.customer_id = p_customer_id)
       and (p_resource_id is null or a.resource_id is not null)
       and (p_location_id is null or w.location_id = p_location_id)
       and p_grouping <> 'service'
  ),
  facts as (
    select case p_grouping
             when 'customer' then b.customer_id
             when 'resource' then b.resource_id
             when 'location' then b.location_id
           end                                            as group_id,
           case when p_grouping = 'service' then b.description end as service_label,
           b.currency,
           b.amount_minor                                 as invoiced,
           0::bigint                                      as incurred
      from billed b
     union all
    select case p_grouping
             when 'customer' then s.customer_id
             when 'resource' then s.resource_id
             when 'location' then s.location_id
           end,
           null,
           s.currency,
           0::bigint,
           s.amount_minor
      from spent s
  )
  select f.group_id,
         case p_grouping
           when 'customer' then cu.name
           when 'resource' then r.name
           when 'location' then lo.label
           when 'service'  then f.service_label
         end,
         f.currency,
         sum(f.invoiced)::bigint,
         case when p_grouping = 'service' then null else sum(f.incurred)::bigint end,
         case when p_grouping = 'service' then null
              else (sum(f.invoiced) - sum(f.incurred))::bigint
         end
    from facts f
    left join public.contacts cu
      on p_grouping = 'customer'
     and cu.organization_id = p_organization_id
     and cu.id = f.group_id
    left join public.resources r
      on p_grouping = 'resource'
     and r.organization_id = p_organization_id
     and r.id = f.group_id
    left join public.locations lo
      on p_grouping = 'location'
     and lo.organization_id = p_organization_id
     and lo.id = f.group_id
   group by f.group_id, 2, f.currency
   order by 4 desc, 2 nulls last;
end;
$fn$;
