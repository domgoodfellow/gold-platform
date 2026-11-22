-- GildOps' Finance is the only authority over GildOps' money; `platform.commercial` is retired
-- (ADR-057, completed).
--
-- Platform staff status no longer reaches a plan's price, a business's subscription, a supplier
-- cost or a margin. Every check that asked for the `platform.commercial` platform permission now
-- asks for a Finance permission held in GildOps' operating Organization (`app.platform_seller_has`),
-- so only members of that Organization whose role grants it pass, and a database with no operating
-- Organization configured refuses everything:
--
--   subscription.read    see the businesses GildOps serves, their plans, agreed prices,
--                        allowances, charges, credits and billing-provider state (new);
--   subscription.manage  change them;
--   cost.read            see supplier rates, usage costs, cost to serve, revenue and margins;
--   cost.manage          record supplier rates, cost reconciliations and economics assumptions.
--
-- What a plan switches on stays Product Registry's (`platform.catalogue`), and every signed-in
-- member may still read it, as the public catalogue already publishes it. A buying business keeps
-- reading its own rows, exactly as before. Billing-webhook delivery health stays readable to
-- `platform.health` for Administration's reliability view; it carries no amounts.
--
-- Superseded doors are dropped rather than rewritten: each has a Finance replacement or no caller.
--   create_plan                   -> create_plan_item (Finance, pricing permission in the seller)
--   record_plan_price             -> record_item_price
--   record_plan_provider_price    -> record_item_provider_price
--   attach_plan_addon, detach_plan_addon -> set_item_addon
--   update_plan                   -> the item's own row (name, description, sale status) and
--                                    update_plan_switches (billing, order)
--   record_commercial_retail_rate, record_retail_rate -> record_item_usage_price
--   record_product_price and platform_product_prices  -> retired with Platform Pricing
--   record_plan_agreement         -> record_organization_plan_agreement
--   record_phone_number_month     -> no caller
-- The old-name views over the price book (platform_plan_prices, platform_plan_provider_prices,
-- platform_plan_addons) have no reader left and are dropped.
--
-- Every identifier, amount, currency, interval, effective date and billing-provider reference is
-- untouched: this migration changes who may read and write, never what was recorded.

