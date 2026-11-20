-- GildOps' plans and add-ons are recurring items in its own price book (ADR-057, decisions 3 and 9).
--
-- What GildOps sells (name, description, prices, add-ons and the billing provider's price
-- reference) moves under the price book of the operating Organization. What a plan switches on
-- (product, module and feature grants and allowances) stays on `platform_plans`, which now names
-- the item that sells it.
--
-- Records are moved, not copied: the three tables are renamed, so every price id, amount,
-- currency, interval, effective window, provider reference, checkout-session reference and
-- foreign key stays exactly as it was. No amount is recalculated.
--
--   platform_plan_prices          -> price_book_item_prices
--   platform_plan_provider_prices -> price_book_item_provider_prices
--   platform_plan_addons          -> price_book_item_addons
--
-- Ownership follows the operating Organization. `app.sync_plan_catalog_items()` creates a recurring
-- item for each plan that has none (reusing the plan's id when it is free) and moves plan-linked
-- items to the operating Organization if they belong to another. It runs now and whenever the
-- operating Organization is designated. Production designates once and never moves it, so this
-- creates the items once; a database with no operating Organization keeps plan prices unowned
-- until one is designated.
--
-- Transitional, removed when every reader has moved (ADR-057): the `plan_id` columns, the fill
-- triggers that keep `plan_id` and the item columns in step, the views under the old names, and
-- the `platform.commercial` and list-price read branches.

do $$
begin
  create temp table pre_counts on commit drop as
  select (select count(*) from public.platform_plans) as plans,
         (select count(*) from public.platform_plan_prices) as prices,
         (select count(*) from public.platform_plan_provider_prices) as provider_prices,
         (select count(*) from public.platform_plan_addons) as addons,
         (select count(*) from public.platform_billing_checkout_sessions) as checkout_sessions,
         (select coalesce(sum(amount_minor), 0) from public.platform_plan_prices) as amount_total;
end $$;

-- 1. Rename.
alter table public.platform_plan_prices rename to price_book_item_prices;
alter table public.platform_plan_provider_prices rename to price_book_item_provider_prices;
alter table public.platform_plan_addons rename to price_book_item_addons;

-- 2. Ownership columns.
alter table public.price_book_item_prices
  add column organization_id uuid,
  add column item_id uuid,
  alter column plan_id drop not null,
  add constraint price_book_item_prices_owner check (item_id is not null or plan_id is not null),
  add constraint price_book_item_prices_owner_pair check ((organization_id is null) = (item_id is null)),
  add constraint price_book_item_prices_org_id_unique unique (organization_id, id),
  add constraint price_book_item_prices_item_fkey foreign key (organization_id, item_id)
    references public.price_book_items (organization_id, id) on delete restrict deferrable initially immediate;
create unique index price_book_item_prices_item_moment
  on public.price_book_item_prices (item_id, currency, billing_interval, effective_from) where item_id is not null;
create index price_book_item_prices_item on public.price_book_item_prices (organization_id, item_id);
comment on table public.price_book_item_prices is
  'Price history of a recurring price book item, by currency and billing interval (ADR-057). Formerly platform_plan_prices; ids are unchanged. A one_time interval is a charge made once alongside the subscription.';

alter table public.price_book_item_provider_prices
  add column organization_id uuid references public.organizations (id) on delete restrict,
  add constraint price_book_item_provider_prices_price_fkey foreign key (organization_id, plan_price_id)
    references public.price_book_item_prices (organization_id, id) deferrable initially immediate;
comment on table public.price_book_item_provider_prices is
  'The billing provider''s product and price references for a recurring item price (ADR-057). Formerly platform_plan_provider_prices.';

alter table public.price_book_item_addons
  add column id uuid not null default gen_random_uuid(),
  add column organization_id uuid,
  add column item_id uuid,
  add column addon_item_id uuid;
alter table public.price_book_item_addons drop constraint platform_plan_addons_pkey;
alter table public.price_book_item_addons
  add primary key (id),
  alter column plan_id drop not null,
  alter column addon_plan_id drop not null,
  add constraint price_book_item_addons_plan_pair unique (plan_id, addon_plan_id),
  add constraint price_book_item_addons_item_pair unique (item_id, addon_item_id),
  add constraint price_book_item_addons_owner check ((item_id is not null and addon_item_id is not null) or (plan_id is not null and addon_plan_id is not null)),
  add constraint price_book_item_addons_owner_pair check ((organization_id is null) = (item_id is null) and (item_id is null) = (addon_item_id is null)),
  add constraint price_book_item_addons_distinct check (item_id is distinct from addon_item_id or item_id is null),
  add constraint price_book_item_addons_item_fkey foreign key (organization_id, item_id)
    references public.price_book_items (organization_id, id) on delete restrict deferrable initially immediate,
  add constraint price_book_item_addons_addon_fkey foreign key (organization_id, addon_item_id)
    references public.price_book_items (organization_id, id) on delete restrict deferrable initially immediate;
comment on table public.price_book_item_addons is
  'Which add-on items a recurring item can carry (ADR-057). Formerly platform_plan_addons.';

alter table public.platform_plans
  add column price_book_item_id uuid unique references public.price_book_items (id) on delete restrict deferrable initially immediate;
comment on column public.platform_plans.price_book_item_id is
  'The recurring price book item of GildOps'' operating Organization that sells this plan (ADR-057). The plan itself keeps only what it switches on.';

-- A plan is sold only by a recurring item of the operating Organization.
create function app.check_plan_catalog_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.price_book_item_id is not null and not exists (
    select 1 from public.price_book_items i
     where i.id = new.price_book_item_id and i.pricing_model = 'recurring'
       and i.organization_id = app.platform_seller_id()) then
    raise exception 'A plan is sold by a recurring item of GildOps'' own price book.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function app.check_plan_catalog_item() from public, anon, authenticated;
create trigger platform_plans_catalog_item
  before insert or update of price_book_item_id on public.platform_plans
  for each row execute function app.check_plan_catalog_item();

-- 3. Transitional fill: writers that still name a plan fill the item, and writers that name an
--    item linked to a plan fill the plan, so both kinds of reader see every row.
create function app.fill_item_price_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.item_id is null and new.plan_id is not null then
    select i.organization_id, i.id into new.organization_id, new.item_id
      from public.platform_plans p join public.price_book_items i on i.id = p.price_book_item_id
     where p.id = new.plan_id;
  elsif new.plan_id is null and new.item_id is not null then
    select p.id into new.plan_id from public.platform_plans p where p.price_book_item_id = new.item_id;
  end if;
  return new;
end $$;
revoke all on function app.fill_item_price_owner() from public, anon, authenticated;
create trigger price_book_item_prices_fill_owner
  before insert on public.price_book_item_prices
  for each row execute function app.fill_item_price_owner();

create function app.fill_item_addon_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.item_id is null and new.plan_id is not null then
    select i.organization_id, i.id into new.organization_id, new.item_id
      from public.platform_plans p join public.price_book_items i on i.id = p.price_book_item_id
     where p.id = new.plan_id;
    select p.price_book_item_id into new.addon_item_id from public.platform_plans p where p.id = new.addon_plan_id;
    if new.item_id is null or new.addon_item_id is null then
      new.organization_id := null; new.item_id := null; new.addon_item_id := null;
    end if;
  elsif new.plan_id is null and new.item_id is not null then
    select p.id into new.plan_id from public.platform_plans p where p.price_book_item_id = new.item_id;
    select p.id into new.addon_plan_id from public.platform_plans p where p.price_book_item_id = new.addon_item_id;
    if new.plan_id is null or new.addon_plan_id is null then
      new.plan_id := null; new.addon_plan_id := null;
    end if;
  end if;
  return new;
end $$;
revoke all on function app.fill_item_addon_owner() from public, anon, authenticated;
create trigger price_book_item_addons_fill_owner
  before insert on public.price_book_item_addons
  for each row execute function app.fill_item_addon_owner();

create function app.fill_provider_price_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select p.organization_id into new.organization_id from public.price_book_item_prices p where p.id = new.plan_price_id;
  return new;
end $$;
revoke all on function app.fill_provider_price_owner() from public, anon, authenticated;
create trigger price_book_item_provider_prices_fill_owner
  before insert on public.price_book_item_provider_prices
  for each row execute function app.fill_provider_price_owner();

-- 4. Ownership follows the operating Organization.
create function app.sync_plan_catalog_items()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller uuid := app.operating_organization_id();
  v_actor uuid;
  v_plan record;
  v_item uuid;
  v_name text;
  v_changed integer := 0;
begin
  if v_seller is null then
    return 0;
  end if;
  set constraints all deferred;

  select m.user_id into v_actor
    from public.memberships m join public.roles r on r.id = m.role_id
   where m.organization_id = v_seller and 'role.manage' = any (r.capabilities)
   order by m.created_at, m.user_id limit 1;

  -- Items that belong to another organization move to the seller with their prices and add-on links.
  for v_plan in
    select p.id as plan_id, p.key, i.id as item_id, i.name
      from public.platform_plans p join public.price_book_items i on i.id = p.price_book_item_id
     where i.organization_id <> v_seller
     order by p.kind, p.display_order, p.key
  loop
    v_name := v_plan.name;
    if exists (select 1 from public.price_book_items x
                where x.organization_id = v_seller and lower(btrim(x.name)) = lower(btrim(v_name)) and x.id <> v_plan.item_id) then
      v_name := left(v_plan.name || ' (' || v_plan.key || ')', 200);
    end if;
    update public.price_book_items set organization_id = v_seller, name = v_name where id = v_plan.item_id;
    update public.price_book_item_prices set organization_id = v_seller where item_id = v_plan.item_id;
    v_changed := v_changed + 1;
  end loop;
  update public.price_book_item_addons a set organization_id = v_seller
   where a.organization_id is distinct from v_seller and a.item_id is not null;
  update public.price_book_item_provider_prices pp set organization_id = p.organization_id
    from public.price_book_item_prices p
   where p.id = pp.plan_price_id and pp.organization_id is distinct from p.organization_id;

  -- Plans without an item get one.
  for v_plan in
    select p.* from public.platform_plans p
     where p.price_book_item_id is null
     order by p.kind, p.display_order, p.key
  loop
    v_name := btrim(v_plan.label);
    if exists (select 1 from public.price_book_items x
                where x.organization_id = v_seller and lower(btrim(x.name)) = lower(v_name)) then
      v_name := left(v_name || ' (' || v_plan.key || ')', 200);
    end if;
    v_item := case when exists (select 1 from public.price_book_items x where x.id = v_plan.id)
                   then gen_random_uuid() else v_plan.id end;
    insert into public.price_book_items
      (id, organization_id, name, unit, pricing_model, description, sale_status, created_by, created_at)
    values
      (v_item, v_seller, v_name, case when v_plan.kind = 'addon' then 'add-on' else 'subscription' end,
       'recurring', coalesce(v_plan.description, ''), v_plan.sale_status,
       coalesce(v_plan.created_by,
                (select pr.recorded_by from public.price_book_item_prices pr
                  where pr.plan_id = v_plan.id and pr.recorded_by is not null order by pr.captured_at limit 1),
                v_actor),
       v_plan.created_at);
    update public.platform_plans set price_book_item_id = v_item where id = v_plan.id;
    update public.price_book_item_prices set organization_id = v_seller, item_id = v_item where plan_id = v_plan.id;
    v_changed := v_changed + 1;
  end loop;

  update public.price_book_item_addons a
     set organization_id = v_seller, item_id = p.price_book_item_id, addon_item_id = ap.price_book_item_id
    from public.platform_plans p, public.platform_plans ap
   where p.id = a.plan_id and ap.id = a.addon_plan_id and a.item_id is null
     and p.price_book_item_id is not null and ap.price_book_item_id is not null;
  update public.price_book_item_provider_prices pp set organization_id = p.organization_id
    from public.price_book_item_prices p
   where p.id = pp.plan_price_id and pp.organization_id is distinct from p.organization_id;

  set constraints all immediate;
  return v_changed;
end $$;
revoke all on function app.sync_plan_catalog_items() from public, anon, authenticated;
comment on function app.sync_plan_catalog_items() is
  'Gives every platform plan a recurring item in the operating Organization''s price book and keeps plan-linked items there (ADR-057). Idempotent; returns items created or moved. No client grant.';

create function app.sync_plan_catalog_items_on_designation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.sync_plan_catalog_items();
  return null;
end $$;
revoke all on function app.sync_plan_catalog_items_on_designation() from public, anon, authenticated;
create trigger platform_settings_sync_plan_catalog_items
  after update of operating_organization_id on public.platform_settings
  for each row when (new.operating_organization_id is not null and new.operating_organization_id is distinct from old.operating_organization_id)
  execute function app.sync_plan_catalog_items_on_designation();

-- A plan created later is sold by an item from the start.
create function app.plan_catalog_item_on_create()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.sync_plan_catalog_items();
  return null;
end $$;
revoke all on function app.plan_catalog_item_on_create() from public, anon, authenticated;
create trigger platform_plans_catalog_item_on_create
  after insert on public.platform_plans
  for each statement execute function app.plan_catalog_item_on_create();

select app.sync_plan_catalog_items();

-- 5. Every function that read the old names reads the new ones. Each still uses `plan_id`, which
--    the fill triggers keep in step.
do $$
declare v_fn record; v_def text;
begin
  for v_fn in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'app') and p.prosrc ~ 'platform_plan_(prices|provider_prices|addons)'
  loop
    v_def := pg_get_functiondef(v_fn.oid);
    v_def := regexp_replace(v_def, 'public\.platform_plan_provider_prices\M', 'public.price_book_item_provider_prices', 'g');
    v_def := regexp_replace(v_def, 'public\.platform_plan_prices\M', 'public.price_book_item_prices', 'g');
    v_def := regexp_replace(v_def, 'public\.platform_plan_addons\M', 'public.price_book_item_addons', 'g');
    execute v_def;
  end loop;
