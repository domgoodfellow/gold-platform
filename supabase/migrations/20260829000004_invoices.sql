-- Invoices and payments: what a business asks for, and what arrived.
--
-- M4's criterion names this and no earlier coverage list did: "quotes or bookings in, work
-- scheduled and assigned, work completed, invoiced, and paid".
--
-- **Three columns that are not here carry most of the design.**
--
--   * **No `total_minor` on an invoice.** The total is `priceWorkItem` over the invoice's own
--     lines, which is I4 — there is exactly one place an amount is derived, and a stored total
--     is precisely the second opinion able to drift from it. It is also the one that will look
--     most like a harmless optimisation the first time an invoice list is slow.
--   * **No `status` on an invoice, and no `paid` flag.** Whether an invoice is paid is
--     arithmetic over its payments. A status column would be a second source of truth that
--     disagrees the first time one is written without the other -- the same argument
--     `domain-model.md` makes for refusing a `calendar` table, and for refusing an `activity`
--     log beside `events`.
--   * **No `method` on a payment.** "Cash" is what *no provider* means. Inventing an enum of
--     payment methods would be a platform vocabulary nobody asked for; when a business needs
--     to tell a bank transfer from notes in a hand, that is a caller and a column then.

-- ---------------------------------------------------------------------------
-- Capabilities
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
    'document.create',
    'work_item.transition',
    'work_item.schedule',
    'work_item.record',
    'organization.manage',
    'price.manage',
    'work_item.price',
    'work_item.update',
    'invoice.issue',
    'payment.record'
  ]::text[]);

-- Two capabilities rather than one, because they are plausibly two people. Deciding that a job
-- is finished and asking to be paid for it is the person who runs the work; writing down that
-- money arrived is whoever opens the post. Backfilled onto the closest existing answer to each.
update public.roles
   set capabilities = capabilities || array['invoice.issue']::text[]
 where 'work_item.price' = any (capabilities)
   and not ('invoice.issue' = any (capabilities));

update public.roles
   set capabilities = capabilities || array['payment.record']::text[]
 where 'work_item.record' = any (capabilities)
   and not ('payment.record' = any (capabilities));

-- ---------------------------------------------------------------------------
-- The invoice
-- ---------------------------------------------------------------------------

create table public.invoices (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,

  work_item_id    uuid        not null,

  -- Snapshotted, not joined. Who was billed is a term of the invoice: a customer renamed or
  -- merged next year does not change who this document was addressed to.
  customer_id     uuid,
  billed_to       text        not null check (length(btrim(billed_to)) between 1 and 200),

  -- The business's own sequence, and it is human-facing. `(organization_id, number)` is the
  -- unique index, which is I2 doing exactly the job it exists for: two businesses both having
  -- an invoice 1 is the ordinary case, and a global sequence would leak how many invoices the
  -- platform has issued to everyone who receives one.
  number          integer     not null check (number > 0),

  -- Snapshotted from the lines, so the document has a currency even if every line is struck.
  currency        text        not null check (currency ~ '^[A-Z]{3}$'),

  issued_at       timestamptz not null default now(),
  due_at          timestamptz,

  created_by      uuid        not null references auth.users (id),

  constraint invoices_work_item_same_org
    foreign key (organization_id, work_item_id)
    references public.work_items (organization_id, id) on delete cascade,

  constraint invoices_customer_same_org
    foreign key (organization_id, customer_id)
    references public.customers (organization_id, id) on delete set null (customer_id)
);

comment on table public.invoices is
  'What a business asked to be paid. Holds no total and no status: the total is priceWorkItem over its lines (I4), and paid-ness is arithmetic over payments.';

create unique index invoices_org_number_unique
  on public.invoices (organization_id, number);

-- **One invoice per job, and the constraint is the guarantee rather than a check in the
-- function.** A second invoice for the same work is either a duplicate or a credit note, and a
-- credit note has no caller. Written as a unique index so that two operators pressing the
-- button at once produce one invoice and one clear failure, rather than two invoices and a
-- confused customer -- the same reasoning I6 gives about checking before writing.
create unique index invoices_org_work_item_unique
  on public.invoices (organization_id, work_item_id);

create index invoices_org_issued_at_idx
  on public.invoices (organization_id, issued_at desc);

