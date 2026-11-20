-- Finance sells recurring items; Product Registry keeps what a plan switches on (ADR-057).
--
-- 1. Finance doors, each checked in the seller's own organization with its own permissions and
--    never with platform authority:
--      record_item_price            a price in a recurring item's history (price.manage);
--      set_item_addon               which add-on items a recurring item can carry (price.manage);
--      record_item_provider_price   the billing provider's references for an item price
--                                   (price.manage, GildOps' operating organization only: only its
--                                   processing relationship exists);
--      record_item_usage_price      the price of usage beyond a plan item's allowance
--                                   (price.manage, operating organization, plan-linked items).
--    Name, unit, description and sale status are edited on the row under the existing update
--    policy (`price.manage`).
--
-- 2. A plan's presentation follows its item. Its label, description and sale status are copies of
--    the selling item's, kept by trigger, so every reader of a plan (Plan & usage, the public
--    catalogue, entitlement screens) shows what GildOps' Finance named it.
--
-- 3. Product Registry edits what a plan switches on under `platform.catalogue`: creating a plan
--    (its item appears in GildOps' Finance at once), grants, feature overrides, allowances, and
--    whether it is billable and where it sits in the registry.
--
-- 4. Reads. A plan's selling item, its list prices and add-on links are readable by any signed-in
--    business member, as the public catalogue already publishes them; this replaces the
--    transitional reading of the old rows. Billing-provider references are the seller's alone.
--    `price_book_item_switches` tells the seller what one of its items switches on.

-- 1. Finance doors.
create function app.require_recurring_item(p_organization_id uuid, p_item_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.price_book_items
                  where organization_id = p_organization_id and id = p_item_id and pricing_model = 'recurring') then
    raise exception 'No such recurring item in this business.' using errcode = '23503';
  end if;
end $$;
revoke all on function app.require_recurring_item(uuid, uuid) from public, anon, authenticated;

create function app.require_price_manager(p_organization_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not app.has_capability(p_organization_id, 'price.manage') then
    raise exception 'You cannot set what this business charges.' using errcode = '42501';
  end if;
  return v_actor;
end $$;
revoke all on function app.require_price_manager(uuid) from public, anon, authenticated;

create function public.record_item_price(
  p_organization_id uuid, p_item_id uuid, p_currency text, p_amount_minor bigint, p_billing_interval text,
  p_effective_from timestamptz default now(), p_note text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid := app.require_price_manager(p_organization_id); v_id uuid;
begin
  perform app.require_recurring_item(p_organization_id, p_item_id);
  insert into public.price_book_item_prices
    (organization_id, item_id, currency, amount_minor, billing_interval, effective_from, source, recorded_by, note)
  values
    (p_organization_id, p_item_id, upper(btrim(p_currency)), p_amount_minor, p_billing_interval,
     coalesce(p_effective_from, now()), 'finance', v_actor, coalesce(p_note, ''))
  returning id into v_id;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'price_book_item', p_item_id, 'price_book_item.price_recorded',
          jsonb_build_object('priceId', v_id, 'currency', upper(btrim(p_currency)), 'amountMinor', p_amount_minor,
                             'billingInterval', p_billing_interval, 'effectiveFrom', coalesce(p_effective_from, now())));
  return v_id;
end $$;
revoke all on function public.record_item_price(uuid, uuid, text, bigint, text, timestamptz, text) from public, anon;
grant execute on function public.record_item_price(uuid, uuid, text, bigint, text, timestamptz, text) to authenticated;

create function public.set_item_addon(
  p_organization_id uuid, p_item_id uuid, p_addon_item_id uuid, p_attached boolean, p_included_by_default boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid := app.require_price_manager(p_organization_id); v_base_kind text; v_addon_kind text;
begin
  perform app.require_recurring_item(p_organization_id, p_item_id);
  perform app.require_recurring_item(p_organization_id, p_addon_item_id);
  if p_item_id = p_addon_item_id then
    raise exception 'An item cannot be its own add-on.' using errcode = '22023';
  end if;
  -- Plan-linked items keep the platform's rule: a plan carries add-ons, an add-on carries nothing.
  select kind into v_base_kind from public.platform_plans where price_book_item_id = p_item_id;
  select kind into v_addon_kind from public.platform_plans where price_book_item_id = p_addon_item_id;
  if (v_base_kind is not null or v_addon_kind is not null)
     and (v_base_kind is distinct from 'plan' or v_addon_kind is distinct from 'addon') then
    raise exception 'A plan carries add-ons; an add-on carries none.' using errcode = '22023';
  end if;
  if p_attached then
    insert into public.price_book_item_addons (organization_id, item_id, addon_item_id, included_by_default, created_by)
    values (p_organization_id, p_item_id, p_addon_item_id, coalesce(p_included_by_default, false), v_actor)
    on conflict (item_id, addon_item_id) do update set included_by_default = excluded.included_by_default;
  else
    delete from public.price_book_item_addons
     where organization_id = p_organization_id and item_id = p_item_id and addon_item_id = p_addon_item_id;
  end if;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'price_book_item', p_item_id,
          case when p_attached then 'price_book_item.addon_attached' else 'price_book_item.addon_detached' end,
          jsonb_build_object('addonItemId', p_addon_item_id));
end $$;
revoke all on function public.set_item_addon(uuid, uuid, uuid, boolean, boolean) from public, anon;
grant execute on function public.set_item_addon(uuid, uuid, uuid, boolean, boolean) to authenticated;

create function public.record_item_provider_price(
  p_organization_id uuid, p_item_price_id uuid, p_environment text, p_product_reference text, p_price_reference text,
  p_provider text default 'stripe')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid := app.require_price_manager(p_organization_id); v_id uuid;
begin
  if p_organization_id is distinct from app.platform_seller_id() then
    raise exception 'Only GildOps'' own prices are provisioned with its billing provider.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.price_book_item_prices where organization_id = p_organization_id and id = p_item_price_id) then
    raise exception 'No such price in this business.' using errcode = '23503';
  end if;
  insert into public.price_book_item_provider_prices
    (organization_id, plan_price_id, environment, provider, product_reference, price_reference, provisioned_by)
  values (p_organization_id, p_item_price_id, p_environment, p_provider, p_product_reference, p_price_reference, v_actor)
  on conflict (plan_price_id, environment) do update
    set product_reference = excluded.product_reference, price_reference = excluded.price_reference, provider = excluded.provider
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_item_provider_price(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.record_item_provider_price(uuid, uuid, text, text, text, text) to authenticated;

create function public.record_item_usage_price(
  p_organization_id uuid, p_item_id uuid, p_meter_id text, p_currency text, p_unit_amount_micros bigint,
  p_effective_from timestamptz default now(), p_note text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid := app.require_price_manager(p_organization_id); v_plan uuid; v_id uuid;
begin
  if p_organization_id is distinct from app.platform_seller_id() then
    raise exception 'Usage prices belong to GildOps'' plans.' using errcode = '42501';
  end if;
  perform app.require_recurring_item(p_organization_id, p_item_id);
  select id into v_plan from public.platform_plans where price_book_item_id = p_item_id;
  if v_plan is null then
    raise exception 'This item sells no plan, so it has no metered usage.' using errcode = '22023';
  end if;
  insert into public.platform_retail_rates
    (meter_id, currency, unit_amount_micros, effective_from, approval_state, source, recorded_by, note, plan_id)
  values (p_meter_id, upper(btrim(p_currency)), p_unit_amount_micros, coalesce(p_effective_from, now()), 'approved',
          'finance', v_actor, coalesce(p_note, ''), v_plan)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_item_usage_price(uuid, uuid, text, text, bigint, timestamptz, text) from public, anon;
grant execute on function public.record_item_usage_price(uuid, uuid, text, text, bigint, timestamptz, text) to authenticated;

-- 2. A plan's presentation follows its item.
create function app.mirror_item_to_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.platform_plans
     set label = left(btrim(new.name), 120), description = new.description, sale_status = new.sale_status
   where price_book_item_id = new.id
     and (label, description, sale_status) is distinct from (left(btrim(new.name), 120), new.description, new.sale_status);
  return null;
end $$;
revoke all on function app.mirror_item_to_plan() from public, anon, authenticated;
create trigger price_book_items_mirror_to_plan
  after update of name, description, sale_status on public.price_book_items
  for each row execute function app.mirror_item_to_plan();

-- 3. Product Registry: what a plan switches on.
do $$
declare v_fn regprocedure; v_def text;
begin
  foreach v_fn in array array[
    'public.create_plan(text, text, text, text, boolean, text, integer)'::regprocedure,
    'public.grant_plan_product(uuid, text)'::regprocedure,
    'public.revoke_plan_product(uuid, text)'::regprocedure,
    'public.grant_plan_module(uuid, uuid)'::regprocedure,
    'public.revoke_plan_module(uuid, uuid)'::regprocedure,
    'public.set_plan_feature_override(uuid, uuid, boolean)'::regprocedure,
    'public.clear_plan_feature_override(uuid, uuid)'::regprocedure,
    'public.set_plan_quota(uuid, text, text, text, numeric, text, numeric, text, text, text, integer)'::regprocedure,
    'public.set_plan_allowance(uuid, text, text, text, numeric, text, numeric, text, text, text, text, text, integer)'::regprocedure,
    'public.remove_plan_quota(uuid, text)'::regprocedure]
  loop
    v_def := pg_get_functiondef(v_fn);
    if position('''platform.commercial''' in v_def) = 0 then
      raise exception '% does not name platform.commercial', v_fn;
    end if;
    execute replace(v_def, '''platform.commercial''', '''platform.catalogue''');
  end loop;
end $$;

create function public.update_plan_switches(p_plan_id uuid, p_billable boolean, p_display_order integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_platform_capability('platform.catalogue');
  update public.platform_plans set billable = p_billable, display_order = p_display_order where id = p_plan_id;
  if not found then
    raise exception 'No such plan.' using errcode = '23503';
  end if;
end $$;
revoke all on function public.update_plan_switches(uuid, boolean, integer) from public, anon;
grant execute on function public.update_plan_switches(uuid, boolean, integer) to authenticated;

-- 4. Reads.
create policy price_book_items_select_plan_list on public.price_book_items for select to authenticated using (
  pricing_model = 'recurring'
  and exists (select 1 from public.platform_plans p where p.price_book_item_id = price_book_items.id)
  and (select app.is_organization_member()));

drop policy price_book_item_provider_prices_select on public.price_book_item_provider_prices;
create policy price_book_item_provider_prices_select on public.price_book_item_provider_prices for select to authenticated using (
  organization_id in (select app.current_tenant_ids()));

create function public.price_book_item_switches(p_organization_id uuid, p_item_id uuid)
returns table (kind text, label text, detail text, display_order integer)
language sql
stable
security definer
set search_path = ''
as $$
  with plan as (
    select p.* from public.platform_plans p
      join public.price_book_items i on i.id = p.price_book_item_id
     where i.organization_id = p_organization_id and i.id = p_item_id
       and p_organization_id in (select app.current_tenant_ids())
  )
  select 'product', cp.label, '', cp.display_order
    from plan join public.platform_plan_product_grants g on g.plan_id = plan.id
    join public.platform_catalog_products cp on cp.id = g.product_id
  union all
  select 'module', cm.label, cp.label, 1000 + cm.display_order
    from plan join public.platform_plan_module_grants g on g.plan_id = plan.id
    join public.platform_catalog_modules cm on cm.id = g.module_id
    join public.platform_catalog_products cp on cp.id = cm.product_id
  union all
  select case when g.included then 'feature' else 'excluded_feature' end, cf.label, '', 2000 + cf.display_order
    from plan join public.platform_plan_feature_grants g on g.plan_id = plan.id
    join public.platform_catalog_features cf on cf.id = g.feature_id
  union all
  select 'allowance', q.label,
         trim(to_char(q.included_quantity, 'FM999G999G999G990D99') || ' ' || q.unit
              || case when q.period <> 'none' then ' / ' || q.period else '' end),
         3000 + q.display_order
    from plan join public.platform_plan_quotas q on q.plan_id = plan.id
  order by 4, 2
$$;
revoke all on function public.price_book_item_switches(uuid, uuid) from public, anon;
grant execute on function public.price_book_item_switches(uuid, uuid) to authenticated;
comment on function public.price_book_item_switches(uuid, uuid) is
  'What a recurring item of the caller''s business switches on, when it sells a platform plan: granted products, modules, feature overrides and allowances (ADR-057). Empty for any other item or caller.';

-- 5. Recurring items ship with this migration's Finance pages.
update public.platform_catalog_features set implementation_state = 'available'
 where key = 'recurring_items'
   and module_id = (select m.id from public.platform_catalog_modules m
                      join public.platform_catalog_products p on p.id = m.product_id
                     where p.key = 'finance' and m.key = 'subscriptions');