end $$;

-- 6. Reads. Each owner's members read its rows. Until every reader has moved: a business member
--    still reads a plan's list prices and add-ons (as before), and `platform.commercial` staff read
--    as before.
drop policy platform_plan_prices_select on public.price_book_item_prices;
create policy price_book_item_prices_select on public.price_book_item_prices for select to authenticated using (
  organization_id in (select app.current_tenant_ids())
  or (plan_id is not null and (select app.is_organization_member()))
  or (select app.has_platform_capability('platform.commercial')));
drop policy platform_plan_provider_prices_select on public.price_book_item_provider_prices;
create policy price_book_item_provider_prices_select on public.price_book_item_provider_prices for select to authenticated using (
  organization_id in (select app.current_tenant_ids())
  or (select app.has_platform_capability('platform.commercial')));
drop policy platform_plan_addons_select on public.price_book_item_addons;
create policy price_book_item_addons_select on public.price_book_item_addons for select to authenticated using (
  organization_id in (select app.current_tenant_ids())
  or (plan_id is not null and (select app.is_organization_member()))
  or (select app.has_platform_capability('platform.commercial')));

-- 7. The old names, for readers that have not moved yet.
create view public.platform_plan_prices with (security_invoker = true) as
  select id, plan_id, currency, amount_minor, billing_interval, effective_from, approval_state, source,
         source_url, captured_at, recorded_by, note, effective_to
    from public.price_book_item_prices where plan_id is not null;
