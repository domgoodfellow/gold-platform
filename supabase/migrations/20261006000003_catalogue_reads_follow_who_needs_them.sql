-- Twenty platform tables were readable by every `authenticated` caller with `using (true)`, and a
-- booking visitor is `authenticated` (D22). Each one is now in exactly one of three classes.
--
--   Vocabulary        what the product is made of; safe for any signed-in caller. Unchanged:
--                     platform_meters, platform_products, platform_catalog_products,
--                     platform_catalog_modules, platform_catalog_features,
--                     platform_catalog_feature_dependencies, platform_catalog_runtime_mappings
--                     (bar the provider rows, below).
--   Commercial        what a business is offered and charged; a member of some business, or staff.
--                     platform_plans, the three plan grant tables, platform_plan_quotas,
--                     platform_plan_prices, platform_retail_rates, communication_rates.
--   Control plane     staff only. Who GOLD uses and how its billing is wired to the processor:
--                     platform_providers, platform_provider_services,
--                     platform_provider_service_features, platform_connector_app_features,
--                     platform_plan_provider_prices, and the provider rows of
--                     platform_catalog_runtime_mappings.
--
-- A business is entitled to know what it is charged and never who GOLD used to serve it
-- (`platform_provider_rates` already withheld the cost; the vendor's name was still readable).

-- ---------------------------------------------------------------------------
-- Dead staff policies
-- ---------------------------------------------------------------------------
-- Each of these tables had `using (true)` beside a staff-only policy. Permissive policies are
-- ORed, so the staff one could never grant anything the other did not. `platform_providers` is
-- not in this list: it becomes staff-only below, which makes its staff policy the live one.
drop policy platform_retail_rates_platform_select on public.platform_retail_rates;
drop policy platform_meters_platform_select on public.platform_meters;
drop policy platform_products_platform_select on public.platform_products;
drop policy communication_rates_platform_select on public.communication_rates;

-- ---------------------------------------------------------------------------
-- Commercial: a member of some business, or staff
-- ---------------------------------------------------------------------------
-- "Belongs to any business" is one fact with a name, beside `is_platform_staff`, so the eight
-- policies below say it the same way and it is read once per statement.
create function app.is_organization_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.memberships m where m.user_id = (select auth.uid())
  );
$fn$;

revoke all on function app.is_organization_member() from public;
grant execute on function app.is_organization_member() to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'platform_plans',
    'platform_plan_product_grants',
    'platform_plan_module_grants',
    'platform_plan_feature_grants',
    'platform_plan_quotas',
    'platform_plan_prices',
    'platform_retail_rates',
    'communication_rates'
  ] loop
    execute format('drop policy %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using ((select app.is_platform_staff()) or (select app.is_organization_member()))',
      t || '_select', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Control plane: staff only
-- ---------------------------------------------------------------------------
-- `platform_providers` already carries `platform_providers_platform_select`; the rest gain one.
drop policy platform_providers_select on public.platform_providers;

do $$
declare
  t text;
begin
  foreach t in array array[
    'platform_provider_services',
    'platform_provider_service_features',
    'platform_connector_app_features',
    'platform_plan_provider_prices'
  ] loop
    execute format('drop policy %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select app.is_platform_staff()))',
      t || '_select', t);
  end loop;
end
$$;

-- The mapping table is vocabulary except for the rows that name a vendor, which no tenant code
-- reads: `organizationResolvedFeatureStates` asks for `module_key` rows only.
drop policy platform_catalog_runtime_mappings_select on public.platform_catalog_runtime_mappings;
create policy platform_catalog_runtime_mappings_select on public.platform_catalog_runtime_mappings
  for select to authenticated
  using (mapping_kind <> 'provider_key' or (select app.is_platform_staff()));

-- ---------------------------------------------------------------------------
-- The one tenant reader of the control plane: starting a subscription
-- ---------------------------------------------------------------------------
-- Checkout runs under the caller's own session (D14), so it read the Stripe price reference
-- straight from the table, which is why the table was readable at all. It reads it through this
-- door instead. The caller supplies no reference: they name a price they may already read, and
-- get back the reference only when they hold `billing.manage` in that organization and the price
-- is one that may be sold today.
create function public.plan_price_provider_reference(
  p_organization_id uuid,
  p_plan_price_id   uuid,
  p_environment     text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  perform app.require_capability(p_organization_id, 'billing.manage');

  return (
    select pp.price_reference
      from public.platform_plan_provider_prices pp
      join public.platform_plan_prices price on price.id = pp.plan_price_id
      join public.platform_plans plan on plan.id = price.plan_id
     where pp.plan_price_id = p_plan_price_id
       and pp.environment = p_environment
       and price.approval_state = 'approved'
       and plan.kind = 'plan'
       and plan.sale_status = 'active'
       and plan.billable
  );
end;
$fn$;

revoke all on function public.plan_price_provider_reference(uuid, uuid, text) from public;
grant execute on function public.plan_price_provider_reference(uuid, uuid, text) to authenticated;

comment on function public.plan_price_provider_reference(uuid, uuid, text) is
  'The processor price reference for a sellable plan price. Requires billing.manage in the organization; the mapping table itself is staff-only.';

comment on table public.platform_plan_provider_prices is
  'Which processor Product/Price backs one platform_plan_prices row, per environment. Staff-provisioned and append-only. Readable by staff only; a business reaches the one reference it needs through plan_price_provider_reference.';
