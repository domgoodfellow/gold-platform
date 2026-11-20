-- GildOps' commercial administration moves into its operating Organization's Finance (ADR-057).
-- This first step adds what the later steps authorize against and gate on. It changes no record a
-- business can see.
--
-- 1. Three Finance permissions:
--    `subscription.manage` starts and changes customers' subscriptions;
--    `cost.read` sees supplier costs, cost to serve and margins;
--    `cost.manage` records supplier costs and economics assumptions.
--    They are new authority, so only unrestricted administrators (roles holding every existing
--    permission) receive them; every other role is granted them by someone who holds them.
--
-- 2. Who sells GildOps. The configured operating Organization is the seller of every GildOps plan,
--    price, subscription and cost. Platform records keyed by the buying business take it as their
--    seller through these helpers rather than a copied column, so a database with no operating
--    Organization configured fails closed. Platform staff status appears in none of them: only
--    membership of the operating Organization and its own permissions answer.
--
-- 3. Catalogue features that offer the new Finance destinations. Recurring items and Subscriptions
--    belong to Gild Finance, so every plan that includes Finance reaches them. Supplier costs, cost
--    to serve and package economics belong to a new, unlisted Product kind, `operator`: they only
--    mean something to a business that resells metered platform services, and only GildOps' own
--    plan includes them. Every feature starts `planned`; each becomes `available` in the migration
--    that ships its pages.