create view public.platform_plan_provider_prices with (security_invoker = true) as
  select id, plan_price_id, environment, provider, product_reference, price_reference, provisioned_at, provisioned_by
    from public.price_book_item_provider_prices;
create view public.platform_plan_addons with (security_invoker = true) as
  select plan_id, addon_plan_id, included_by_default, created_at, created_by
    from public.price_book_item_addons where plan_id is not null and addon_plan_id is not null;
revoke all on public.platform_plan_prices, public.platform_plan_provider_prices, public.platform_plan_addons from public, anon;
grant select on public.platform_plan_prices, public.platform_plan_provider_prices, public.platform_plan_addons to authenticated;

-- 8. Verification.
do $$
declare v_pre record; v_seller uuid := app.operating_organization_id(); v_bad int;
begin
  select * into v_pre from pre_counts;
  if (select count(*) from public.platform_plans) <> v_pre.plans
     or (select count(*) from public.price_book_item_prices) <> v_pre.prices
     or (select count(*) from public.price_book_item_provider_prices) <> v_pre.provider_prices
     or (select count(*) from public.price_book_item_addons) <> v_pre.addons
     or (select count(*) from public.platform_billing_checkout_sessions) <> v_pre.checkout_sessions
     or (select coalesce(sum(amount_minor), 0) from public.price_book_item_prices) <> v_pre.amount_total then
    raise exception 'record counts or amounts changed while moving plans into the price book';
  end if;

  if v_seller is not null then
    select count(*) into v_bad from public.platform_plans p
      left join public.price_book_items i on i.id = p.price_book_item_id
     where i.id is null or i.organization_id <> v_seller or i.pricing_model <> 'recurring';
    if v_bad > 0 then raise exception '% plans are not sold by a recurring item of the operating organization', v_bad; end if;

    select count(*) into v_bad from public.price_book_item_prices pr
      join public.platform_plans p on p.id = pr.plan_id
     where pr.item_id is distinct from p.price_book_item_id or pr.organization_id is distinct from v_seller;
    if v_bad > 0 then raise exception '% plan prices do not name their plan''s item', v_bad; end if;

    select count(*) into v_bad from public.price_book_item_addons where item_id is null;
    if v_bad > 0 then raise exception '% add-on links do not name items', v_bad; end if;

    select count(*) into v_bad from public.price_book_item_provider_prices where organization_id is null;
    if v_bad > 0 then raise exception '% provider prices have no owner', v_bad; end if;

    if app.sync_plan_catalog_items() <> 0 then raise exception 'syncing plan catalog items is not idempotent'; end if;
  end if;

  select count(*) into v_bad from public.platform_billing_checkout_sessions s
   where s.plan_price_id is not null and not exists (select 1 from public.price_book_item_prices p where p.id = s.plan_price_id);
  if v_bad > 0 then raise exception '% checkout sessions lost their price', v_bad; end if;

  select count(*) into v_bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app') and p.prosrc ~ 'public\.platform_plan_(prices|provider_prices|addons)\M';
  if v_bad > 0 then raise exception '% functions still read the old table names', v_bad; end if;
end $$;