alter table public.invoices
  add constraint invoices_org_id_unique unique (organization_id, id);

alter table public.invoices enable row level security;
alter table public.invoices force row level security;

create policy invoices_select on public.invoices
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy invoices_insert on public.invoices
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'invoice.issue')
  );

-- No update policy and no delete policy. An issued invoice is a document somebody was sent;
-- "never rewrite history" applies to it more literally than to anything else in this schema.

grant select, insert on public.invoices to authenticated;

-- ---------------------------------------------------------------------------
-- Its lines
-- ---------------------------------------------------------------------------

-- **A copy of the quote at the moment of issue, and there is no foreign key back to
-- `work_item_priced_lines`.** The reasoning is I8's and it is the same one that keeps a priced
-- line free of a key to `price_book_items`: a copy that is merely not currently joined becomes
-- a join the first time a key makes one look safe, and the first `join work_item_priced_lines`
-- written for a perfectly good reason would make every issued invoice track today's quote.
--
-- The quote can still change after the invoice is issued. That is the point of copying.
create table public.invoice_lines (
  id                uuid    primary key default gen_random_uuid(),
  organization_id   uuid    not null references public.organizations (id) on delete cascade,
  invoice_id        uuid    not null,

  description       text    not null,
  unit              text    not null,
  unit_amount_minor bigint  not null,
  currency          text    not null check (currency ~ '^[A-Z]{3}$'),
  quantity          integer not null check (quantity > 0),
  position          integer not null,

  constraint invoice_lines_invoice_same_org
    foreign key (organization_id, invoice_id)
    references public.invoices (organization_id, id) on delete cascade
);

comment on table public.invoice_lines is
  'The quote, copied at the moment of issue. Deliberately holds no reference to work_item_priced_lines -- see I8.';

create index invoice_lines_org_invoice_idx
  on public.invoice_lines (organization_id, invoice_id, position);

alter table public.invoice_lines enable row level security;
alter table public.invoice_lines force row level security;

create policy invoice_lines_select on public.invoice_lines
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy invoice_lines_insert on public.invoice_lines
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'invoice.issue')
  );

grant select, insert on public.invoice_lines to authenticated;

-- ---------------------------------------------------------------------------
-- Money arriving
-- ---------------------------------------------------------------------------

create table public.payments (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  invoice_id      uuid        not null,

  -- I10 throughout: integer minor units, and a currency of its own rather than a join to the
  -- invoice. A payment records what actually arrived.
  amount_minor    bigint      not null constraint payments_amount_not_zero check (amount_minor <> 0),
  currency        text        not null check (currency ~ '^[A-Z]{3}$'),

  received_at     timestamptz not null default now(),

  -- **Null means a person recorded it, and that is what "cash" is.** A vendor is authoritative
  -- for its own events only, so a payment that came from one names it and carries the vendor's
  -- own identifier; anything a human wrote down names nobody. There is deliberately no list of
  -- payment methods -- see the note at the top of this file.
  provider           text,
  provider_reference text,

  note            text,

  created_by      uuid        not null references auth.users (id),

  constraint payments_invoice_same_org
    foreign key (organization_id, invoice_id)
    references public.invoices (organization_id, id) on delete cascade,

  constraint payments_provider_reference_together
    check ((provider is null) = (provider_reference is null))
);

comment on table public.payments is
  'What arrived against an invoice. A null provider is a payment somebody wrote down -- cash and manual payments never touch a processor and are never recorded as though they did.';

-- Idempotency for a writer with no human caller: a processor that delivers the same event
-- twice writes one row. Leads with `organization_id` (I2), and is partial so that the many
-- hand-recorded payments -- all of which have a null provider -- share no key.
create unique index payments_org_provider_reference_unique
  on public.payments (organization_id, provider, provider_reference)
  where (provider is not null);

create index payments_org_invoice_idx
  on public.payments (organization_id, invoice_id, received_at);

alter table public.payments enable row level security;
alter table public.payments force row level security;

create policy payments_select on public.payments
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy payments_insert on public.payments
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'payment.record')
  );

-- No update and no delete. A payment recorded wrongly is corrected by recording its reverse,
-- which is why `amount_minor` is signed and only zero is refused.

grant select, insert on public.payments to authenticated;

