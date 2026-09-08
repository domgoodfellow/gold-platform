-- A cost and an invoice say when they happened, rather than when somebody typed them in.
--
-- **This is an asymmetry being closed, not a feature being added.** `record_payment` has taken
-- `p_received_at` since invoices arrived and coalesces it to `now()`; its two hand-entered
-- siblings did not. So a fuel receipt from last Tuesday was stamped with the moment somebody
-- got round to entering it, and an invoice for work finished last month was dated today. That
-- was never decided -- payments got the parameter because a card webhook supplies one, and
-- nobody looked at the other two again.
--
-- **Both tables already knew these were two clocks.** `work_item_costs` carries `incurred_at`
-- *and* `created_at`; `invoices` carries `issued_at` beside `created_at`. One is when the thing
-- happened in the world, the other is when this platform heard about it. Only the second was
-- ever writable, which left the first a slower copy of it.
--
-- **What this deliberately does not touch: `created_at` anywhere, and `events.occurred_at`.**
-- Those are this platform's own record of when a row appeared and when somebody acted. A caller
-- that can set them is a caller that can write a customer dated before the business existed,
-- and an event log that is not a log. A business that wants to record when somebody *became* a
-- customer has custom fields for it, which is the answer that does not cost the trail its
-- meaning.
--
-- **No check that either date is in the past**, matching `record_payment`, which has none
-- either. A business that writes next week on an invoice has made a mistake it can see on its
-- own screen; a constraint here would be a rule this migration invented rather than one a
-- caller asked for.

-- ---------------------------------------------------------------------------
-- A cost knows when it was incurred
-- ---------------------------------------------------------------------------

-- Dropped and recreated rather than overloaded. Two candidates of one name is an ambiguity
-- PostgREST reports as a failure to find the function at all, which is a confusing way to
-- discover that a migration added a second one.
drop function public.record_work_item_cost(uuid, text, bigint);

create function public.record_work_item_cost(
  p_work_item_id uuid,
  p_description  text,
  p_amount_minor bigint,
  p_incurred_at  timestamptz
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor    uuid := (select auth.uid());
  v_org      uuid;
  v_currency text;
  v_incurred timestamptz := coalesce(p_incurred_at, now());
  v_id       uuid;
begin
  if v_actor is null then
    raise exception 'record_work_item_cost requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- The currency is read from the organization and written onto the row, not passed in. A
  -- caller does not get to assert what currency a business trades in, and the snapshot is
  -- what keeps a later change from rewriting this amount's meaning (I8).
  select w.organization_id, o.currency into v_org, v_currency
    from public.work_items w
    join public.organizations o on o.id = w.organization_id
   where w.id = p_work_item_id;

  if v_org is null then
    raise exception 'no such work item' using errcode = '23503';
  end if;

  insert into public.work_item_costs
    (organization_id, work_item_id, description, amount_minor, currency, incurred_at, created_by)
  values (v_org, p_work_item_id, p_description, p_amount_minor, v_currency, v_incurred, v_actor)
  returning id into v_id;

  -- **The event's own timestamp stays `now()`, and that is the point of having both.** What
  -- happened at this instant is that somebody recorded a cost; what happened last Tuesday is
  -- the cost. The date goes in the payload so a reader of the timeline can tell the two apart
  -- without joining back to a row that may since have been corrected.
  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'work_item', p_work_item_id, 'work_item.cost_recorded',
     jsonb_build_object(
       'cost_id', v_id,
       'description', p_description,
       'amount_minor', p_amount_minor,
       'currency', v_currency,
       'incurred_at', v_incurred
     ));

  return v_id;
end;
$fn$;

revoke all on function public.record_work_item_cost(uuid, text, bigint, timestamptz) from public;
grant execute on function public.record_work_item_cost(uuid, text, bigint, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- An invoice knows when it was issued
-- ---------------------------------------------------------------------------

drop function public.issue_invoice(uuid, timestamptz);

create function public.issue_invoice(
  p_work_item_id uuid,
  p_issued_at    timestamptz,
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
  v_issued   timestamptz := coalesce(p_issued_at, now());
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
  --
  -- **The number follows the order invoices were issued in, not the dates written on them.**
  -- A business that back-dates one out of order gets a number that does not match its date,
  -- which is a real problem in some places and is the business's to notice: numbering by date
  -- would mean renumbering documents already sent, which is worse than either.
  select coalesce(max(i.number), 0) + 1 into v_number
  from public.invoices i
  where i.organization_id = v_item.organization_id;

  insert into public.invoices
    (organization_id, work_item_id, customer_id, billed_to, number, currency,
     issued_at, due_at, created_by)
  values
    (v_item.organization_id, p_work_item_id, v_item.customer_id,
     coalesce(v_customer, 'Customer'), v_number, v_currency, v_issued, p_due_at, v_actor)
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
     jsonb_build_object(
       'invoice_id', v_invoice,
       'number', v_number,
       'currency', v_currency,
       'issued_at', v_issued
     ));

  return v_invoice;
end;
$fn$;

revoke all on function public.issue_invoice(uuid, timestamptz, timestamptz) from public;
grant execute on function public.issue_invoice(uuid, timestamptz, timestamptz) to authenticated;
