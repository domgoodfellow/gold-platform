-- The price book holds recurring items as well as one-off items (ADR-057, decision 3).
--
-- A recurring item is something a business charges every month or year: a GildOps plan or add-on,
-- or any business's own subscription service. Its prices are a history by currency and billing
-- interval (`price_book_item_prices`, next migration), so the row itself carries no amount and no
-- currency. A one-off item keeps its single amount and currency exactly as before.
--
-- A recurring item is sold through Subscriptions. Quotes, direct invoices, Work priced lines and
-- online booking price one-off items only, so each of their writers refuses a recurring item by
-- name instead of failing later on a missing amount. Clients still insert one-off items under the
-- existing policy; only `create_recurring_price_book_item` creates a recurring one, and no client
-- may change an item's pricing model.

alter table public.price_book_items
  add column pricing_model text not null default 'unit' check (pricing_model in ('unit', 'recurring')),
  add column description   text not null default '' check (length(description) <= 2000),
  add column sale_status   text not null default 'active' check (sale_status in ('active', 'unlisted', 'archived'));

alter table public.price_book_items alter column unit_amount_minor drop not null;
alter table public.price_book_items alter column currency drop not null;
alter table public.price_book_items add constraint price_book_items_pricing_shape check (
  (pricing_model = 'unit' and unit_amount_minor is not null and currency is not null)
  or (pricing_model = 'recurring' and unit_amount_minor is null and currency is null));

comment on column public.price_book_items.pricing_model is
  'unit = one amount per unit, sold on quotes, invoices, Work and booking; recurring = charged every period, priced in price_book_item_prices and sold through Subscriptions (ADR-057).';
comment on column public.price_book_items.sale_status is
  'active = offered; unlisted = kept for existing customers but not offered; archived = retired. Historical records keep their reference either way.';

grant insert (description, sale_status) on public.price_book_items to authenticated;
grant update (description, sale_status) on public.price_book_items to authenticated;

-- A client inserts one-off items only; the default pricing model is the only one it can write.
alter policy price_book_items_insert on public.price_book_items
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'price.manage')
    and pricing_model = 'unit');

-- The one guard every one-off writer calls. It answers nothing about items the caller cannot name
-- in that business: an unknown id passes here and is refused by the writer's own lookup.
create function app.require_one_off_items(p_organization_id uuid, p_item_ids uuid[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.price_book_items i
     where i.organization_id = p_organization_id
       and i.id = any (coalesce(p_item_ids, '{}'))
       and i.pricing_model <> 'unit'
  ) then
    raise exception 'A recurring item is sold through Subscriptions, not on a quote, invoice, Work or booking.'
      using errcode = '22023';
  end if;
end $$;
revoke all on function app.require_one_off_items(uuid, uuid[]) from public, anon;
grant execute on function app.require_one_off_items(uuid, uuid[]) to authenticated;

-- Inserts the guard into an existing function at one exact place, refusing if the place is not
-- found exactly once, so a changed body fails this migration rather than being edited blindly.
create function pg_temp.insert_guard(p_function regprocedure, p_anchor text, p_guard text) returns void
language plpgsql as $$
declare v_def text; v_count int;
begin
  v_def := pg_get_functiondef(p_function);
  v_count := (length(v_def) - length(replace(v_def, p_anchor, ''))) / length(p_anchor);
  if v_count <> 1 then
    raise exception 'anchor found % times in %', v_count, p_function;
  end if;
  execute replace(v_def, p_anchor, p_guard || p_anchor);
end $$;

select pg_temp.insert_guard(
  'public.add_work_item_priced_line(uuid, uuid, integer)'::regprocedure,
  '  if v_item is null then',
  E'  perform app.require_one_off_items(v_org, array[p_price_book_item_id]);\n\n');
select pg_temp.insert_guard(
  'public.build_catalog_proposal(uuid, uuid, jsonb, text)'::regprocedure,
  '  select count(*) into v_matched',
  E'  perform app.require_one_off_items(p_organization_id,\n    array(select (e ->> ''price_book_item_id'')::uuid from jsonb_array_elements(v_lines) e));\n\n');
select pg_temp.insert_guard(
  'public.issue_direct_invoice(uuid, uuid, jsonb, timestamptz, timestamptz, uuid)'::regprocedure,
  '  select count(*) into v_matched',
  E'  perform app.require_one_off_items(p_organization_id,\n    array(select (e ->> ''price_book_item_id'')::uuid from jsonb_array_elements(v_lines) e));\n\n');
select pg_temp.insert_guard(
  'public.update_price_book_item(uuid, text, text, bigint)'::regprocedure,
  '  update public.price_book_items',
  E'  if exists (select 1 from public.price_book_items where id = p_id and pricing_model <> ''unit'') then\n    raise exception ''A recurring item''''s prices are recorded as its price history.'' using errcode = ''22023'';\n  end if;\n\n');

-- Online booking prices a one-off item.
create function app.check_booking_price_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.booking_price_item_id is not null then
    perform app.require_one_off_items(new.organization_id, array[new.booking_price_item_id]);
  end if;
  return new;
end $$;
revoke all on function app.check_booking_price_item() from public, anon, authenticated;
create trigger work_item_types_booking_price_item
  before insert or update of booking_price_item_id on public.work_item_types
  for each row execute function app.check_booking_price_item();

-- Creating a recurring item. Its prices are recorded separately; it starts with none.
create function public.create_recurring_price_book_item(
  p_organization_id uuid, p_name text, p_unit text, p_description text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_id uuid;
begin
  if v_actor is null or not app.has_capability(p_organization_id, 'price.manage') then
    raise exception 'You cannot set what this business charges.' using errcode = '42501';
  end if;
  insert into public.price_book_items (organization_id, name, unit, pricing_model, description, created_by)
  values (p_organization_id, btrim(p_name), btrim(p_unit), 'recurring', coalesce(btrim(p_description), ''), v_actor)
  returning id into v_id;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'price_book_item', v_id, 'price_book_item.created',
          jsonb_build_object('name', btrim(p_name), 'unit', btrim(p_unit), 'pricing_model', 'recurring'));
  return v_id;
end $$;
revoke all on function public.create_recurring_price_book_item(uuid, text, text, text) from public, anon;
grant execute on function public.create_recurring_price_book_item(uuid, text, text, text) to authenticated;