-- ---------------------------------------------------------------------------
-- Issuing
-- ---------------------------------------------------------------------------

create function public.issue_invoice(
  p_work_item_id uuid,
  p_due_at       timestamptz
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor    uuid := (select auth.uid());
  v_item     public.work_items;
  v_customer text;
  v_currency text;
  v_number   integer;
  v_invoice  uuid;
begin
  if v_actor is null then
    raise exception 'issue_invoice requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- Read under the caller's own RLS, so another tenant's work item is simply absent.
  select * into v_item from public.work_items where id = p_work_item_id;

  if v_item.id is null then
    raise exception 'no such work item, or you may not invoice it'
      using errcode = '42501';
  end if;

  -- The currency is the quote's, snapshotted. A job with no priced lines has not been quoted
  -- and cannot be invoiced: an invoice for nothing is a document nobody meant to send, and it
  -- is different from an invoice for zero, which is a decision somebody made.
  select l.currency into v_currency
  from public.work_item_priced_lines l
  where l.work_item_id = p_work_item_id
  limit 1;

  if v_currency is null then
    raise exception 'this job has nothing priced on it'
      using errcode = 'GD002';
  end if;

  select coalesce(c.name, 'Customer') into v_customer
  from public.customers c
  where c.id = v_item.customer_id;

  -- The next number for this business. It races, and the unique index is what settles it --
  -- two operators pressing the button at the same instant produce one invoice and one honest
  -- failure, rather than a check that looked safe and two invoices numbered alike. Exactly
  -- I6's argument, applied to a sequence instead of a slot.
  select coalesce(max(i.number), 0) + 1 into v_number
  from public.invoices i
  where i.organization_id = v_item.organization_id;

  insert into public.invoices
    (organization_id, work_item_id, customer_id, billed_to, number, currency, due_at, created_by)
  values
    (v_item.organization_id, p_work_item_id, v_item.customer_id,
     coalesce(v_customer, 'Customer'), v_number, v_currency, p_due_at, v_actor)
  returning id into v_invoice;

  -- The copy. Ordered so the document reads the way the quote did.
  insert into public.invoice_lines
    (organization_id, invoice_id, description, unit, unit_amount_minor, currency, quantity, position)
  select
    v_item.organization_id, v_invoice, l.description, l.unit, l.unit_amount_minor,
    l.currency, l.quantity, row_number() over (order by l.created_at)
  from public.work_item_priced_lines l
  where l.work_item_id = p_work_item_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_item.organization_id, v_actor, 'work_item', p_work_item_id, 'invoice.issued',
     jsonb_build_object('invoice_id', v_invoice, 'number', v_number, 'currency', v_currency));

  return v_invoice;
end;
$fn$;

revoke all on function public.issue_invoice(uuid, timestamptz) from public;
grant execute on function public.issue_invoice(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Recording money
-- ---------------------------------------------------------------------------

create function public.record_payment(
  p_invoice_id        uuid,
  p_amount_minor      bigint,
  p_received_at       timestamptz,
  p_note              text,
  p_provider          text,
  p_provider_reference text
)
returns uuid
language plpgsql
volatile
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

  if v_invoice.id is null then
    raise exception 'no such invoice, or you may not record against it'
      using errcode = '42501';
  end if;

  -- **The currency is the invoice's and is never an argument.** A payment in another currency
  -- against this invoice would need a rate, a rate has a date, and that is the accounting
  -- system `vision.md` refuses to be. A business paid in a currency it did not invoice in has
  -- a conversation to have, not a row to write.
  insert into public.payments
    (organization_id, invoice_id, amount_minor, currency, received_at, note,
     provider, provider_reference, created_by)
  values
    (v_invoice.organization_id, p_invoice_id, p_amount_minor, v_invoice.currency,
     coalesce(p_received_at, now()), nullif(btrim(p_note), ''),
     nullif(btrim(p_provider), ''), nullif(btrim(p_provider_reference), ''), v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_invoice.organization_id, v_actor, 'work_item', v_invoice.work_item_id, 'payment.recorded',
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

revoke all on function public.record_payment(uuid, bigint, timestamptz, text, text, text) from public;
grant execute on function public.record_payment(uuid, bigint, timestamptz, text, text, text) to authenticated;
