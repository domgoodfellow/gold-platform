-- F1: Production Package Catalogue. GildOps' commercial packages become Start, Operate, Scale
-- and Enterprise -- superseding the unprovisioned, unassigned launch snapshot this catalogue
-- carried since 20260924000001 (`platform`, `sales_os_founding`, `sales_os`, `operations_os`,
-- `business_managed`). That snapshot was never provisioned to a payment provider and never
-- assigned to a real organization (only GildOps' own `gold_internal` plan is assigned, and it is
-- untouched here) -- so nothing live changes hands. Its rows are archived, not deleted: a Plan's
-- prices and quotas are commercial history (I8) and are never rewritten or dropped, only retired.
--
-- The nine existing Add-ons (`additional_user`, `additional_caller`, `local_phone_number`,
-- `ai_lite`/`ai_pro`, `advanced_routing`, `premium_support`, `standard_implementation`,
-- `advanced_migration`) are untouched: an Add-on stacks on top of whichever base Plan an
-- organization holds, and nothing about the new ladder invalidates them.
--
-- Grants are whole-Product (`platform_plan_product_grants`), which already resolves to only
-- `available` Features at read time (`plan_entitled_features`) -- granting `service` on Scale and
-- Enterprise promises nothing, since Service has no available Feature yet. Quotas are seeded only
-- for the one meter with a real writer and an approved retail rate (`voice_minutes`) plus
-- unmetered seat/number counts (`users`, `calling_users`, `technicians`, `phone_numbers`) that
-- carry no usage-recording dependency. SMS, email and AI usage are granted by entitlement
-- (Product/Feature) on these Plans but deliberately carry no quota row: F0 found no `record_usage`
-- call site for any of those meters, so a numeric allowance here would promise tracking that does
-- not exist. A later metering slice adds those quota rows once the writer exists -- this slice
-- does not fabricate one to fill a table.
--
-- Enterprise is a real Plan row, `sale_status = 'active'`, with no `platform_plan_prices` row.
-- "No approved standard price" is exactly the signal `public_plan_catalog()` (below) reads as
-- `requires_contact_sales` -- there is no separate self-serve/sales-assisted column, because the
-- existing approval-state-on-price fact already answers the question without a new one.

-- Archive the launch-snapshot base Plans. Their prices, quotas and cost assumptions remain --
-- historical record, not a live offer.
update public.platform_plans
   set sale_status = 'archived'
 where key in ('platform', 'sales_os_founding', 'sales_os', 'operations_os', 'business_managed');

-- The one other stale reference this slice touches directly: GildOps' own internal dogfood Plan
-- kept the platform's pre-rename name (see 20261007000001, which renamed the platform to GildOps
-- without reaching this row).
update public.platform_plans
   set label = 'GildOps Internal',
       description = 'Non-billable. Every currently implemented capability, for GildOps'' own organization to dogfood with metering left on.'
 where key = 'gold_internal';

do $seed$
declare
  v_start      uuid;
  v_operate    uuid;
  v_scale      uuid;
  v_enterprise uuid;
  v_now        constant timestamptz := now();