-- 1. `subscription.read`, granted to unrestricted administrators and to every role that may
--    already change subscriptions.
create function pg_temp.add_capability(p_add text) returns void
language plpgsql as $$
declare v_constraint text; v_before text[]; v_after text[];
begin
  select pg_get_constraintdef(oid) into v_constraint from pg_constraint
    where conrelid = 'public.roles'::regclass and conname = 'roles_capabilities_known';
  select array_agg(distinct m[1]) into v_before from regexp_matches(v_constraint, '''([^'']+)''::text', 'g') m;
  if p_add = any (v_before) then return; end if;
  v_after := v_before || p_add;
  alter table public.roles drop constraint roles_capabilities_known;
  execute format('alter table public.roles add constraint roles_capabilities_known check (capabilities <@ array[%s]::text[])',
    (select string_agg(quote_literal(c), ',' order by c) from unnest(v_after) c));
  -- Only adds a permission, so it cannot leave a business without someone who manages roles.
  alter table public.roles disable trigger roles_capabilities_update_guard;
  update public.roles set capabilities = capabilities || p_add
    where (capabilities @> v_before or 'subscription.manage' = any (capabilities))
      and not p_add = any (capabilities);
  alter table public.roles enable trigger roles_capabilities_update_guard;
  if (select tgenabled from pg_trigger where tgrelid = 'public.roles'::regclass and tgname = 'roles_capabilities_update_guard') <> 'O' then
    raise exception 'roles_capabilities_update_guard was not restored';
  end if;
end $$;
select pg_temp.add_capability('subscription.read');
drop function pg_temp.add_capability(text);

-- 2. The refusing form of `app.platform_seller_has`, for functions that write. Returns the
--    caller's name for the audit trails that recorded a staff name before.
create function app.require_platform_seller(p_capability text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'this operation requires an authenticated caller' using errcode = '42501';
  end if;
  if app.platform_seller_id() is null then
    raise exception 'No business is configured as the seller of GildOps.' using errcode = '42501';
  end if;
  if not app.platform_seller_has(p_capability) then
    raise exception 'This needs the % permission in GildOps'' own business.', p_capability using errcode = '42501';
  end if;
  return coalesce(
    (select nullif(btrim(coalesce(nullif(btrim(p.preferred_name), ''), concat_ws(' ', p.given_name, p.family_name))), '')
       from public.account_profiles p where p.user_id = v_actor),
    (select u.email from auth.users u where u.id = v_actor),
    v_actor::text);
end $$;
comment on function app.require_platform_seller(text) is
  'Refuses unless the caller holds the permission in GildOps'' operating Organization (ADR-057); returns their name for audit trails. Platform staff status is not an input.';
-- Only definer functions call it, so no signed-in role runs it directly.
revoke all on function app.require_platform_seller(text) from public, anon, authenticated;

-- 3. Every remaining `platform.commercial` check, rewritten from its live definition with only
--    the check changed.
-- public.allowance_decision: subscription.read
CREATE OR REPLACE FUNCTION public.allowance_decision(p_organization_id uuid, p_allowance_key text, p_requested_quantity numeric DEFAULT 1, p_at timestamp with time zone DEFAULT now())
 RETURNS TABLE(result text, permitted boolean, governed boolean, allowance_key text, label text, unit text, included numeric, consumed numeric, remaining numeric, included_applied numeric, overage_applied numeric, hard_limit numeric, overage_behavior text, enforcement text, window_starts_at timestamp with time zone, window_ends_at timestamp with time zone, window_basis text, detail text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (p_organization_id in (select app.current_tenant_ids()) or (app.has_platform_capability('platform.organizations') or app.platform_seller_has('subscription.read'))) then
    raise exception 'you cannot read this business''s allowances' using errcode = '42501';
  end if;

  return query select * from app.allowance_decision(
    p_organization_id, p_allowance_key, p_requested_quantity, p_at);
end;
$function$;

-- public.credit_balance: subscription.read
CREATE OR REPLACE FUNCTION public.credit_balance(p_organization_id uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (p_organization_id in (select app.current_tenant_ids()) or (app.has_platform_capability('platform.organizations') or app.platform_seller_has('subscription.read'))) then
    return 0;
  end if;

  return floor(coalesce(app.credit_balance_micros(p_organization_id), 0) / 1000000.0)::bigint;
end;
$function$;

-- public.organization_allowance_state: subscription.read
CREATE OR REPLACE FUNCTION public.organization_allowance_state(p_organization_id uuid, p_allowance_key text DEFAULT NULL::text, p_at timestamp with time zone DEFAULT now())
 RETURNS TABLE(allowance_key text, label text, unit text, allowance_type text, period text, reset_semantics text, window_starts_at timestamp with time zone, window_ends_at timestamp with time zone, window_basis text, included numeric, consumed numeric, reserved numeric, remaining numeric, overage_quantity numeric, hard_limit numeric, overage_policy text, overage_behavior text, meter_id text, service_class text, contributions jsonb, enforcement text, state text, configuration_error text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (p_organization_id in (select app.current_tenant_ids()) or (app.has_platform_capability('platform.organizations') or app.platform_seller_has('subscription.read'))) then
    raise exception 'you cannot read this business''s allowances' using errcode = '42501';
  end if;

  return query select * from app.allowance_states(p_organization_id, p_allowance_key, p_at);
end;
$function$;

-- public.organization_commercial_summary: cost.read
CREATE OR REPLACE FUNCTION public.organization_commercial_summary(p_organization_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(meter_id text, customer_currency text, customer_charge_minor bigint, provider_currency text, provider_cost_minor bigint, quantity bigint, margin_minor bigint, unpriced_quantity bigint, uncosted_quantity bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$

  select app.require_platform_seller('cost.read');



  with effective as (

    select u.meter_id,

           u.customer_currency,

           u.customer_charge_micros,

           u.quantity,

           coalesce(r.reconciled_provider_cost_micros, u.provider_cost_micros) as provider_cost_micros,

           coalesce(r.provider_currency, u.provider_currency)                 as provider_currency,

           u.customer_charge_micros is null                                   as unpriced,

           (u.provider_cost_applicable

            and coalesce(r.reconciled_provider_cost_micros, u.provider_cost_micros) is null) as uncosted

      from public.usage_events u

      left join lateral (

        select rec.reconciled_provider_cost_micros, rec.provider_currency

          from public.usage_cost_reconciliations rec

         where rec.organization_id = u.organization_id

           and rec.usage_event_id = u.id

         order by rec.reconciled_at desc

         limit 1

      ) r on true

     where u.organization_id = p_organization_id

       and (p_from is null or u.occurred_at >= p_from::timestamptz)

       and (p_to   is null or u.occurred_at <  p_to::timestamptz)

  )

  select e.meter_id,

         e.customer_currency,

         coalesce(round(sum(e.customer_charge_micros) / 1000000.0), 0)::bigint,

         e.provider_currency,

         coalesce(round(sum(e.provider_cost_micros) / 1000000.0), 0)::bigint,

         sum(e.quantity)::bigint,

         case

           when bool_or(e.unpriced) or bool_or(e.uncosted) then null

           when coalesce(sum(e.provider_cost_micros), 0) = 0

             then round(sum(e.customer_charge_micros) / 1000000.0)::bigint

           when e.customer_currency = e.provider_currency

             then round((sum(e.customer_charge_micros) - sum(e.provider_cost_micros)) / 1000000.0)::bigint

           else null

         end as margin_minor,

         coalesce(sum(e.quantity) filter (where e.unpriced), 0)::bigint,

         coalesce(sum(e.quantity) filter (where e.uncosted), 0)::bigint

    from effective e

   group by e.meter_id, e.customer_currency, e.provider_currency

   order by e.meter_id, e.customer_currency, e.provider_currency;

$function$;

-- public.organization_cost_to_serve: cost.read
CREATE OR REPLACE FUNCTION public.organization_cost_to_serve(p_organization_id uuid, p_period_start timestamp with time zone, p_period_end timestamp with time zone, p_reporting_currency text DEFAULT 'CAD'::text)
 RETURNS TABLE(reporting_currency text, direct_usage_cogs_micros bigint, direct_usage_has_unknown boolean, resource_cogs_micros bigint, infrastructure_attributable_cogs_micros bigint, manual_direct_cogs_micros bigint, attributable_known_cogs_micros bigint, attributable_has_unallocated_peer boolean, shared_platform_cost_micros bigint, unallocated_cost_micros bigint, component_count bigint, known_component_count bigint, cost_coverage numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_seller('cost.read');
  return query select * from app.organization_cost_to_serve(p_organization_id, p_period_start, p_period_end, p_reporting_currency);
end;
$function$;

-- public.organization_revenue_summary: cost.read
CREATE OR REPLACE FUNCTION public.organization_revenue_summary(p_organization_id uuid, p_billing_period_start timestamp with time zone, p_billing_period_end timestamp with time zone, p_reporting_currency text DEFAULT 'CAD'::text)
 RETURNS TABLE(reporting_currency text, base_plan_minor bigint, addon_minor bigint, recurring_resource_minor bigint, usage_overage_minor bigint, one_time_service_minor bigint, debit_adjustment_minor bigint, credit_adjustment_minor bigint, customer_obligation_minor bigint, has_mixed_currency boolean, known_cost_to_serve_minor bigint, known_contribution_minor bigint, known_margin numeric, cost_coverage numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_mixed boolean;
begin
  perform app.require_platform_seller('cost.read');

  select bool_or(currency <> p_reporting_currency) into v_mixed
    from public.organization_charge_components
   where organization_id = p_organization_id
     and billing_period_start = p_billing_period_start
     and billing_period_end = p_billing_period_end;

  return query
  with rev as (
    select
      coalesce(sum(amount_minor) filter (where component_type = 'base_plan' and currency = p_reporting_currency), 0)::bigint as base_plan,
      coalesce(sum(amount_minor) filter (where component_type = 'addon' and currency = p_reporting_currency), 0)::bigint as addon,
      coalesce(sum(amount_minor) filter (where component_type = 'recurring_resource' and currency = p_reporting_currency), 0)::bigint as resource,
      coalesce(sum(amount_minor) filter (where component_type = 'usage_overage' and currency = p_reporting_currency), 0)::bigint as overage,
      coalesce(sum(amount_minor) filter (where component_type = 'one_time_service' and currency = p_reporting_currency), 0)::bigint as service,
      coalesce(sum(amount_minor) filter (where component_type = 'debit_adjustment' and currency = p_reporting_currency), 0)::bigint as debit,
      coalesce(sum(amount_minor) filter (where component_type = 'credit_adjustment' and currency = p_reporting_currency), 0)::bigint as credit
    from public.organization_charge_components
   where organization_id = p_organization_id
     and billing_period_start = p_billing_period_start
     and billing_period_end = p_billing_period_end
  ),
  cost as (
    select * from app.organization_cost_to_serve(p_organization_id, p_billing_period_start, p_billing_period_end, p_reporting_currency)
  )
  select
    p_reporting_currency,
    rev.base_plan, rev.addon, rev.resource, rev.overage, rev.service, rev.debit, rev.credit,
    (rev.base_plan + rev.addon + rev.resource + rev.overage + rev.service + rev.debit - rev.credit),
    coalesce(v_mixed, false),
    cost.attributable_known_cogs_micros / 1000000,
    (rev.base_plan + rev.addon + rev.resource + rev.overage + rev.service + rev.debit - rev.credit) - (cost.attributable_known_cogs_micros / 1000000),
    case when (rev.base_plan + rev.addon + rev.resource + rev.overage + rev.service + rev.debit - rev.credit) = 0 then null
         else round((((rev.base_plan + rev.addon + rev.resource + rev.overage + rev.service + rev.debit - rev.credit) - (cost.attributable_known_cogs_micros / 1000000))::numeric
              / (rev.base_plan + rev.addon + rev.resource + rev.overage + rev.service + rev.debit - rev.credit)), 4) end,
    cost.cost_coverage
  from rev, cost;
end;
$function$;

-- public.organization_usage_detail: cost.read
CREATE OR REPLACE FUNCTION public.organization_usage_detail(p_organization_id uuid)
 RETURNS TABLE(usage_event_id uuid, meter_id text, quantity bigint, occurred_at timestamp with time zone, provider_key text, estimated_cost_micros bigint, estimated_currency text, reconciled_cost_micros bigint, reconciled_currency text, reconciled_at timestamp with time zone, customer_currency text, customer_charge_micros bigint, retail_state text, provider_state text, fulfilled_through text, awaiting_reconciliation boolean, allowance_key text, allowance_included_total numeric, allowance_consumed_before numeric, allowance_included_applied numeric, allowance_overage_quantity numeric, allowance_window_start timestamp with time zone, allowance_window_end timestamp with time zone, allowance_window_basis text, allowance_state text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select app.require_platform_seller('cost.read');

  select u.id,
         u.meter_id,
         u.quantity,
         u.occurred_at,
         u.provider_key,
         u.provider_cost_micros,
         u.provider_currency,
         r.reconciled_provider_cost_micros,
         r.provider_currency,
         r.reconciled_at,
         u.customer_currency,
         u.customer_charge_micros,
         -- The rate axis, unchanged: priced (a price of nothing is still priced), or why it is not.
         case when u.customer_charge_micros is not null then 'priced'
              when u.customer_currency is null then 'no_currency'
              else 'no_rate' end,
         -- costed by a rate, not costed yet, or carrying no provider cost at all
         case when not u.provider_cost_applicable then 'not_applicable'
              when u.provider_cost_micros is null and r.reconciled_at is null then 'uncosted'
              else 'costed' end,
         u.fulfilled_through,
         -- an applicable provider cost that no provider statement has confirmed yet
         (u.provider_cost_applicable and r.reconciled_at is null),
         u.allowance_key,
         u.allowance_included_total,
         u.allowance_consumed_before,
         u.allowance_included_applied,
         u.allowance_overage_quantity,
         u.allowance_window_start,
         u.allowance_window_end,
         u.allowance_window_basis,
         -- The allowance axis, orthogonal to the rate one. Read together they tell *included*
         -- (covered, so nothing to charge), *zero-priced* (rated at nothing) and *unpriced*
         -- (no rate at all) apart -- three financial facts, never one zero.
         case when u.allowance_key is null then 'ungoverned'
              when u.allowance_overage_quantity = 0 then 'included'
              when u.allowance_included_applied = 0 then 'overage'
              else 'partly_included' end
    from public.usage_events u
    left join lateral (
      select rec.reconciled_provider_cost_micros, rec.provider_currency, rec.reconciled_at
        from public.usage_cost_reconciliations rec
       where rec.organization_id = u.organization_id
         and rec.usage_event_id = u.id
       order by rec.reconciled_at desc
       limit 1
    ) r on true
   where u.organization_id = p_organization_id
   order by u.occurred_at desc;
$function$;

-- public.platform_revenue_portfolio: cost.read
CREATE OR REPLACE FUNCTION public.platform_revenue_portfolio(p_billing_period_start timestamp with time zone, p_billing_period_end timestamp with time zone, p_reporting_currency text DEFAULT 'CAD'::text)
 RETURNS TABLE(organization_id uuid, organization_name text, customer_obligation_minor bigint, known_cost_to_serve_minor bigint, known_contribution_minor bigint, known_margin numeric, cost_coverage numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_seller('cost.read');

  return query
  select o.id, o.name, r.customer_obligation_minor, r.known_cost_to_serve_minor, r.known_contribution_minor, r.known_margin, r.cost_coverage
    from public.organizations o
    cross join lateral public.organization_revenue_summary(o.id, p_billing_period_start, p_billing_period_end, p_reporting_currency) r
   where exists (
     select 1 from public.organization_charge_components c
      where c.organization_id = o.id and c.billing_period_start = p_billing_period_start and c.billing_period_end = p_billing_period_end
   )
   order by r.customer_obligation_minor desc;
end;
$function$;

-- public.platform_usage_cost_components: cost.read
CREATE OR REPLACE FUNCTION public.platform_usage_cost_components(p_usage_event_id uuid)
 RETURNS TABLE(id uuid, component_key text, provider_key text, cost_meter_key text, quantity numeric, unit text, provider_rate_id uuid, native_cost_micros bigint, native_currency text, reporting_cost_micros bigint, reporting_currency text, cost_state text, unknown_reason text, effective_state text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select app.require_platform_seller('cost.read');
  select c.id, c.component_key, c.provider_key, c.cost_meter_key, c.quantity, c.unit,
         c.provider_rate_id, coalesce(a.native_cost_micros, c.native_cost_micros),
         coalesce(a.native_currency, c.native_currency), c.reporting_cost_micros,
         c.reporting_currency, c.cost_state, c.unknown_reason,
         coalesce(a.state, c.cost_state)
    from public.usage_cost_components c
    left join lateral (
      select x.native_cost_micros, x.native_currency, x.state
        from public.usage_cost_component_adjustments x
       where x.organization_id = c.organization_id and x.cost_component_id = c.id
       order by x.recorded_at desc limit 1
    ) a on true
   where c.usage_event_id = p_usage_event_id
   order by c.component_key
$function$;

-- public.platform_usage_economics: cost.read
CREATE OR REPLACE FUNCTION public.platform_usage_economics(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_organization_id uuid DEFAULT NULL::uuid, p_meter_id text DEFAULT NULL::text, p_provider_key text DEFAULT NULL::text, p_cost_state text DEFAULT NULL::text)
 RETURNS TABLE(usage_event_id uuid, organization_id uuid, organization_name text, meter_id text, quantity bigint, occurred_at timestamp with time zone, source_domain text, source_record_id text, customer_currency text, customer_charge_micros bigint, component_count bigint, known_cost_micros bigint, reporting_currency text, cost_state text, allowance_key text, allowance_included_total numeric, allowance_included_applied numeric, allowance_overage_quantity numeric, allowance_window_start timestamp with time zone, allowance_window_end timestamp with time zone, allowance_window_basis text, allowance_state text, retail_state text, retail_rate_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select app.require_platform_seller('cost.read');
  select u.id, u.organization_id, o.name, u.meter_id, u.quantity, u.occurred_at,
         u.source_domain, u.source_record_id, u.customer_currency, u.customer_charge_micros,
         count(c.id), coalesce(sum(
           case when a.id is not null and a.native_currency = c.reporting_currency then a.native_cost_micros
                when a.id is null then c.reporting_cost_micros end
         ), 0)::bigint,
         max(c.reporting_currency),
         case when count(c.id) = 0 or count(*) filter (
                where c.cost_state = 'unknown'
                   or (c.native_cost_micros is not null and c.reporting_cost_micros is null)
                   or (a.id is not null and (c.reporting_currency is null or a.native_currency <> c.reporting_currency))
              ) > 0 then 'unknown'
              when count(a.id) = count(c.id) and count(c.id) > 0 then 'reconciled'
              else 'estimated' end,
         u.allowance_key, u.allowance_included_total, u.allowance_included_applied,
         u.allowance_overage_quantity, u.allowance_window_start, u.allowance_window_end,
         u.allowance_window_basis,
         case when u.allowance_key is null then 'ungoverned'
              when u.allowance_overage_quantity = 0 then 'included'
              when u.allowance_included_applied = 0 then 'overage'
              else 'partly_included' end,
         case when u.customer_charge_micros is not null then 'priced'
              when u.customer_currency is null then 'no_currency'
              else 'no_rate' end,
         u.retail_rate_id
    from public.usage_events u
    join public.organizations o on o.id = u.organization_id
    left join public.usage_cost_components c on c.organization_id = u.organization_id and c.usage_event_id = u.id
    left join lateral (
      select x.id, x.native_cost_micros, x.native_currency from public.usage_cost_component_adjustments x
       where x.organization_id = c.organization_id and x.cost_component_id = c.id
       order by x.recorded_at desc limit 1
    ) a on true
   where (p_from is null or u.occurred_at >= p_from)
     and (p_to is null or u.occurred_at < p_to)
     and (p_organization_id is null or u.organization_id = p_organization_id)
     and (p_meter_id is null or u.meter_id = p_meter_id)
     and (p_provider_key is null or c.provider_key = p_provider_key)
   group by u.id, o.name
  having p_cost_state is null or
    (case when count(c.id) = 0 or count(*) filter (
             where c.cost_state = 'unknown'
                or (c.native_cost_micros is not null and c.reporting_cost_micros is null)
                or (a.id is not null and (c.reporting_currency is null or a.native_currency <> c.reporting_currency))
           ) > 0 then 'unknown'
          when count(a.id) = count(c.id) and count(c.id) > 0 then 'reconciled' else 'estimated' end) = p_cost_state
   order by u.occurred_at desc
   limit 250
$function$;

-- public.compose_organization_charges: subscription.manage
CREATE OR REPLACE FUNCTION public.compose_organization_charges(p_organization_id uuid, p_billing_period_start timestamp with time zone, p_billing_period_end timestamp with time zone)
 RETURNS TABLE(kind text, written boolean, proration_required boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_seller('subscription.manage');
  return query select * from app.compose_organization_charges(
    p_organization_id, p_billing_period_start, p_billing_period_end, (select auth.uid()));
end;
$function$;

-- public.finalize_organization_charges: subscription.manage
CREATE OR REPLACE FUNCTION public.finalize_organization_charges(p_organization_id uuid, p_billing_period_start timestamp with time zone, p_billing_period_end timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  perform app.require_platform_seller('subscription.manage');

  update public.organization_charge_components
     set finalized_at = now()
   where organization_id = p_organization_id
     and billing_period_start = p_billing_period_start
     and billing_period_end = p_billing_period_end
     and finalized_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- public.record_agreement_provider_price: subscription.manage
CREATE OR REPLACE FUNCTION public.record_agreement_provider_price(p_agreement_id uuid, p_environment text, p_billing_interval text, p_product_reference text, p_price_reference text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid;
  v_id  uuid;
begin
  perform app.require_platform_seller('subscription.manage');

  select organization_id into v_org from public.organization_plan_agreements where id = p_agreement_id;
  if v_org is null then
    raise exception 'no such agreement' using errcode = '23503';
  end if;

  -- Never an update: a recorded mapping is history. Recording the same agreement again returns
  -- the mapping already there.
  insert into public.organization_plan_agreement_provider_prices (
    organization_id, agreement_id, environment, billing_interval, product_reference, price_reference, provisioned_by
  )
  values (v_org, p_agreement_id, p_environment, p_billing_interval, p_product_reference, p_price_reference, (select auth.uid()))
  on conflict (organization_id, agreement_id, environment, billing_interval) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.organization_plan_agreement_provider_prices
     where organization_id = v_org and agreement_id = p_agreement_id
       and environment = p_environment and billing_interval = p_billing_interval;
  end if;

  return v_id;
end;
$function$;

-- public.record_commercial_adjustment: subscription.manage
CREATE OR REPLACE FUNCTION public.record_commercial_adjustment(p_organization_id uuid, p_direction text, p_amount_minor bigint, p_currency text, p_reason text, p_effective_at timestamp with time zone DEFAULT now())
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff uuid := (select auth.uid());
  v_id    uuid;
begin
  perform app.require_platform_seller('subscription.manage');

  insert into public.organization_commercial_adjustments
    (organization_id, direction, amount_minor, currency, effective_at, reason, recorded_by)
  values
    (p_organization_id, p_direction, p_amount_minor, upper(btrim(p_currency)), p_effective_at, p_reason, v_staff)
  returning id into v_id;

  return v_id;
end;
$function$;

-- public.record_commercial_term: subscription.manage
CREATE OR REPLACE FUNCTION public.record_commercial_term(p_organization_id uuid, p_product_key text, p_period_start date, p_period_end date, p_price_minor bigint, p_currency text DEFAULT NULL::text, p_quantity integer DEFAULT 1, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff uuid := (select auth.uid());
  v_name  text;
  v_currency text := case when p_currency is null then null else upper(btrim(p_currency)) end;
  v_id    uuid;
begin
  v_name := app.require_platform_seller('subscription.manage');

  insert into public.organization_commercial_terms
    (organization_id, product_key, period_start, period_end, quantity, price_minor, currency, recorded_by, note)
  values
    (p_organization_id, p_product_key, p_period_start, p_period_end, coalesce(p_quantity, 1),
     p_price_minor, v_currency, v_staff, p_note)
  returning id into v_id;

  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_staff, 'organization', p_organization_id, 'commercial_term.recorded',
     jsonb_build_object(
       'term_id', v_id, 'product_key', p_product_key,
       'period_start', p_period_start, 'period_end', p_period_end,
       'price_minor', p_price_minor, 'currency', v_currency, 'quantity', coalesce(p_quantity, 1),
       'recorded_by', v_name
     ));

  return v_id;
end;
$function$;

-- public.record_organization_plan_agreement: subscription.manage
CREATE OR REPLACE FUNCTION public.record_organization_plan_agreement(p_organization_id uuid, p_plan_id uuid, p_currency text, p_amount_minor bigint, p_effective_from timestamp with time zone, p_effective_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_seller('subscription.manage');
  return app.write_plan_agreement(
    p_organization_id, p_plan_id, p_currency, p_amount_minor, p_effective_from, p_effective_to,
    (select auth.uid()), p_note);
end;
$function$;

-- public.record_plan_assignment: subscription.manage
CREATE OR REPLACE FUNCTION public.record_plan_assignment(p_organization_id uuid, p_plan_id uuid, p_period_start date, p_period_end date, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_seller('subscription.manage');
  return app.write_plan_assignment(
    p_organization_id, p_plan_id, p_period_start, p_period_end, (select auth.uid()), p_note);
end;
$function$;

-- public.record_plan_quota_override: subscription.manage
CREATE OR REPLACE FUNCTION public.record_plan_quota_override(p_organization_id uuid, p_plan_id uuid, p_allowance_key text, p_included_quantity numeric, p_hard_limit numeric DEFAULT NULL::numeric, p_effective_from timestamp with time zone DEFAULT now(), p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff uuid := (select auth.uid());
  v_id    uuid;
begin
  perform app.require_platform_seller('subscription.manage');

  insert into public.organization_plan_quota_overrides
    (organization_id, plan_id, allowance_key, included_quantity, hard_limit, effective_from, recorded_by, note)
  values
    (p_organization_id, p_plan_id, p_allowance_key, p_included_quantity, p_hard_limit,
     p_effective_from, v_staff, p_note)
  returning id into v_id;

  return v_id;
end;
$function$;

-- public.record_infrastructure_cost: cost.manage
CREATE OR REPLACE FUNCTION public.record_infrastructure_cost(p_cost_category text, p_allocation_quality text, p_billing_period date, p_native_cost_micros bigint, p_native_currency text, p_source text, p_organization_id uuid DEFAULT NULL::uuid, p_provider_key text DEFAULT NULL::text, p_provider_account_id uuid DEFAULT NULL::uuid, p_provider_binding_id uuid DEFAULT NULL::uuid, p_provider_resource_id uuid DEFAULT NULL::uuid, p_reporting_cost_micros bigint DEFAULT NULL::bigint, p_reporting_currency text DEFAULT NULL::text, p_fx_rate_id uuid DEFAULT NULL::uuid, p_fx_rate numeric DEFAULT NULL::numeric, p_driver_basis text DEFAULT NULL::text, p_driver_quantity numeric DEFAULT NULL::numeric, p_provider_reference text DEFAULT NULL::text, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff uuid := (select auth.uid());
  v_id    uuid;
begin
  perform app.require_platform_seller('cost.manage');

  insert into public.platform_infrastructure_cost_components
    (organization_id, cost_category, allocation_quality, provider_key, provider_account_id,
     provider_binding_id, provider_resource_id, billing_period, native_cost_micros, native_currency,
     reporting_cost_micros, reporting_currency, fx_rate_id, fx_rate, driver_basis, driver_quantity,
     provider_reference, source, note, recorded_by)
  values
    (p_organization_id, p_cost_category, p_allocation_quality, p_provider_key, p_provider_account_id,
     p_provider_binding_id, p_provider_resource_id, date_trunc('month', p_billing_period)::date,
     p_native_cost_micros, upper(btrim(p_native_currency)),
     p_reporting_cost_micros, case when p_reporting_currency is null then null else upper(btrim(p_reporting_currency)) end,
     p_fx_rate_id, p_fx_rate, p_driver_basis, p_driver_quantity,
     p_provider_reference, p_source, p_note, v_staff)
  returning id into v_id;

  return v_id;
end;
$function$;

-- public.record_plan_margin_policy: cost.manage
CREATE OR REPLACE FUNCTION public.record_plan_margin_policy(p_plan_id uuid, p_currency text, p_target_margin numeric, p_warning_margin numeric, p_hard_floor_margin numeric, p_effective_from timestamp with time zone, p_source text, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
  perform app.require_platform_seller('cost.manage');
  insert into public.platform_plan_margin_policies
    (plan_id,currency,target_margin,warning_margin,hard_floor_margin,effective_from,source,note,recorded_by)
  values
    (p_plan_id,upper(btrim(p_currency)),p_target_margin,p_warning_margin,p_hard_floor_margin,p_effective_from,p_source,p_note,(select auth.uid()))
  returning id into v_id;
  return v_id;
end $function$;

-- public.record_plan_utilization_assumption: cost.manage
CREATE OR REPLACE FUNCTION public.record_plan_utilization_assumption(p_plan_id uuid, p_scenario text, p_allowance_key text, p_utilization numeric, p_effective_from timestamp with time zone, p_source text, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
  perform app.require_platform_seller('cost.manage');
  if not exists (select 1 from public.platform_plan_quotas where plan_id=p_plan_id and allowance_key=p_allowance_key) then
    raise exception 'allowance does not belong to plan' using errcode='23503';
  end if;
  insert into public.platform_plan_utilization_assumptions
    (plan_id,scenario,allowance_key,utilization,effective_from,source,note,recorded_by)
  values
    (p_plan_id,p_scenario,p_allowance_key,p_utilization,p_effective_from,p_source,p_note,(select auth.uid()))
  returning id into v_id;
  return v_id;
end $function$;

-- public.record_provider_cost_rate: cost.manage
CREATE OR REPLACE FUNCTION public.record_provider_cost_rate(p_provider_key text, p_commercial_meter_id text, p_cost_meter_key text, p_currency text, p_unit_amount_micros bigint, p_effective_from timestamp with time zone, p_source text, p_region text DEFAULT NULL::text, p_direction text DEFAULT NULL::text, p_resource_type text DEFAULT NULL::text, p_effective_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_provider_account_id uuid DEFAULT NULL::uuid, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
  perform app.require_platform_seller('cost.manage');
  if p_effective_from < now() - interval '5 minutes' then
    raise exception 'a new provider rate cannot rewrite the past' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.platform_provider_rates r
     where r.provider_key = p_provider_key and r.cost_meter_key = p_cost_meter_key
       and r.currency = upper(btrim(p_currency))
       and coalesce(r.region, '') = coalesce(nullif(btrim(p_region), ''), '')
       and coalesce(r.direction, '') = coalesce(p_direction, '')
       and coalesce(r.resource_type, '') = coalesce(nullif(btrim(p_resource_type), ''), '')
       and r.provider_account_id is not distinct from p_provider_account_id
       and r.effective_from = p_effective_from
       and r.unit_amount_micros = p_unit_amount_micros
  ) then
    select r.id into v_id from public.platform_provider_rates r
     where r.provider_key = p_provider_key and r.cost_meter_key = p_cost_meter_key
       and r.currency = upper(btrim(p_currency)) and r.effective_from = p_effective_from
     limit 1;
    return v_id;
  end if;
  insert into public.platform_provider_rates (
    provider_key, meter_id, cost_meter_key, currency, unit_amount_micros, effective_from,
    effective_to, approval_state, source, recorded_by, note, region, direction,
    resource_type, provider_account_id)
  values (p_provider_key, p_commercial_meter_id, p_cost_meter_key, upper(btrim(p_currency)),
    p_unit_amount_micros, p_effective_from, p_effective_to, 'approved', p_source,
    auth.uid(), coalesce(p_note, ''), nullif(btrim(p_region), ''), p_direction,
    nullif(btrim(p_resource_type), ''), p_provider_account_id)
  returning id into v_id;
  return v_id;
end $function$;

-- public.record_provider_rate: cost.manage
CREATE OR REPLACE FUNCTION public.record_provider_rate(p_provider_key text, p_meter_id text, p_currency text, p_unit_amount_micros bigint, p_source text, p_source_url text DEFAULT NULL::text, p_approval_state text DEFAULT 'approved'::text, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff uuid := (select auth.uid());
  v_name  text;
  v_id    uuid;
begin
  v_name := app.require_platform_seller('cost.manage');

  if p_approval_state not in ('draft', 'approved') then
    raise exception 'unknown approval state: %', p_approval_state using errcode = '22023';
  end if;

  insert into public.platform_provider_rates
    (provider_key, meter_id, currency, unit_amount_micros, approval_state, source, source_url, recorded_by, note)
  values
    (p_provider_key, p_meter_id, upper(btrim(p_currency)), p_unit_amount_micros, p_approval_state, p_source, p_source_url, v_staff, p_note)
  returning id into v_id;

  return v_id;
end;
$function$;

-- public.record_usage_reconciliation: cost.manage
CREATE OR REPLACE FUNCTION public.record_usage_reconciliation(p_usage_event_id uuid, p_reconciled_provider_cost_micros bigint, p_provider_currency text, p_source text, p_provider_reference text DEFAULT ''::text, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff uuid := (select auth.uid());
  v_org   uuid;
  v_id    uuid;
begin
  perform app.require_platform_seller('cost.manage');

  select u.organization_id into v_org
    from public.usage_events u
   where u.id = p_usage_event_id;

  if v_org is null then
    raise exception 'no such usage event' using errcode = '23503';
  end if;

  insert into public.usage_cost_reconciliations
    (organization_id, usage_event_id, reconciled_provider_cost_micros, provider_currency,
     provider_reference, source, recorded_by, note)
  values
    (v_org, p_usage_event_id, p_reconciled_provider_cost_micros, upper(btrim(p_provider_currency)),
     p_provider_reference, p_source, v_staff, p_note)
  returning id into v_id;

  return v_id;
end;
$function$;

-- public.save_commercial_draft_scenario: cost.manage
CREATE OR REPLACE FUNCTION public.save_commercial_draft_scenario(p_scenario_id uuid, p_name text, p_notes text, p_plan_id uuid, p_currency text, p_candidate_prices_minor bigint[], p_expected_seats numeric, p_expected_resource_count numeric, p_inputs jsonb DEFAULT '[]'::jsonb, p_addon_plan_ids uuid[] DEFAULT '{}'::uuid[], p_direct_costs jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_scenario uuid; v_version uuid; v_revision integer; v_item jsonb; v_addon uuid;
begin
  perform app.require_platform_seller('cost.manage');
  if not exists (select 1 from public.platform_plans where id=p_plan_id and kind='plan') then
    raise exception 'draft scenario requires a canonical base Plan' using errcode='23503';
  end if;
  if p_scenario_id is null then
    insert into public.commercial_draft_scenarios(name,notes,created_by)
    values (btrim(p_name),coalesce(p_notes,''),(select auth.uid())) returning id into v_scenario;
  else
    update public.commercial_draft_scenarios set name=btrim(p_name),notes=coalesce(p_notes,'')
     where id=p_scenario_id and archived_at is null returning id into v_scenario;
    if v_scenario is null then raise exception 'no active draft scenario' using errcode='P0002'; end if;
  end if;
  select coalesce(max(revision),0)+1 into v_revision from public.commercial_draft_scenario_versions where scenario_id=v_scenario;
  insert into public.commercial_draft_scenario_versions
    (scenario_id,revision,plan_id,currency,candidate_prices_minor,expected_seats,expected_resource_count,recorded_by)
  values
    (v_scenario,v_revision,p_plan_id,upper(btrim(p_currency)),p_candidate_prices_minor,p_expected_seats,p_expected_resource_count,(select auth.uid()))
  returning id into v_version;
  for v_item in select value from jsonb_array_elements(coalesce(p_inputs,'[]'::jsonb)) loop
    insert into public.commercial_draft_scenario_inputs(version_id,allowance_key,meter_id,expected_quantity,utilization)
    values (v_version,v_item->>'allowanceKey',nullif(v_item->>'meterId',''),
            nullif(v_item->>'expectedQuantity','')::numeric,nullif(v_item->>'utilization','')::numeric);
  end loop;
  foreach v_addon in array coalesce(p_addon_plan_ids,'{}'::uuid[]) loop
    if not exists (select 1 from public.platform_plans where id=v_addon and kind='addon') then
      raise exception 'selected add-on is not canonical' using errcode='23503';
    end if;
    insert into public.commercial_draft_scenario_addons(version_id,addon_plan_id) values(v_version,v_addon);
  end loop;
  for v_item in select value from jsonb_array_elements(coalesce(p_direct_costs,'[]'::jsonb)) loop
    insert into public.commercial_draft_scenario_direct_costs(version_id,label,amount_minor,currency,note)
    values(v_version,v_item->>'label',(v_item->>'amountMinor')::bigint,upper(v_item->>'currency'),coalesce(v_item->>'note',''));
  end loop;
  return v_scenario;
end $function$;

-- public.set_meter_cost_model_component: cost.manage
CREATE OR REPLACE FUNCTION public.set_meter_cost_model_component(p_meter_id text, p_component_key text, p_provider_key text, p_cost_meter_key text, p_quantity_multiplier numeric, p_region text DEFAULT NULL::text, p_direction text DEFAULT NULL::text, p_resource_type text DEFAULT NULL::text, p_required boolean DEFAULT true, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
  perform app.require_platform_seller('cost.manage');
  insert into public.platform_meter_cost_model_components
    (meter_id,component_key,provider_key,cost_meter_key,quantity_multiplier,region,direction,resource_type,required,note,updated_by)
  values
    (p_meter_id,p_component_key,p_provider_key,p_cost_meter_key,p_quantity_multiplier,nullif(btrim(p_region),''),p_direction,nullif(btrim(p_resource_type),''),p_required,p_note,(select auth.uid()))
  on conflict (meter_id,component_key) do update set
    provider_key=excluded.provider_key,cost_meter_key=excluded.cost_meter_key,
    quantity_multiplier=excluded.quantity_multiplier,region=excluded.region,direction=excluded.direction,
    resource_type=excluded.resource_type,required=excluded.required,note=excluded.note,
    updated_at=now(),updated_by=excluded.updated_by
  returning id into v_id;
  return v_id;
end $function$;

-- public.bootstrap_gold_internal_workspace: designating the operating organization is provisioning alone
CREATE OR REPLACE FUNCTION public.bootstrap_gold_internal_workspace(p_organization_id uuid, p_role text, p_capabilities text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_plan uuid;
  v_operating uuid;
  v_designated boolean := false;
  v_plan_assigned boolean := false;
  v_current_plan uuid;
  v_role uuid;
  v_membership uuid;
  v_display_name text;
  v_role_name text := coalesce(nullif(btrim(p_role), ''), 'Admin');
  v_capabilities text[];
  v_existing_named_role uuid;
  v_existing_internal_role uuid;
begin
  perform app.require_platform_capability('platform.organizations');

  if v_actor is null then
    raise exception 'bootstrap_gold_internal_workspace requires an authenticated caller'
      using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct capability order by capability), '{}'::text[])
    into v_capabilities
    from unnest(coalesce(p_capabilities, '{}'::text[])) as capability;

  if cardinality(v_capabilities) = 0 then
    raise exception 'bootstrap_gold_internal_workspace requires canonical capabilities'
      using errcode = '23514';
  end if;

  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'no such organization: %', p_organization_id
      using errcode = '23503';
  end if;

  select id into v_plan
    from public.platform_plans
   where key = 'gold_internal'
     and kind = 'plan';

  if v_plan is null then
    raise exception 'gold_internal plan is not installed'
      using errcode = '23503';
  end if;

  -- Locked so two concurrent first bootstraps cannot both see an unset identity.
  select ps.operating_organization_id into v_operating
    from public.platform_settings ps
   where ps.singleton
     for update;

  if not found then
    raise exception 'platform_settings has no singleton row' using errcode = '55000';
  end if;

  if v_operating is not null and v_operating <> p_organization_id then
    raise exception 'another organization is already the GildOps operating organization'
      using errcode = '23505';
  end if;

  select opa.plan_id into v_current_plan
    from public.organization_plan_assignments opa
   where opa.organization_id = p_organization_id
     and opa.plan_kind = 'plan'
     and opa.period_start <= current_date
     and opa.period_end > current_date
   order by opa.period_start desc
   limit 1;

  if v_operating is null then
    -- A business already on another base Plan is a customer, not an empty organization made for
    -- GildOps. Refuse rather than make it GildOps permanently by mistake.
    if v_current_plan is not null and v_current_plan <> v_plan then
      raise exception 'target organization already has a conflicting current base Plan'
        using errcode = '23P01';
    end if;

    update public.platform_settings
       set operating_organization_id = p_organization_id
     where singleton;
    v_designated := true;
  end if;

  -- Once designated, the operating organization's Plan is a subscription its own Finance
  -- records (ADR-057). A Plan already in place is left alone.
  if v_current_plan is null then
    insert into public.organization_plan_assignments
      (organization_id, plan_id, plan_kind, period_start, period_end, assigned_by, note)
    values
      (p_organization_id, v_plan, 'plan', current_date, '9999-12-31'::date, v_actor,
       'GildOps operating organization bootstrap');
    v_plan_assigned := true;
  end if;

  select id into v_role
    from public.roles
   where organization_id = p_organization_id
     and capabilities @> v_capabilities
     and v_capabilities @> capabilities
   order by created_at
   limit 1;

  if v_role is null then
    select id into v_existing_named_role
      from public.roles
     where organization_id = p_organization_id
       and lower(name) = lower(v_role_name)
     limit 1;

    if v_existing_named_role is null then
      insert into public.roles (organization_id, name, capabilities, created_by)
      values (p_organization_id, v_role_name, v_capabilities, v_actor)
      returning id into v_role;
    else
      select id into v_existing_internal_role
        from public.roles
       where organization_id = p_organization_id
         and lower(name) = lower('GildOps Admin')
       limit 1;

      if v_existing_internal_role is not null then
        raise exception 'A GildOps Admin role already exists with different permissions.'
          using errcode = '23505';
      end if;

      insert into public.roles (organization_id, name, capabilities, created_by)
      values (p_organization_id, 'GildOps Admin', v_capabilities, v_actor)
      returning id into v_role;
    end if;
  end if;

  select coalesce(nullif(btrim(u.email), ''), 'GildOps staff') into v_display_name
    from auth.users u
   where u.id = v_actor;

  insert into public.memberships
    (organization_id, user_id, role_id, display_name, created_by)
  values
    (p_organization_id, v_actor, v_role, left(v_display_name, 120), v_actor)
  on conflict (organization_id, user_id) do update
    set role_id = excluded.role_id,
        display_name = excluded.display_name
  returning id into v_membership;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'organization', p_organization_id, 'gold_internal.bootstrap',
     jsonb_build_object(
       'membership_id', v_membership,
       'role_id', v_role,
       'operating_organization_designated', v_designated,
       'plan_id', case when v_plan_assigned then v_plan end
     ));

  return v_membership;
end;
$function$;

-- commercial_draft_scenario_addons: cost.read
drop policy commercial_draft_scenario_addons_staff_select on public.commercial_draft_scenario_addons;
create policy commercial_draft_scenario_addons_staff_select on public.commercial_draft_scenario_addons as permissive for select to authenticated
  using (( SELECT app.platform_seller_has('cost.read') AS seller_permission));

-- commercial_draft_scenario_direct_costs: cost.read
drop policy commercial_draft_scenario_direct_costs_staff_select on public.commercial_draft_scenario_direct_costs;
create policy commercial_draft_scenario_direct_costs_staff_select on public.commercial_draft_scenario_direct_costs as permissive for select to authenticated
  using (( SELECT app.platform_seller_has('cost.read') AS seller_permission));

-- commercial_draft_scenario_inputs: cost.read
drop policy commercial_draft_scenario_inputs_staff_select on public.commercial_draft_scenario_inputs;
create policy commercial_draft_scenario_inputs_staff_select on public.commercial_draft_scenario_inputs as permissive for select to authenticated
  using (( SELECT app.platform_seller_has('cost.read') AS seller_permission));

-- commercial_draft_scenario_versions: cost.read
drop policy commercial_draft_scenario_versions_staff_select on public.commercial_draft_scenario_versions;
create policy commercial_draft_scenario_versions_staff_select on public.commercial_draft_scenario_versions as permissive for select to authenticated
  using (( SELECT app.platform_seller_has('cost.read') AS seller_permission));

-- commercial_draft_scenarios: cost.read
drop policy commercial_draft_scenarios_staff_select on public.commercial_draft_scenarios;
create policy commercial_draft_scenarios_staff_select on public.commercial_draft_scenarios as permissive for select to authenticated
  using (( SELECT app.platform_seller_has('cost.read') AS seller_permission));

-- organization_charge_components: subscription.read
drop policy organization_charge_components_select on public.organization_charge_components;
create policy organization_charge_components_select on public.organization_charge_components as permissive for select to authenticated
  using (((organization_id IN ( SELECT app.current_tenant_ids() AS current_tenant_ids)) OR ( SELECT app.platform_seller_has('subscription.read') AS seller_permission)));

-- organization_commercial_adjustments: subscription.read
drop policy organization_commercial_adjustments_select on public.organization_commercial_adjustments;
create policy organization_commercial_adjustments_select on public.organization_commercial_adjustments as permissive for select to authenticated
  using (((organization_id IN ( SELECT app.current_tenant_ids() AS current_tenant_ids)) OR ( SELECT app.platform_seller_has('subscription.read') AS seller_permission)));

-- organization_commercial_terms: subscription.read
drop policy organization_commercial_terms_platform_select on public.organization_commercial_terms;
create policy organization_commercial_terms_platform_select on public.organization_commercial_terms as permissive for select to authenticated
  using (( SELECT app.platform_seller_has('subscription.read') AS seller_permission));

-- organization_credits: subscription.read
drop policy organization_credits_platform_select on public.organization_credits;
create policy organization_credits_platform_select on public.organization_credits as permissive for select to authenticated
  using (( SELECT app.platform_seller_has('subscription.read') AS seller_permission));

-- organization_plan_agreement_provider_prices: subscription.read
drop policy organization_plan_agreement_provider_prices_select on public.organization_plan_agreement_provider_prices;
create policy organization_plan_agreement_provider_prices_select on public.organization_plan_agreement_provider_prices as permissive for select to authenticated
  using (( SELECT app.platform_seller_has('subscription.read') AS seller_permission));

-- organization_plan_agreements: subscription.read
drop policy organization_plan_agreements_select on public.organization_plan_agreements;
create policy organization_plan_agreements_select on public.organization_plan_agreements as permissive for select to authenticated
  using (((organization_id IN ( SELECT app.current_tenant_ids() AS current_tenant_ids)) OR ( SELECT app.platform_seller_has('subscription.read') AS seller_permission)));

-- organization_plan_assignments: subscription.read
drop policy organization_plan_assignments_select on public.organization_plan_assignments;
create policy organization_plan_assignments_select on public.organization_plan_assignments as permissive for select to authenticated
  using (((organization_id IN ( SELECT app.current_tenant_ids() AS current_tenant_ids)) OR ( SELECT app.platform_seller_has('subscription.read') AS seller_permission)));

-- organization_plan_quota_overrides: subscription.read
drop policy organization_plan_quota_overrides_select on public.organization_plan_quota_overrides;
create policy organization_plan_quota_overrides_select on public.organization_plan_quota_overrides as permissive for select to authenticated
  using (((organization_id IN ( SELECT app.current_tenant_ids() AS current_tenant_ids)) OR ( SELECT app.platform_seller_has('subscription.read') AS seller_permission)));

-- organization_platform_subscription_items: subscription.read
drop policy organization_platform_subscription_items_select on public.organization_platform_subscription_items;
create policy organization_platform_subscription_items_select on public.organization_platform_subscription_items as permissive for select to authenticated
  using (((organization_id IN ( SELECT app.current_tenant_ids() AS current_tenant_ids)) OR ( SELECT app.platform_seller_has('subscription.read') AS seller_permission)));

-- organization_platform_subscriptions: subscription.read
drop policy organization_platform_subscriptions_select on public.organization_platform_subscriptions;
create policy organization_platform_subscriptions_select on public.organization_platform_subscriptions as permissive for select to authenticated
  using (((organization_id IN ( SELECT app.current_tenant_ids() AS current_tenant_ids)) OR ( SELECT app.platform_seller_has('subscription.read') AS seller_permission)));

-- organizations: subscription.read
drop policy organizations_platform_select on public.organizations;
create policy organizations_platform_select on public.organizations as permissive for select to authenticated
  using (( SELECT (( SELECT app.has_platform_capability('platform.organizations'::text) AS has_platform_capability) OR ( SELECT app.has_platform_capability('platform.providers'::text) AS has_platform_capability) OR ( SELECT app.platform_seller_has('subscription.read') AS seller_permission) OR ( SELECT app.has_platform_capability('platform.health'::text) AS has_platform_capability)) AS is_platform_staff));

-- platform_billing_checkout_sessions: subscription.read
drop policy platform_billing_checkout_sessions_select on public.platform_billing_checkout_sessions;
create policy platform_billing_checkout_sessions_select on public.platform_billing_checkout_sessions as permissive for select to authenticated
  using (((organization_id IN ( SELECT app.current_tenant_ids() AS current_tenant_ids)) OR ( SELECT app.platform_seller_has('subscription.read') AS seller_permission)));

-- platform_billing_customers: subscription.read
drop policy platform_billing_customers_select on public.platform_billing_customers;
create policy platform_billing_customers_select on public.platform_billing_customers as permissive for select to authenticated
  using (((organization_id IN ( SELECT app.current_tenant_ids() AS current_tenant_ids)) OR ( SELECT app.platform_seller_has('subscription.read') AS seller_permission)));

-- platform_billing_webhook_events: subscription.read
drop policy platform_billing_webhook_events_select on public.platform_billing_webhook_events;
create policy platform_billing_webhook_events_select on public.platform_billing_webhook_events as permissive for select to authenticated
  using (( SELECT app.platform_seller_has('subscription.read') AS seller_permission));

-- platform_fx_rates: cost.read
drop policy platform_fx_rates_staff_select on public.platform_fx_rates;
create policy platform_fx_rates_staff_select on public.platform_fx_rates as permissive for select to authenticated
  using (( SELECT app.platform_seller_has('cost.read') AS seller_permission));

-- platform_infrastructure_cost_components: cost.read
drop policy platform_infrastructure_cost_components_staff_select on public.platform_infrastructure_cost_components;
create policy platform_infrastructure_cost_components_staff_select on public.platform_infrastructure_cost_components as permissive for select to authenticated
  using (( SELECT app.platform_seller_has('cost.read') AS seller_permission));

-- platform_meter_cost_model_components: cost.read
drop policy platform_meter_cost_model_components_staff_select on public.platform_meter_cost_model_components;
create policy platform_meter_cost_model_components_staff_select on public.platform_meter_cost_model_components as permissive for select to authenticated
  using (( SELECT app.platform_seller_has('cost.read') AS seller_permission));

-- platform_plan_cost_assumptions: cost.read
drop policy platform_plan_cost_assumptions_staff_select on public.platform_plan_cost_assumptions;
create policy platform_plan_cost_assumptions_staff_select on public.platform_plan_cost_assumptions as permissive for select to authenticated
  using (( SELECT app.platform_seller_has('cost.read') AS seller_permission));

-- platform_plan_feature_grants: app.platform_seller_member()
drop policy platform_plan_feature_grants_select on public.platform_plan_feature_grants;
create policy platform_plan_feature_grants_select on public.platform_plan_feature_grants as permissive for select to authenticated
  using ((( SELECT app.is_organization_member() AS is_organization_member)));

-- platform_plan_margin_policies: cost.read
drop policy platform_plan_margin_policies_staff_select on public.platform_plan_margin_policies;
create policy platform_plan_margin_policies_staff_select on public.platform_plan_margin_policies as permissive for select to authenticated
  using (( SELECT app.platform_seller_has('cost.read') AS seller_permission));

-- platform_plan_module_grants: app.platform_seller_member()
drop policy platform_plan_module_grants_select on public.platform_plan_module_grants;
create policy platform_plan_module_grants_select on public.platform_plan_module_grants as permissive for select to authenticated
  using ((( SELECT app.is_organization_member() AS is_organization_member)));

-- platform_plan_product_grants: app.platform_seller_member()
drop policy platform_plan_product_grants_select on public.platform_plan_product_grants;
create policy platform_plan_product_grants_select on public.platform_plan_product_grants as permissive for select to authenticated
  using ((( SELECT app.is_organization_member() AS is_organization_member)));

-- platform_plan_quotas: app.platform_seller_member()
drop policy platform_plan_quotas_select on public.platform_plan_quotas;
create policy platform_plan_quotas_select on public.platform_plan_quotas as permissive for select to authenticated
  using ((( SELECT app.is_organization_member() AS is_organization_member)));

-- platform_plan_utilization_assumptions: cost.read
drop policy platform_plan_utilization_assumptions_staff_select on public.platform_plan_utilization_assumptions;
create policy platform_plan_utilization_assumptions_staff_select on public.platform_plan_utilization_assumptions as permissive for select to authenticated
  using (( SELECT app.platform_seller_has('cost.read') AS seller_permission));

-- platform_plans: app.platform_seller_member()
drop policy platform_plans_select on public.platform_plans;
create policy platform_plans_select on public.platform_plans as permissive for select to authenticated
  using ((( SELECT app.is_organization_member() AS is_organization_member)));

-- platform_provider_cost_meters: cost.read
drop policy platform_provider_cost_meters_staff_select on public.platform_provider_cost_meters;
create policy platform_provider_cost_meters_staff_select on public.platform_provider_cost_meters as permissive for select to authenticated
  using (( SELECT app.platform_seller_has('cost.read') AS seller_permission));

-- platform_provider_rates: cost.read
drop policy platform_provider_rates_platform_select on public.platform_provider_rates;
create policy platform_provider_rates_platform_select on public.platform_provider_rates as permissive for select to authenticated
  using (( SELECT app.platform_seller_has('cost.read') AS seller_permission));

-- platform_providers: cost.read
drop policy platform_providers_platform_select on public.platform_providers;
create policy platform_providers_platform_select on public.platform_providers as permissive for select to authenticated
  using (( SELECT (( SELECT app.has_platform_capability('platform.providers'::text) AS has_platform_capability) OR ( SELECT app.has_platform_capability('platform.catalogue'::text) AS has_platform_capability) OR ( SELECT app.platform_seller_has('cost.read') AS seller_permission)) AS is_platform_staff));

-- platform_retail_rates: subscription.read
drop policy platform_retail_rates_select on public.platform_retail_rates;
create policy platform_retail_rates_select on public.platform_retail_rates as permissive for select to authenticated
  using ((( SELECT app.platform_seller_has('subscription.read') AS seller_permission) OR (( SELECT app.is_organization_member() AS is_organization_member) AND ((organization_id IS NULL) OR (organization_id IN ( SELECT app.current_tenant_ids() AS current_tenant_ids))))));

-- price_book_item_addons: app.platform_seller_member()
drop policy price_book_item_addons_select on public.price_book_item_addons;
create policy price_book_item_addons_select on public.price_book_item_addons as permissive for select to authenticated
  using (((organization_id IN ( SELECT app.current_tenant_ids() AS current_tenant_ids)) OR ((plan_id IS NOT NULL) AND ( SELECT app.is_organization_member() AS is_organization_member))));

-- price_book_item_prices: app.platform_seller_member()
drop policy price_book_item_prices_select on public.price_book_item_prices;
create policy price_book_item_prices_select on public.price_book_item_prices as permissive for select to authenticated
  using (((organization_id IN ( SELECT app.current_tenant_ids() AS current_tenant_ids)) OR ((plan_id IS NOT NULL) AND ( SELECT app.is_organization_member() AS is_organization_member))));

-- usage_cost_component_adjustments: cost.read
drop policy usage_cost_component_adjustments_staff_select on public.usage_cost_component_adjustments;
create policy usage_cost_component_adjustments_staff_select on public.usage_cost_component_adjustments as permissive for select to authenticated
  using (( SELECT app.platform_seller_has('cost.read') AS seller_permission));

-- usage_cost_components: cost.read
drop policy usage_cost_components_staff_select on public.usage_cost_components;
create policy usage_cost_components_staff_select on public.usage_cost_components as permissive for select to authenticated
  using (( SELECT app.platform_seller_has('cost.read') AS seller_permission));


-- The business names Finance shows beside a subscription or a cost.
create or replace view public.platform_tenants with (security_invoker = true) as
 SELECT id,
    name,
    created_at,
    timezone,
    currency,
    slug,
    COALESCE(( SELECT array_agg(m.module_key ORDER BY m.module_key) AS array_agg
           FROM organization_modules m
          WHERE (m.organization_id = o.id)), ARRAY[]::text[]) AS module_keys,
    ( SELECT max(e.occurred_at) AS max
           FROM events e
          WHERE (e.organization_id = o.id)) AS last_activity_at,
    operational_state
   FROM organizations o
  WHERE ( SELECT (( SELECT app.has_platform_capability('platform.organizations'::text) AS has_platform_capability)
               OR ( SELECT app.has_platform_capability('platform.providers'::text) AS has_platform_capability)
               OR ( SELECT app.has_platform_capability('platform.health'::text) AS has_platform_capability)
               OR ( SELECT app.platform_seller_has('subscription.read') AS seller_permission)
               OR ( SELECT app.platform_seller_has('cost.read') AS seller_permission)) AS may_read);

-- Comments that named the retired permission.
comment on function public.record_commercial_term(uuid, text, date, date, bigint, text, integer, text) is
  'The only way to write a term. Needs subscription.manage in GildOps'' operating Organization, SECURITY DEFINER, no table grant behind it (I21''s shape). Writes one events row on the tenant it concerns.';
comment on function public.record_plan_assignment(uuid, uuid, date, date, text) is
  'Records which Plan/Add-on package an organization has for a period. Needs subscription.manage in GildOps'' operating Organization; platform staff status is not an input. Writes no row to organization_modules or organization_commercial_terms -- see 20260918000001''s header for why.';
comment on function public.record_plan_quota_override(uuid, uuid, text, numeric, numeric, timestamptz, text) is
  'What this organization''s allowance is, where it differs from its Plan''s. Append-only; needs subscription.manage in GildOps'' operating Organization.';
comment on function public.bootstrap_gold_internal_workspace(uuid, text, text[]) is
  'Platform-staff door (platform.organizations) that designates GildOps'' operating organization once, or confirms it, then assigns the non-billable internal Plan only when no base Plan is current and creates or repairs the caller''s own membership with the canonical founding capabilities. Refuses any other organization once one is designated.';
comment on function public.record_organization_plan_agreement(uuid, uuid, text, bigint, timestamptz, timestamptz, text) is
  'The negotiated price this organization pays for one Plan it holds. Needs subscription.manage in GildOps'' operating Organization.';
comment on function public.hand_off_accepted_proposal(uuid) is
  'Create this business in GildOps, atomically: provisioning, entitling it to the accepted Plan and Add-ons, and recording the handoff either all happen or none do, and a repeat call is a no-op that returns the business already created. Staff-only, checked live -- closing a sale is a salesperson''s act and deliberately does not need subscription.manage, which guards Finance''s doors onto the same writes.';
comment on function public.record_infrastructure_cost(text, text, date, bigint, text, text, uuid, text, uuid, uuid, uuid, bigint, text, uuid, numeric, text, numeric, text, text) is
  'The only writer of platform_infrastructure_cost_components. Needs cost.manage in GildOps'' operating Organization.';
comment on function public.record_commercial_adjustment(uuid, text, bigint, text, text, timestamptz) is
  'The only writer of organization_commercial_adjustments. Needs subscription.manage in GildOps'' operating Organization.';
comment on function public.compose_organization_charges(uuid, timestamptz, timestamptz) is
  'Composes (or idempotently refreshes) every charge component for one organization and billing period. A component kind whose commercial assignments disagree mid-period is skipped and reported as proration_required rather than guessed. Needs subscription.manage in GildOps'' operating Organization. Running twice never duplicates a component, and a finalized component is never rewritten.';
comment on function public.record_agreement_provider_price(uuid, text, text, text, text) is
  'Processor representation of one negotiated price (one agreement). Needs subscription.manage in GildOps'' operating Organization. Idempotent; never rewrites a mapping.';

-- Entitlement records are Administration's as well as Finance's: which plan a business holds, what
-- that plan switches on and the billing provider's status that decides whether service is locked.
-- Staff who run businesses (`platform.organizations`) read them to enforce and explain access, and
-- Product Registry (`platform.catalogue`) reads the plans it shapes. Agreed prices, charges,
-- credits, terms and costs stay with Finance's permissions alone.
drop policy organization_plan_assignments_select on public.organization_plan_assignments;
create policy organization_plan_assignments_select on public.organization_plan_assignments as permissive for select to authenticated
  using (((organization_id IN ( SELECT app.current_tenant_ids() AS current_tenant_ids))
       OR ( SELECT app.platform_seller_has('subscription.read') AS seller_permission)
       OR ( SELECT app.has_platform_capability('platform.organizations') AS has_platform_capability)));
drop policy organization_platform_subscriptions_select on public.organization_platform_subscriptions;
create policy organization_platform_subscriptions_select on public.organization_platform_subscriptions as permissive for select to authenticated
  using (((organization_id IN ( SELECT app.current_tenant_ids() AS current_tenant_ids))
       OR ( SELECT app.platform_seller_has('subscription.read') AS seller_permission)
       OR ( SELECT app.has_platform_capability('platform.organizations') AS has_platform_capability)));
drop policy platform_plans_select on public.platform_plans;
create policy platform_plans_select on public.platform_plans as permissive for select to authenticated
  using ((( SELECT app.is_organization_member() AS is_organization_member)
       OR ( SELECT app.has_platform_capability('platform.organizations') AS has_platform_capability)
       OR ( SELECT app.has_platform_capability('platform.catalogue') AS has_platform_capability)));
drop policy platform_plan_product_grants_select on public.platform_plan_product_grants;
create policy platform_plan_product_grants_select on public.platform_plan_product_grants as permissive for select to authenticated
  using ((( SELECT app.is_organization_member() AS is_organization_member)
       OR ( SELECT app.has_platform_capability('platform.organizations') AS has_platform_capability)
       OR ( SELECT app.has_platform_capability('platform.catalogue') AS has_platform_capability)));
drop policy platform_plan_module_grants_select on public.platform_plan_module_grants;
create policy platform_plan_module_grants_select on public.platform_plan_module_grants as permissive for select to authenticated
  using ((( SELECT app.is_organization_member() AS is_organization_member)
       OR ( SELECT app.has_platform_capability('platform.organizations') AS has_platform_capability)
       OR ( SELECT app.has_platform_capability('platform.catalogue') AS has_platform_capability)));
drop policy platform_plan_feature_grants_select on public.platform_plan_feature_grants;
create policy platform_plan_feature_grants_select on public.platform_plan_feature_grants as permissive for select to authenticated
  using ((( SELECT app.is_organization_member() AS is_organization_member)
       OR ( SELECT app.has_platform_capability('platform.organizations') AS has_platform_capability)
       OR ( SELECT app.has_platform_capability('platform.catalogue') AS has_platform_capability)));
drop policy platform_plan_quotas_select on public.platform_plan_quotas;
create policy platform_plan_quotas_select on public.platform_plan_quotas as permissive for select to authenticated
  using ((( SELECT app.is_organization_member() AS is_organization_member)
       OR ( SELECT app.has_platform_capability('platform.organizations') AS has_platform_capability)
       OR ( SELECT app.has_platform_capability('platform.catalogue') AS has_platform_capability)));

-- A usage price is appended, never rewritten backwards: the rule the retired retail-rate door
-- enforced carries over to the Finance door that replaced it.
CREATE OR REPLACE FUNCTION public.record_item_usage_price(p_organization_id uuid, p_item_id uuid, p_meter_id text, p_currency text, p_unit_amount_micros bigint, p_effective_from timestamp with time zone DEFAULT now(), p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if coalesce(p_effective_from, now()) < now() - interval '1 minute' then
    raise exception 'A usage price cannot start in the past: a price is appended, never rewritten backwards.' using errcode = '22023';
  end if;
  insert into public.platform_retail_rates
    (meter_id, currency, unit_amount_micros, effective_from, approval_state, source, recorded_by, note, plan_id)
  values (p_meter_id, upper(btrim(p_currency)), p_unit_amount_micros, coalesce(p_effective_from, now()), 'approved',
          'finance', v_actor, coalesce(p_note, ''), v_plan)
  returning id into v_id;
  return v_id;
end $function$;

-- Billing-webhook delivery health is Administration's reliability view as well: event, time,
-- environment and reconciliation state, no amounts.
drop policy platform_billing_webhook_events_select on public.platform_billing_webhook_events;
create policy platform_billing_webhook_events_select on public.platform_billing_webhook_events as permissive for select to authenticated
  using (( SELECT app.platform_seller_has('subscription.read') AS seller_permission)
      OR ( SELECT app.has_platform_capability('platform.health') AS has_platform_capability));

-- 4. Superseded doors.
drop function public.create_plan(text, text, text, text, boolean, text, integer);
drop function public.record_plan_price(uuid, text, bigint, text, timestamptz, text, text, text);
drop function public.record_plan_provider_price(uuid, text, text, text, text);
drop function public.attach_plan_addon(uuid, uuid, boolean);
drop function public.detach_plan_addon(uuid, uuid);
drop function public.update_plan(uuid, text, text, boolean, text, integer);
drop function public.record_commercial_retail_rate(text, text, bigint, timestamptz, text, uuid, uuid, text, timestamptz, text, text);
drop function public.record_retail_rate(text, text, bigint, text, text, text, text, timestamptz);
drop function public.record_product_price(text, text, bigint, text, timestamptz, text, text, text);
drop function public.record_plan_agreement(uuid, uuid, text, bigint, timestamptz, text);
drop function public.record_phone_number_month(uuid, date);
drop table public.platform_product_prices;
drop view public.platform_plan_prices;
drop view public.platform_plan_provider_prices;
drop view public.platform_plan_addons;

-- 5. A GildOps plan or add-on is created in GildOps' Finance, as a recurring item. The plan
--    record it sells (what it switches on) is made with it, empty, and filled in Product
--    Registry's section of the same item. Only the operating Organization sells GildOps plans.
create function public.create_plan_item(
  p_organization_id uuid,
  p_kind text,
  p_name text,
  p_description text default '',
  p_billable boolean default true
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_price_manager(p_organization_id);
  v_name text := btrim(coalesce(p_name, ''));
  v_base text;
  v_key text;
  v_n integer := 1;
  v_plan uuid;
  v_item uuid;
begin
  if p_organization_id is distinct from app.operating_organization_id() then
    raise exception 'Only the business that sells GildOps creates GildOps plans.' using errcode = '42501';
  end if;
  if p_kind not in ('plan', 'addon') then
    raise exception 'Choose a plan or an add-on.' using errcode = '22023';
  end if;
  if length(v_name) < 1 or length(v_name) > 120 then
    raise exception 'Name the plan in 1 to 120 characters.' using errcode = '22023';
  end if;
  if exists (select 1 from public.price_book_items x
              where x.organization_id = p_organization_id and lower(btrim(x.name)) = lower(v_name)) then
    raise exception 'Another item is already called %.', v_name using errcode = '23505';
  end if;

  -- The plan's key is its stable technical name, taken from the first name it was given.
  v_base := left(regexp_replace(regexp_replace(lower(v_name), '[^a-z0-9]+', '_', 'g'), '^_+|_+$', '', 'g'), 50);
  if v_base !~ '^[a-z]' then v_base := 'plan_' || v_base; end if;
  if length(v_base) < 2 then v_base := v_base || '_plan'; end if;
  v_key := v_base;
  while exists (select 1 from public.platform_plans where key = v_key) loop
    v_n := v_n + 1;
    v_key := v_base || '_' || v_n;
  end loop;

  insert into public.platform_plans (key, kind, label, description, billable, sale_status, display_order, created_by)
  values (v_key, p_kind, v_name, coalesce(p_description, ''), coalesce(p_billable, true), 'unlisted',
          coalesce((select max(display_order) + 1 from public.platform_plans where kind = p_kind), 0), v_actor)
  returning id into v_plan;

  -- `platform_plans_catalog_item_on_create` has given it its recurring item.
  select price_book_item_id into v_item from public.platform_plans where id = v_plan;
  if v_item is null then
    raise exception 'The plan''s catalog item was not created.' using errcode = 'P0001';
  end if;
  return v_item;
end $$;
comment on function public.create_plan_item(uuid, text, text, text, boolean) is
  'Creates a GildOps plan or add-on as a recurring item of the operating Organization''s price book (ADR-057). Pricing permission in that Organization; not offered until someone offers it.';
revoke all on function public.create_plan_item(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.create_plan_item(uuid, text, text, text, boolean) to authenticated;

-- 6. The platform permission is gone.
alter table public.platform_staff drop constraint platform_staff_capabilities_known;
update public.platform_staff set capabilities = array_remove(capabilities, 'platform.commercial')
 where 'platform.commercial' = any (capabilities);
alter table public.platform_staff add constraint platform_staff_capabilities_known
  check (capabilities <@ array['platform.organizations', 'platform.catalogue', 'platform.providers', 'platform.health']::text[]);
alter table public.platform_staff alter column capabilities
  set default array['platform.organizations', 'platform.catalogue', 'platform.providers', 'platform.health']::text[];

-- 7. Finance's GildOps destinations ship with this migration. Subscriptions to platform plans
--    describe reselling the platform, so the feature joins the operator Product that only
--    GildOps' own plan includes; recurring items stay in Gild Finance for every business.
insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
select p.id, 'platform_subscriptions', 'Subscriptions', '', 2
  from public.platform_catalog_products p where p.key = 'operator'
on conflict (product_id, key) do nothing;

update public.platform_catalog_features f
   set module_id = m.id, packaging_default = 'core', sale_status = 'unlisted'
  from public.platform_catalog_modules m
  join public.platform_catalog_products p on p.id = m.product_id and p.key = 'operator'
 where m.key = 'platform_subscriptions'
   and f.key = 'subscriptions';

update public.platform_catalog_modules m
   set label = 'Recurring items'
  from public.platform_catalog_products p
 where p.id = m.product_id and p.key = 'finance' and m.key = 'subscriptions';

update public.platform_catalog_features
   set implementation_state = 'available'
 where key in ('subscriptions', 'supplier_costs', 'cost_to_serve', 'package_economics');

-- 8. The price book's sold-item tables keep their uniqueness inside the business that owns the
--    row. The indexes and the one plain reference below were carried over from the platform plan
--    tables when `20261120000004` moved those rows into the operating price book; each now leads
--    with `organization_id` like every other tenant-owned table. A row with no owner yet (a plan
--    left behind while no business is designated) still counts as one owner for uniqueness.
--    `platform_plan_provider_prices_reference_unique` stays global on purpose: a processor price
--    reference arrives on a signed event with no business in hand and must name one price.
alter table public.price_book_item_prices drop constraint platform_plan_prices_unique_moment;
create unique index price_book_item_prices_plan_moment on public.price_book_item_prices
  (organization_id, plan_id, currency, billing_interval, effective_from) nulls not distinct
  where plan_id is not null;
drop index public.price_book_item_prices_item_moment;
create unique index price_book_item_prices_item_moment on public.price_book_item_prices
  (organization_id, item_id, currency, billing_interval, effective_from) where item_id is not null;

alter table public.price_book_item_addons drop constraint price_book_item_addons_plan_pair;
create unique index price_book_item_addons_plan_pair on public.price_book_item_addons
  (organization_id, plan_id, addon_plan_id) nulls not distinct
  where plan_id is not null;
alter table public.price_book_item_addons drop constraint price_book_item_addons_item_pair;
create unique index price_book_item_addons_item_pair on public.price_book_item_addons
  (organization_id, item_id, addon_item_id);

alter table public.price_book_item_provider_prices drop constraint platform_plan_provider_prices_unique_moment;
create unique index price_book_item_provider_prices_price_environment on public.price_book_item_provider_prices
  (organization_id, plan_price_id, environment) nulls not distinct;
-- The composite `price_book_item_provider_prices_price_fkey` already holds this reference within
-- one business; the plain one let a mapping point at another business's price. Deleting a price
-- still removes its mappings.
alter table public.price_book_item_provider_prices drop constraint platform_plan_provider_prices_plan_price_id_fkey;
alter table public.price_book_item_provider_prices drop constraint price_book_item_provider_prices_price_fkey;
alter table public.price_book_item_provider_prices add constraint price_book_item_provider_prices_price_fkey
  foreign key (organization_id, plan_price_id) references public.price_book_item_prices (organization_id, id)
  on delete cascade deferrable initially immediate;

-- The two writers that upsert on those keys name the new ones.
do $$
declare
  v_def text;
  v_fn regprocedure;
begin
  foreach v_fn in array array[
    'public.set_item_addon(uuid, uuid, uuid, boolean, boolean)'::regprocedure,
    'public.record_item_provider_price(uuid, uuid, text, text, text, text)'::regprocedure]
  loop
    v_def := pg_get_functiondef(v_fn);
    v_def := replace(v_def, 'on conflict (item_id, addon_item_id)', 'on conflict (organization_id, item_id, addon_item_id)');
    v_def := replace(v_def, 'on conflict (plan_price_id, environment)', 'on conflict (organization_id, plan_price_id, environment)');
    if v_def = pg_get_functiondef(v_fn) then
      raise exception '% has no upsert to rename', v_fn;
    end if;
    execute v_def;
  end loop;
end $$;

-- A trigger function runs for whoever writes the row; nobody calls it directly.
revoke all on function app.expected_cost_matches_item() from public, anon;

-- Which modules a business may use is an entitlement fact Administration reads as well as the
-- business itself. `public.usable_modules` answers it from paid-module terms, which carry prices
-- and are Finance's; this reader returns the module keys alone to the business's members, to
-- platform staff who look after organizations or the catalogue, and to GildOps' own Finance.
-- Anyone else gets nothing, as an unreadable terms table gave them before.
create function public.organization_usable_modules(p_organization_id uuid)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not (p_organization_id in (select app.current_tenant_ids())
       or app.has_platform_capability('platform.organizations')
       or app.has_platform_capability('platform.catalogue')
       or app.platform_seller_has('subscription.read')) then
    return;
  end if;
  return query select m from public.usable_modules(p_organization_id) m;
end $$;
revoke all on function public.organization_usable_modules(uuid) from public, anon;
grant execute on function public.organization_usable_modules(uuid) to authenticated;

-- 9. Verification.
do $$
declare v_left int; v_missing int;
begin
  select count(*) into v_left from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app') and p.prosrc like '%platform.commercial%';
  if v_left > 0 then raise exception '% functions still check platform.commercial', v_left; end if;

  select count(*) into v_left from pg_policies
   where coalesce(qual, '') || coalesce(with_check, '') like '%platform.commercial%';
  if v_left > 0 then raise exception '% policies still check platform.commercial', v_left; end if;

  select count(*) into v_left from pg_views where definition like '%platform.commercial%';
  if v_left > 0 then raise exception '% views still check platform.commercial', v_left; end if;

  select count(*) into v_left from pg_proc where obj_description(oid, 'pg_proc') like '%platform.commercial%';
  if v_left > 0 then raise exception '% function comments still name platform.commercial', v_left; end if;

  select count(*) into v_left from public.platform_staff where 'platform.commercial' = any (capabilities);
  if v_left > 0 then raise exception 'staff rows still name platform.commercial'; end if;
  if (select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'platform_staff' and column_name = 'capabilities') like '%platform.commercial%' then
    raise exception 'the staff permission default still names platform.commercial';
  end if;

  select count(*) into v_missing from public.roles
   where 'subscription.manage' = any (capabilities) and not 'subscription.read' = any (capabilities);
  if v_missing > 0 then raise exception '% roles change subscriptions without reading them', v_missing; end if;

  select count(*) into v_left from public.platform_catalog_features f
    join public.platform_catalog_modules m on m.id = f.module_id
    join public.platform_catalog_products p on p.id = m.product_id
   where f.key in ('subscriptions', 'supplier_costs', 'cost_to_serve', 'package_economics')
     and (p.key <> 'operator' or f.implementation_state <> 'available');
  if v_left > 0 then raise exception 'operator Finance features not in place'; end if;
end $$;