-- 1. The permissions.
create function pg_temp.add_capabilities(p_add text[], p_to_unrestricted text[]) returns void
language plpgsql as $$
declare v_constraint text; v_before text[]; v_after text[];
begin
  select pg_get_constraintdef(oid) into v_constraint from pg_constraint
    where conrelid = 'public.roles'::regclass and conname = 'roles_capabilities_known';
  select array_agg(distinct m[1]) into v_before from regexp_matches(v_constraint, '''([^'']+)''::text', 'g') m;
  v_after := v_before || array(select c from unnest(p_add) c where not c = any(v_before));
  alter table public.roles drop constraint roles_capabilities_known;
  execute format('alter table public.roles add constraint roles_capabilities_known check (capabilities <@ array[%s]::text[])',
    (select string_agg(quote_literal(c), ',' order by c) from unnest(v_after) c));
  -- Only adds permissions, so it cannot leave a business without someone who manages roles. The
  -- guard is set aside for this one statement; a failure undoes the suspension with everything else.
  alter table public.roles disable trigger roles_capabilities_update_guard;
  update public.roles set capabilities = capabilities || array(select c from unnest(p_to_unrestricted) c where not c = any(capabilities))
    where capabilities @> v_before and not capabilities @> p_to_unrestricted;
  alter table public.roles enable trigger roles_capabilities_update_guard;
  if (select tgenabled from pg_trigger where tgrelid = 'public.roles'::regclass and tgname = 'roles_capabilities_update_guard') <> 'O' then
    raise exception 'roles_capabilities_update_guard was not restored';
  end if;
end $$;
select pg_temp.add_capabilities(
  array['subscription.manage', 'cost.read', 'cost.manage'],
  array['subscription.manage', 'cost.read', 'cost.manage']);
drop function pg_temp.add_capabilities(text[], text[]);

-- 2. The seller of GildOps.
create function app.platform_seller_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select app.operating_organization_id()
$$;
comment on function app.platform_seller_id() is
  'The Organization that sells GildOps: the configured operating Organization (ADR-057). Null when none is configured, so every predicate built on it refuses.';

create function app.platform_seller_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.platform_seller_id() is not null
     and app.platform_seller_id() in (select app.current_tenant_ids())
$$;
comment on function app.platform_seller_member() is
  'Whether the caller is a member of GildOps'' operating Organization. Platform staff status is not an input.';

create function app.platform_seller_has(p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.platform_seller_id() is not null
     and app.has_capability(app.platform_seller_id(), p_capability)
$$;
comment on function app.platform_seller_has(text) is
  'Whether the caller holds a permission in GildOps'' operating Organization. Platform staff status is not an input.';

revoke all on function app.platform_seller_id() from public, anon;
revoke all on function app.platform_seller_member() from public, anon;
revoke all on function app.platform_seller_has(text) from public, anon;
grant execute on function app.platform_seller_id() to authenticated;
grant execute on function app.platform_seller_member() to authenticated;
grant execute on function app.platform_seller_has(text) to authenticated;

-- 3. The catalogue.
alter table public.platform_catalog_products drop constraint platform_catalog_products_key_check;
alter table public.platform_catalog_products add constraint platform_catalog_products_key_check
  check (key in ('sales', 'service', 'comms', 'finance', 'agents', 'automations', 'field', 'studio', 'workspace', 'operator'));
alter table public.platform_catalog_products drop constraint platform_catalog_products_kind_check;
alter table public.platform_catalog_products add constraint platform_catalog_products_kind_check
  check (kind in ('product', 'workspace', 'operator'));
alter table public.platform_catalog_products add constraint platform_catalog_products_operator_kind
  check ((key = 'operator') = (kind = 'operator'));
comment on column public.platform_catalog_products.kind is
  'product = one of the eight customer-facing Gild Products; workspace = the shared capability under all of them (reporting, dashboards, activity), which a Plan may grant but a customer does not buy as a Product; operator = what a business reselling metered platform services needs (supplier costs and economics), granted only to GildOps'' own plan and never sold.';

insert into public.platform_catalog_products (key, kind, label, description, lifecycle, sale_status, display_order)
values ('operator', 'operator', 'GildOps operations',
        'Supplier costs, cost to serve and package economics for the business that sells GildOps.',
        'stable', 'unlisted', 99)
on conflict (key) do nothing;

insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
select p.id, 'cost_economics', 'Costs & economics', '', 1
  from public.platform_catalog_products p where p.key = 'operator'
on conflict (product_id, key) do nothing;

insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
select p.id, 'subscriptions', 'Subscriptions', '', 6
  from public.platform_catalog_products p where p.key = 'finance'
on conflict (product_id, key) do nothing;

insert into public.platform_catalog_features
  (module_id, key, label, description, implementation_state, packaging_default, sale_status, display_order)
select m.id, f.key, f.label, f.description, 'planned', f.packaging, f.sale_status, f.display_order
  from (values
    ('finance',  'subscriptions',  'recurring_items',   'Recurring items',   'Catalog items charged every month or year, with a price history per currency.', 'included', 'active', 1),
    ('finance',  'subscriptions',  'subscriptions',     'Subscriptions',     'Which customers subscribe to which recurring items, at what agreed price.', 'included', 'active', 2),
    ('operator', 'cost_economics', 'supplier_costs',    'Supplier costs',    'What suppliers charge per unit of usage, with history.', 'core', 'unlisted', 1),
    ('operator', 'cost_economics', 'cost_to_serve',     'Cost to serve',     'Revenue, supplier cost and contribution per customer and across the portfolio.', 'core', 'unlisted', 2),
    ('operator', 'cost_economics', 'package_economics', 'Package economics', 'Expected margin of a package from its prices, allowances and supplier costs.', 'core', 'unlisted', 3)
  ) as f(product_key, module_key, key, label, description, packaging, sale_status, display_order)
  join public.platform_catalog_products p on p.key = f.product_key
  join public.platform_catalog_modules m on m.product_id = p.id and m.key = f.module_key
on conflict (module_id, key) do nothing;

-- The new features count toward the Billing module, like invoices and the price book.
insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
select f.id, 'module_key', 'billing', 'Finance destination offered under the Billing module (ADR-057).'
  from public.platform_catalog_features f
  join public.platform_catalog_modules m on m.id = f.module_id
 where (m.key, f.key) in (('subscriptions', 'recurring_items'), ('subscriptions', 'subscriptions'),
                          ('cost_economics', 'supplier_costs'), ('cost_economics', 'cost_to_serve'), ('cost_economics', 'package_economics'))
   and not exists (select 1 from public.platform_catalog_runtime_mappings r where r.feature_id = f.id and r.mapping_kind = 'module_key');

-- GildOps' own plan includes the operator Product, as it includes every other Product.
insert into public.platform_plan_product_grants (plan_id, product_id)
select pl.id, p.id
  from public.platform_plans pl
  join public.platform_catalog_products p on p.key = 'operator'
 where pl.key = 'gold_internal'
on conflict do nothing;

-- Verification.
do $$
declare v_missing int; v_extra int; v_leak int; v_previous text[];
begin
  -- Every unrestricted administrator (every permission known before this migration) holds the three.
  select array_agg(distinct m[1]) into v_previous
    from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''::text', 'g') m
   where c.conrelid = 'public.roles'::regclass and c.conname = 'roles_capabilities_known'
     and m[1] not in ('subscription.manage', 'cost.read', 'cost.manage');
  select count(*) into v_missing from public.roles
   where capabilities @> v_previous
     and not capabilities @> array['subscription.manage', 'cost.read', 'cost.manage'];
  if v_missing > 0 then raise exception 'unrestricted roles without the Finance permissions: %', v_missing; end if;

  -- Only gold_internal grants the operator Product.
  select count(*) into v_leak
    from public.platform_plan_product_grants g
    join public.platform_catalog_products p on p.id = g.product_id and p.key = 'operator'
    join public.platform_plans pl on pl.id = g.plan_id
   where pl.key <> 'gold_internal';
  if v_leak > 0 then raise exception 'a plan other than gold_internal grants the operator Product'; end if;

  select count(*) into v_extra from public.platform_catalog_features
   where key in ('recurring_items', 'subscriptions', 'supplier_costs', 'cost_to_serve', 'package_economics');
  if v_extra <> 5 then raise exception 'expected 5 new catalogue features, found %', v_extra; end if;
end $$;