begin
  insert into public.platform_plans (key, kind, label, description, billable, sale_status, display_order, created_by)
  values
    ('start', 'plan', 'Start', 'A real operating package for a smaller business beginning to run meaningful parts of its operation through GildOps.', true, 'active', 10, null)
  returning id into v_start;

  insert into public.platform_plans (key, kind, label, description, billable, sale_status, display_order, created_by)
  values
    ('operate', 'plan', 'Operate', 'The primary package for an established small business running Sales, Field and Finance together in normal operations.', true, 'active', 20, null)
  returning id into v_operate;

  insert into public.platform_plans (key, kind, label, description, billable, sale_status, display_order, created_by)
  values
    ('scale', 'plan', 'Scale', 'For businesses with higher operational volume, broader workspace use, more users, more automation, and greater included usage.', true, 'active', 30, null)
  returning id into v_scale;

  insert into public.platform_plans (key, kind, label, description, billable, sale_status, display_order, created_by)
  values
    ('enterprise', 'plan', 'Enterprise', 'Negotiated volume, allowances, onboarding, support, integrations and commercial terms. Priced by agreement, never by a standard price row.', true, 'active', 40, null)
  returning id into v_enterprise;

  -- Product grants -----------------------------------------------------------
  -- Start: the pipeline and the phone.
  insert into public.platform_plan_product_grants (plan_id, product_id)
  select v_start, id from public.platform_catalog_products where key in ('sales', 'comms', 'workspace');

  -- Operate: Start, plus what a business bills and schedules against.
  insert into public.platform_plan_product_grants (plan_id, product_id)
  select v_operate, id from public.platform_catalog_products
   where key in ('sales', 'comms', 'finance', 'field', 'automations', 'workspace');

  -- Start and Operate grant `workspace` whole but not `agents` whole, and `intelligence` (Ask)
  -- moved out of `workspace` into `agents` in 20261001000001. Granting workspace without also
  -- reaching `intelligence` would be exactly the silently-lost reach that migration's own backfill
  -- exists to prevent (gild-taxonomy.test.ts's "no Plan lost reach") -- so both Plans get the
  -- Module explicitly, the same way that migration gave it to every pre-existing Plan.
  insert into public.platform_plan_module_grants (plan_id, module_id)
  select v_start, m.id from public.platform_catalog_modules m
    join public.platform_catalog_products p on p.id = m.product_id and p.key = 'agents'
   where m.key = 'intelligence';

  insert into public.platform_plan_module_grants (plan_id, module_id)
  select v_operate, m.id from public.platform_catalog_modules m
    join public.platform_catalog_products p on p.id = m.product_id and p.key = 'agents'
   where m.key = 'intelligence';

  -- Scale and Enterprise: the full eight Products plus the shared workspace. `service` and
  -- `agents` grant nothing extra today beyond what each already has available (Service has no
  -- available Feature yet) -- granting the Product is honest about what Scale/Enterprise are
  -- entitled to as each ships, not a promise about what exists this week.
  insert into public.platform_plan_product_grants (plan_id, product_id)
  select v_scale, id from public.platform_catalog_products;

  insert into public.platform_plan_product_grants (plan_id, product_id)
  select v_enterprise, id from public.platform_catalog_products;

  -- Quotas ---------------------------------------------------------------------
  -- Enterprise carries no standard quota row: its allowances are negotiated per organization
  -- through organization_plan_quota_overrides, not templated here.
  insert into public.platform_plan_quotas
    (plan_id, allowance_key, label, unit, included_quantity, period, hard_limit, overage_policy, meter_id, display_order)
  values
    (v_start, 'users', 'Users', 'user', 5, 'none', null, 'not_applicable', null, 1),
    (v_start, 'intelligent_call_minutes', 'Intelligent call minutes', 'minute', 1000, 'month', null, 'allowed', 'voice_minutes', 2),

    (v_operate, 'users', 'Users', 'user', 10, 'none', null, 'not_applicable', null, 1),
    (v_operate, 'calling_users', 'Calling users', 'user', 5, 'none', null, 'not_applicable', null, 2),
    (v_operate, 'technicians', 'Technicians', 'user', 5, 'none', null, 'not_applicable', null, 3),
    (v_operate, 'intelligent_call_minutes', 'Intelligent call minutes', 'minute', 2500, 'month', null, 'allowed', 'voice_minutes', 4),

    (v_scale, 'users', 'Users', 'user', 25, 'none', null, 'not_applicable', null, 1),
    (v_scale, 'calling_users', 'Calling users', 'user', 15, 'none', null, 'not_applicable', null, 2),
    (v_scale, 'technicians', 'Technicians', 'user', 15, 'none', null, 'not_applicable', null, 3),
    (v_scale, 'phone_numbers', 'Phone numbers', 'number', 3, 'none', null, 'not_applicable', null, 4),
    (v_scale, 'intelligent_call_minutes', 'Intelligent call minutes', 'minute', 6000, 'month', null, 'allowed', 'voice_minutes', 5);

  -- Prices -----------------------------------------------------------------------
  -- Enterprise carries no price row -- absence of an approved standard price is what
  -- public_plan_catalog() reads as "Contact Sales".
  insert into public.platform_plan_prices
    (plan_id, currency, amount_minor, billing_interval, effective_from, approval_state, source, captured_at, recorded_by, note)
  values
    (v_start,   'CAD', 49900,  'month', v_now, 'approved', 'F1 production package ladder', v_now, null, ''),
    (v_operate, 'CAD', 99900,  'month', v_now, 'approved', 'F1 production package ladder', v_now, null, ''),
    (v_scale,   'CAD', 199900, 'month', v_now, 'approved', 'F1 production package ladder', v_now, null, '');
end;
$seed$;

-- A tenant-safe, public-safe projection of the commercial catalogue (section 13/F1). Excludes
-- provider cost, margin, provider account identifiers, internal notes and every other
-- organization's data by construction -- it never selects from a table that holds any of those,
-- only from the Plan-facing tables an anonymous visitor could otherwise not read (platform_plans'
-- own RLS policy is `to authenticated`, not `anon`). Consumers: the future public Pricing slice,
-- signup package selection, and Settings -> Plan & Usage (organization-plan.ts's
-- `organizationPlanPrice`/`organizationEffectiveQuotas` remain the source for a specific
-- organization's own price/quotas; this function is the source for "what could I buy").
create function public.public_plan_catalog()
returns table (
  plan_key              text,
  kind                  text,
  label                 text,
  description           text,
  requires_contact_sales boolean,
  prices                jsonb,
  products              jsonb,
  quotas                jsonb
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    p.key,
    p.kind,
    p.label,
    p.description,
    not exists (
      select 1 from public.platform_plan_prices pr
       where pr.plan_id = p.id and pr.approval_state = 'approved'
    ) as requires_contact_sales,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'currency', pr.currency,
               'amountMinor', pr.amount_minor,
               'billingInterval', pr.billing_interval
             ) order by pr.currency, pr.billing_interval)
        from public.platform_plan_prices pr
       where pr.plan_id = p.id and pr.approval_state = 'approved'
    ), '[]'::jsonb) as prices,
    coalesce((
      select jsonb_agg(jsonb_build_object('key', cp.key, 'label', cp.label) order by cp.display_order)
        from public.platform_plan_product_grants g
        join public.platform_catalog_products cp on cp.id = g.product_id
       where g.plan_id = p.id
    ), '[]'::jsonb) as products,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'allowanceKey', q.allowance_key,
               'label', q.label,
               'unit', q.unit,
               'includedQuantity', q.included_quantity,
               'period', q.period,
               'overagePolicy', q.overage_policy
             ) order by q.display_order)
        from public.platform_plan_quotas q
       where q.plan_id = p.id
    ), '[]'::jsonb) as quotas
  from public.platform_plans p
  where p.sale_status = 'active'
    and p.billable = true
  order by p.kind, p.display_order;
$fn$;

comment on function public.public_plan_catalog() is
  'The one public-safe read of what GildOps sells: active, billable Plans and Add-ons only, standard approved prices only, no cost/margin/provider columns reachable. requires_contact_sales is derived from the absence of an approved price, not a stored flag -- Enterprise needs no separate self-serve/sales-assisted column because of it.';

grant execute on function public.public_plan_catalog() to anon, authenticated;
