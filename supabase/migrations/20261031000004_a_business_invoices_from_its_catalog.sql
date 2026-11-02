-- A business invoices a customer from its own catalog, with no Work item (ADR-051, first slice).
--
-- The writer half of direct invoicing. `20261031000003` made `source` explicit and every reader
-- and payment writer source-aware; this is applied only after every running application instance
-- reads `source`, because an older instance would render a direct invoice's missing Work as a
-- broken link or a payment it cannot find (docs/deployment.md).
--
-- The caller names a customer, catalog items and whole quantities, and nothing that is money.
-- Each line's description, unit, price and currency are copied from the organization's own
-- `price_book_items` at issuance -- the same snapshot rule a priced Work line follows -- so a
-- later price change never reaches an issued invoice, and there is no argument through which a
-- browser could name a price, a discount or a total. The number comes from the one numbering
-- authority, `app.allocate_invoice_number`, shared with `issue_invoice`.

create function public.issue_direct_invoice(
  p_organization_id uuid,
  p_customer_id     uuid,
  p_lines           jsonb,
  p_issued_at       timestamptz,
  p_due_at          timestamptz,
  p_issuance_key    uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor       uuid := (select auth.uid());
  v_currency    text;
  v_customer    public.contacts;
  v_issued      timestamptz := coalesce(p_issued_at, now());
  v_lines       jsonb;
  v_fingerprint text;
  v_existing    public.invoices;
  v_number      integer;
  v_invoice     uuid;
  v_line        jsonb;
  v_count       integer;
  v_matched     integer;
  v_valid       boolean;
begin
  if v_actor is null then
    raise exception 'issue_direct_invoice requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- The same authority as issuing from Work: a member of this business holding `invoice.issue`,
  -- in a business whose Billing module is usable (the database half of `financeMutation`'s check).
  if p_organization_id is null
     or p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'invoice.issue') then
    raise exception 'you may not issue invoices for this business'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.usable_modules(p_organization_id) m where m = 'billing') then
    raise exception 'billing is not available for this business'
      using errcode = '42501';
  end if;

  if p_issuance_key is null then
    raise exception 'an issuance needs its own key, so a retry is the same request'
      using errcode = '22023';
  end if;
  if p_due_at is not null and p_due_at < v_issued then
    raise exception 'the due date is before the invoice date'
      using errcode = '22023';
  end if;

  -- The request's shape, refused whole rather than partly honoured. A line is exactly a catalog
  -- item and a whole quantity: any other key -- a price, an amount, a discount, a description --
  -- is a request to set something the catalog decides, and is refused rather than ignored.
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'lines must be a list' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_lines);
  if v_count < 1 or v_count > 100 then
    raise exception 'an invoice has between 1 and 100 lines' using errcode = '22023';
  end if;
  -- One test at a time: SQL does not promise to evaluate `or` left to right, and a cast reached
  -- before its shape check would fail with a different error than the refusal meant.
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_valid := jsonb_typeof(v_line) = 'object';
    if v_valid then
      v_valid := not exists (select 1 from jsonb_object_keys(v_line) k where k not in ('price_book_item_id', 'quantity'));
    end if;
    -- `coalesce` because a missing key is null, and a null test would read as neither valid nor invalid.
    if v_valid then
      v_valid := coalesce(
        jsonb_typeof(v_line -> 'price_book_item_id') = 'string'
        and (v_line ->> 'price_book_item_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        and jsonb_typeof(v_line -> 'quantity') = 'number',
        false);
    end if;
    if v_valid then
      v_valid := (v_line ->> 'quantity') ~ '^[0-9]{1,7}$';
    end if;
    if v_valid then
      v_valid := (v_line ->> 'quantity')::integer between 1 and 1000000;
    end if;
    if not v_valid then
      raise exception 'each line is a catalog item and a whole quantity from 1 to 1,000,000, and nothing else'
        using errcode = '22023';
    end if;
  end loop;

  -- Normalized, so the fingerprint is of what was asked rather than how it was spelled.
  select jsonb_agg(jsonb_build_object('price_book_item_id', lower(e.value ->> 'price_book_item_id'), 'quantity', (e.value ->> 'quantity')::integer) order by e.ordinality)
    into v_lines
    from jsonb_array_elements(p_lines) with ordinality as e(value, ordinality);
  v_fingerprint := md5(jsonb_build_object(
    'customer', p_customer_id, 'lines', v_lines, 'issued_at', p_issued_at, 'due_at', p_due_at
  )::text);

  -- Serializes this business's issuance (both sources) from here to commit, so the retry check
  -- below and the number cannot race a concurrent request.
  v_number := app.allocate_invoice_number(p_organization_id);

  select * into v_existing
    from public.invoices i
   where i.organization_id = p_organization_id
     and i.issuance_key = p_issuance_key;
  if v_existing.id is not null then
    if v_existing.issuance_fingerprint = v_fingerprint then
      return v_existing.id;
    end if;
    raise exception 'that issuance key was already used for a different invoice'
      using errcode = 'GD014';
  end if;

  select * into v_customer
    from public.contacts c
   where c.organization_id = p_organization_id
     and c.id = p_customer_id;
  if v_customer.id is null then
    raise exception 'no such customer in this business'
      using errcode = 'GD011';
  end if;

  -- Every item must be this business's own. Counted against the distinct ids asked for, so a
  -- repeated item is fine and a foreign or missing one is not.
  select count(*) into v_matched
    from public.price_book_items b
   where b.organization_id = p_organization_id
     and b.id in (select (e ->> 'price_book_item_id')::uuid from jsonb_array_elements(v_lines) e);
  if v_matched <> (select count(distinct e ->> 'price_book_item_id') from jsonb_array_elements(v_lines) e) then
    raise exception 'a line names a catalog item this business does not have'
      using errcode = 'GD012';
  end if;

  -- One currency, and it is the business's own. An item priced in a currency the business no
  -- longer trades in is not invoiced at a converted amount; it is refused.
  select o.currency into v_currency from public.organizations o where o.id = p_organization_id;
  if v_currency is null
     or exists (
       select 1 from public.price_book_items b
        where b.organization_id = p_organization_id
          and b.id in (select (e ->> 'price_book_item_id')::uuid from jsonb_array_elements(v_lines) e)
          and b.currency <> v_currency
     ) then
    raise exception 'every line must be priced in this business''s trading currency'
      using errcode = 'GD013';
  end if;

  insert into public.invoices
    (organization_id, source, work_item_id, customer_id, billed_to, number, currency,
     issued_at, due_at, created_by, issuance_key, issuance_fingerprint)
  values
    (p_organization_id, 'direct', null, v_customer.id, left(coalesce(nullif(btrim(v_customer.name), ''), 'Customer'), 200),
     v_number, v_currency, v_issued, p_due_at, v_actor, p_issuance_key, v_fingerprint)
  returning id into v_invoice;

  -- The copy, in the order asked for.
  insert into public.invoice_lines
    (organization_id, invoice_id, description, unit, unit_amount_minor, currency, quantity, position)
  select
    p_organization_id, v_invoice, b.name, b.unit, b.unit_amount_minor, b.currency,
    (e.value ->> 'quantity')::integer, e.ordinality
  from jsonb_array_elements(v_lines) with ordinality as e(value, ordinality)
  join public.price_book_items b
    on b.organization_id = p_organization_id
   and b.id = (e.value ->> 'price_book_item_id')::uuid;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'invoice', v_invoice, 'invoice.issued',
     jsonb_build_object(
       'invoice_id', v_invoice,
       'number', v_number,
       'currency', v_currency,
       'issued_at', v_issued,
       'source', 'direct',
       'customer_id', v_customer.id
     ));

  return v_invoice;
end;
$fn$;

comment on function public.issue_direct_invoice(uuid, uuid, jsonb, timestamptz, timestamptz, uuid) is
  'Issue an invoice to a customer from this business''s own catalog, with no Work item. Prices are copied from price_book_items at issuance; the caller supplies items and quantities only. Retrying with the same issuance key returns the same invoice.';

revoke all on function public.issue_direct_invoice(uuid, uuid, jsonb, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.issue_direct_invoice(uuid, uuid, jsonb, timestamptz, timestamptz, uuid) to authenticated;
