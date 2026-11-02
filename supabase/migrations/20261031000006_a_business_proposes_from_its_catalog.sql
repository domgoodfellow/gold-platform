-- A business builds a commercial proposal from its own catalog (ADR-051, second slice).
--
-- The writer half. `20261031000005` gave proposals a `basis` and a lines table and kept catalog
-- proposals out of the technical hand-off; this is applied only after every running application
-- instance reads `basis`, because an older one would render a catalog proposal as a plan with no
-- name and no lines (docs/deployment.md).
--
-- The caller names a customer, catalog items, whole quantities and notes, and nothing that is
-- money. Each line's name, unit, price and currency are copied from the seller's own
-- `price_book_items` now, the total is the sum of those copies, and the whole version -- row,
-- lines, event -- is one transaction. Accepting it later records agreement to exactly this copy;
-- nothing here, and nothing in acceptance, issues an invoice or grants an entitlement.
--
-- It also ends direct client writes to proposals. Until now a member holding `price.manage`
-- inserted the proposal row themselves, so the browser's server action, not the database,
-- decided the price; with this function in place there is no remaining reason for an insert grant.
create function public.build_catalog_proposal(
  p_organization_id uuid,
  p_customer_id     uuid,
  p_lines           jsonb,
  p_notes           text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor    uuid := (select auth.uid());
  v_currency text;
  v_customer public.contacts;
  v_lines    jsonb;
  v_line     jsonb;
  v_count    integer;
  v_matched  integer;
  v_valid    boolean;
  v_previous public.customer_commercial_proposals;
  v_version  integer;
  v_total    bigint;
  v_proposal uuid;
  v_notes    text := btrim(coalesce(p_notes, ''));
begin
  if v_actor is null then
    raise exception 'build_catalog_proposal requires an authenticated caller'
      using errcode = '42501';
  end if;
  -- The same authority that already decided who may build a proposal (`price.manage`), now
  -- checked here rather than by the insert policy this migration retires. The catalog is the
  -- Finance catalog, so the business's Billing module must be usable.
  if p_organization_id is null
     or p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'price.manage') then
    raise exception 'you may not build proposals for this business'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.usable_modules(p_organization_id) m where m = 'billing') then
    raise exception 'the catalog is not available for this business'
      using errcode = '42501';
  end if;
  if length(v_notes) > 4000 then
    raise exception 'notes are at most 4,000 characters' using errcode = '22023';
  end if;

  -- The request's shape, refused whole rather than partly honoured -- the rule
  -- `issue_direct_invoice` follows, for the same reason: any key beyond an item and a quantity
  -- is a request to set something the catalog decides.
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'lines must be a list' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_lines);
  if v_count < 1 or v_count > 100 then
    raise exception 'a proposal has between 1 and 100 lines' using errcode = '22023';
  end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_valid := jsonb_typeof(v_line) = 'object';
    if v_valid then
      v_valid := not exists (select 1 from jsonb_object_keys(v_line) k where k not in ('price_book_item_id', 'quantity'));
    end if;
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

  select jsonb_agg(jsonb_build_object('price_book_item_id', lower(e.value ->> 'price_book_item_id'), 'quantity', (e.value ->> 'quantity')::integer) order by e.ordinality)
    into v_lines
    from jsonb_array_elements(p_lines) with ordinality as e(value, ordinality);

  select * into v_customer
    from public.contacts c
   where c.organization_id = p_organization_id
     and c.id = p_customer_id;
  if v_customer.id is null then
    raise exception 'no such customer in this business'
      using errcode = 'GD011';
  end if;

  select count(*) into v_matched
    from public.price_book_items b
   where b.organization_id = p_organization_id
     and b.id in (select (e ->> 'price_book_item_id')::uuid from jsonb_array_elements(v_lines) e);
  if v_matched <> (select count(distinct e ->> 'price_book_item_id') from jsonb_array_elements(v_lines) e) then
    raise exception 'a line names a catalog item this business does not have'
      using errcode = 'GD012';
  end if;

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

  -- Serializes this customer's proposals from here to commit, so two at once take consecutive
  -- versions instead of one failing on the version's unique key.
  perform pg_advisory_xact_lock(hashtext('commercial_proposal:' || p_organization_id::text || ':' || p_customer_id::text));

  select * into v_previous
    from public.customer_commercial_proposals p
   where p.organization_id = p_organization_id
     and p.customer_id = p_customer_id
   order by p.version desc
   limit 1;
  v_version := coalesce(v_previous.version, 0) + 1;

  select coalesce(sum((e.value ->> 'quantity')::bigint * b.unit_amount_minor), 0) into v_total
    from jsonb_array_elements(v_lines) e
    join public.price_book_items b
      on b.organization_id = p_organization_id
     and b.id = (e.value ->> 'price_book_item_id')::uuid;
  if v_total > 100000000000000 then
    raise exception 'that proposal''s total is beyond what one proposal can hold'
      using errcode = '22023';
  end if;

  insert into public.customer_commercial_proposals
    (organization_id, customer_id, basis, plan_id, plan_label, currency, billing_interval,
     plan_price_minor, addon_price_minor, discount_minor, discount_reason, catalog_total_minor,
     notes, status, version, supersedes_id, created_by)
  values
    (p_organization_id, v_customer.id, 'catalog', null, null, v_currency, 'one_time',
     0, 0, 0, null, v_total,
     v_notes, 'draft', v_version, v_previous.id, v_actor)
  returning id into v_proposal;

  insert into public.customer_commercial_proposal_lines
    (organization_id, proposal_id, position, price_book_item_id, name, unit, currency,
     quantity, unit_amount_minor, amount_minor)
  select
    p_organization_id, v_proposal, e.ordinality, b.id, b.name, b.unit, b.currency,
    (e.value ->> 'quantity')::integer, b.unit_amount_minor,
    (e.value ->> 'quantity')::bigint * b.unit_amount_minor
  from jsonb_array_elements(v_lines) with ordinality as e(value, ordinality)
  join public.price_book_items b
    on b.organization_id = p_organization_id
   and b.id = (e.value ->> 'price_book_item_id')::uuid;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'customer', v_customer.id, 'commercial_proposal.built',
     jsonb_build_object('proposal_id', v_proposal, 'version', v_version, 'basis', 'catalog',
                        'currency', v_currency, 'total_minor', v_total));

  return v_proposal;
end;
$fn$;

comment on function public.build_catalog_proposal(uuid, uuid, jsonb, text) is
  'Build a new draft commercial proposal version for a customer from this business''s own catalog. Prices are copied from price_book_items now; the caller supplies items, quantities and notes only. Issues no invoice and grants nothing.';

revoke all on function public.build_catalog_proposal(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.build_catalog_proposal(uuid, uuid, jsonb, text) to authenticated;

-- No client writes a price any more. Marking a draft sent (the status-only update grant) stays.
drop policy customer_commercial_proposals_insert on public.customer_commercial_proposals;
drop policy customer_commercial_proposal_addons_insert on public.customer_commercial_proposal_addons;
revoke insert, update, delete on public.customer_commercial_proposals from anon, authenticated;
revoke insert, update, delete on public.customer_commercial_proposal_addons from anon, authenticated;
grant update (status) on public.customer_commercial_proposals to authenticated;
