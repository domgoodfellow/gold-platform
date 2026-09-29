-- Work Order 8: commercial packaging, scoped rate cards and package economics.
-- Extends the canonical Plan/Quota/Price/Agreement model. Simulation data is planning data only:
-- it never writes usage_events, provider costs, subscriptions, credits or invoices.

alter table public.platform_plan_quotas
  add column allowance_type text not null default 'usage'
    check (allowance_type in ('capacity', 'recurring_resource', 'usage', 'boolean')),
  add column reset_semantics text not null default 'billing_period'
    check (reset_semantics in ('billing_period', 'calendar_period', 'none')),
  add column overage_behavior text not null default 'not_applicable'
    check (overage_behavior in ('metered', 'hard_limit', 'soft_limit', 'unmetered', 'not_applicable'));

update public.platform_plan_quotas
   set allowance_type = case
         when meter_id is not null then 'usage'
         when unit in ('number', 'sender', 'domain') then 'recurring_resource'
         when unit in ('boolean', 'entitlement') then 'boolean'
         else 'capacity'
       end,
       reset_semantics = case when period = 'none' then 'none' else 'billing_period' end,
       overage_behavior = case overage_policy
         when 'allowed' then 'metered'
         when 'blocked' then 'hard_limit'
         else 'not_applicable'
       end;

alter table public.platform_plan_prices
  add column effective_to timestamptz,
  add constraint platform_plan_prices_effective_window
    check (effective_to is null or effective_to > effective_from);

alter table public.organization_plan_agreements
  add column effective_to timestamptz,
  add constraint organization_plan_agreements_effective_window
    check (effective_to is null or effective_to > effective_from);

-- Add-ons stack with a base Plan, but the same add-on must not be assigned twice
-- for an overlapping period.
alter table public.organization_plan_assignments
  add constraint organization_plan_assignments_one_copy_of_addon
    exclude using gist (
      organization_id with =,
      plan_id with =,
      daterange(period_start, period_end) with &&
    ) where (plan_kind = 'addon');

alter table public.platform_retail_rates
  add column plan_id uuid references public.platform_plans(id),
  add column organization_id uuid references public.organizations(id),
  add column billing_interval text check (billing_interval is null or billing_interval in ('month', 'year', 'one_time')),
  add column effective_to timestamptz,
  add constraint platform_retail_rates_effective_window
    check (effective_to is null or effective_to > effective_from),
  add constraint platform_retail_rates_organization_needs_plan
    check (organization_id is null or plan_id is not null);

alter table public.platform_retail_rates drop constraint platform_retail_rates_unique_moment;
create unique index platform_retail_rates_scoped_unique_moment
  on public.platform_retail_rates
  (meter_id, currency, coalesce(plan_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(billing_interval, ''), effective_from);

drop policy platform_retail_rates_select on public.platform_retail_rates;
create policy platform_retail_rates_select on public.platform_retail_rates
  for select to authenticated using (
    (select app.is_platform_staff())
    or (
      (select app.is_organization_member())
      and (organization_id is null or organization_id in (select app.current_tenant_ids()))
    )
  );

create table public.platform_plan_addons (
  plan_id uuid not null references public.platform_plans(id),
  addon_plan_id uuid not null references public.platform_plans(id),
  included_by_default boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  primary key (plan_id, addon_plan_id),
  check (plan_id <> addon_plan_id)
);
alter table public.platform_plan_addons enable row level security;
alter table public.platform_plan_addons force row level security;
create policy platform_plan_addons_select on public.platform_plan_addons
  for select to authenticated using ((select app.is_platform_staff()) or (select app.is_organization_member()));
grant select on public.platform_plan_addons to authenticated;

create table public.platform_plan_margin_policies (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.platform_plans(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  target_margin numeric(6,5) not null check (target_margin > 0 and target_margin < 1),
  warning_margin numeric(6,5) not null check (warning_margin >= 0 and warning_margin < target_margin),
  hard_floor_margin numeric(6,5) not null check (hard_floor_margin >= 0 and hard_floor_margin <= warning_margin),
  effective_from timestamptz not null default now(),
  source text not null check (length(btrim(source)) between 1 and 200),
  note text not null default '',
  recorded_at timestamptz not null default now(),
  recorded_by uuid references auth.users(id),
  unique (plan_id, currency, effective_from)
);

create table public.platform_plan_utilization_assumptions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.platform_plans(id),
  scenario text not null check (scenario in ('low', 'expected', 'heavy', 'max_allowance')),
  allowance_key text not null,
  utilization numeric(7,6) not null check (utilization >= 0 and utilization <= 1),
  effective_from timestamptz not null default now(),
  source text not null check (length(btrim(source)) between 1 and 200),
  note text not null default '',
  recorded_at timestamptz not null default now(),
  recorded_by uuid references auth.users(id),
  unique (plan_id, scenario, allowance_key, effective_from)
);

create table public.platform_meter_cost_model_components (
  id uuid primary key default gen_random_uuid(),
  meter_id text not null references public.platform_meters(id),
  component_key text not null check (component_key ~ '^[a-z][a-z0-9_]{1,60}$'),
  provider_key text not null references public.platform_providers(key),
  cost_meter_key text not null references public.platform_provider_cost_meters(key),
  quantity_multiplier numeric(16,8) not null check (quantity_multiplier > 0),
  region text,
  direction text check (direction is null or direction in ('inbound', 'outbound')),
  resource_type text,
  required boolean not null default true,
  note text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  unique (meter_id, component_key)
);

comment on table public.platform_meter_cost_model_components is
  'Planning mapping from one commercial meter to its provider cost ingredients. Rates and FX remain owned by the WO7 catalogues; this table stores only quantity relationships.';

do $rls$
declare t text;
begin
  foreach t in array array[
    'platform_plan_margin_policies',
    'platform_plan_utilization_assumptions',
    'platform_meter_cost_model_components'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select app.is_platform_staff()))', t || '_staff_select', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $rls$;

create table public.commercial_draft_scenarios (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  notes text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  archived_at timestamptz
);

create table public.commercial_draft_scenario_versions (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.commercial_draft_scenarios(id),
  revision integer not null check (revision > 0),
  plan_id uuid not null references public.platform_plans(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  candidate_prices_minor bigint[] not null check (cardinality(candidate_prices_minor) between 1 and 12),
  expected_seats numeric check (expected_seats is null or expected_seats >= 0),
  expected_resource_count numeric check (expected_resource_count is null or expected_resource_count >= 0),
  recorded_at timestamptz not null default now(),
  recorded_by uuid not null references auth.users(id),
  unique (scenario_id, revision),
  check (0 <= all(candidate_prices_minor))
);

create table public.commercial_draft_scenario_inputs (
  version_id uuid not null references public.commercial_draft_scenario_versions(id),
  allowance_key text not null,
  meter_id text references public.platform_meters(id),
  expected_quantity numeric check (expected_quantity is null or expected_quantity >= 0),
  utilization numeric(7,6) check (utilization is null or (utilization >= 0 and utilization <= 1)),
  primary key (version_id, allowance_key),
  check (expected_quantity is not null or utilization is not null)
);

create table public.commercial_draft_scenario_addons (
  version_id uuid not null references public.commercial_draft_scenario_versions(id),
  addon_plan_id uuid not null references public.platform_plans(id),
  primary key (version_id, addon_plan_id)
);

create table public.commercial_draft_scenario_direct_costs (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.commercial_draft_scenario_versions(id),
  label text not null check (length(btrim(label)) between 1 and 120),
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  note text not null default ''
);

do $draft_rls$
declare t text;
begin
  foreach t in array array[
    'commercial_draft_scenarios',
    'commercial_draft_scenario_versions',
    'commercial_draft_scenario_inputs',
    'commercial_draft_scenario_addons',
    'commercial_draft_scenario_direct_costs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select app.is_platform_staff()))', t || '_staff_select', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $draft_rls$;

create function public.set_plan_allowance(
  p_plan_id uuid, p_allowance_key text, p_label text, p_unit text,
  p_included_quantity numeric, p_period text, p_hard_limit numeric,
  p_overage_behavior text, p_allowance_type text, p_reset_semantics text,
  p_service_class text default null, p_meter_id text default null, p_display_order integer default 0
) returns uuid language plpgsql volatile security definer set search_path = '' as $fn$
declare v_id uuid; v_policy text;
begin
  perform app.require_platform_staff();
  v_policy := case p_overage_behavior when 'metered' then 'allowed' when 'hard_limit' then 'blocked' else 'not_applicable' end;
  insert into public.platform_plan_quotas
    (plan_id, allowance_key, label, unit, included_quantity, period, hard_limit, overage_policy,
     service_class, meter_id, display_order, allowance_type, reset_semantics, overage_behavior)
  values
    (p_plan_id, p_allowance_key, p_label, p_unit, p_included_quantity, p_period, p_hard_limit, v_policy,
     p_service_class, p_meter_id, p_display_order, p_allowance_type, p_reset_semantics, p_overage_behavior)
  on conflict (plan_id, allowance_key) do update set
    label=excluded.label, unit=excluded.unit, included_quantity=excluded.included_quantity,
    period=excluded.period, hard_limit=excluded.hard_limit, overage_policy=excluded.overage_policy,
    service_class=excluded.service_class, meter_id=excluded.meter_id, display_order=excluded.display_order,
    allowance_type=excluded.allowance_type, reset_semantics=excluded.reset_semantics,
    overage_behavior=excluded.overage_behavior, created_at=public.platform_plan_quotas.created_at
  returning id into v_id;
  return v_id;
end $fn$;
revoke all on function public.set_plan_allowance(uuid,text,text,text,numeric,text,numeric,text,text,text,text,text,integer) from public;
grant execute on function public.set_plan_allowance(uuid,text,text,text,numeric,text,numeric,text,text,text,text,text,integer) to authenticated;

create function public.attach_plan_addon(p_plan_id uuid, p_addon_plan_id uuid, p_included_by_default boolean default false)
returns void language plpgsql volatile security definer set search_path = '' as $fn$
begin
  perform app.require_platform_staff();
  if not exists (select 1 from public.platform_plans where id=p_plan_id and kind='plan')
     or not exists (select 1 from public.platform_plans where id=p_addon_plan_id and kind='addon') then
    raise exception 'plan/add-on reference is invalid' using errcode='23503';
  end if;
  insert into public.platform_plan_addons(plan_id,addon_plan_id,included_by_default,created_by)
  values (p_plan_id,p_addon_plan_id,p_included_by_default,(select auth.uid()))
  on conflict (plan_id,addon_plan_id) do update set included_by_default=excluded.included_by_default;
end $fn$;
revoke all on function public.attach_plan_addon(uuid,uuid,boolean) from public;
grant execute on function public.attach_plan_addon(uuid,uuid,boolean) to authenticated;

create function public.detach_plan_addon(p_plan_id uuid, p_addon_plan_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $fn$
begin
  perform app.require_platform_staff();
  delete from public.platform_plan_addons where plan_id=p_plan_id and addon_plan_id=p_addon_plan_id;
end $fn$;
revoke all on function public.detach_plan_addon(uuid,uuid) from public;
grant execute on function public.detach_plan_addon(uuid,uuid) to authenticated;

create function public.record_plan_margin_policy(
  p_plan_id uuid, p_currency text, p_target_margin numeric, p_warning_margin numeric,
  p_hard_floor_margin numeric, p_effective_from timestamptz, p_source text, p_note text default ''
) returns uuid language plpgsql volatile security definer set search_path = '' as $fn$
declare v_id uuid;
begin
  perform app.require_platform_staff();
  insert into public.platform_plan_margin_policies
    (plan_id,currency,target_margin,warning_margin,hard_floor_margin,effective_from,source,note,recorded_by)
  values
    (p_plan_id,upper(btrim(p_currency)),p_target_margin,p_warning_margin,p_hard_floor_margin,p_effective_from,p_source,p_note,(select auth.uid()))
  returning id into v_id;
  return v_id;
end $fn$;
revoke all on function public.record_plan_margin_policy(uuid,text,numeric,numeric,numeric,timestamptz,text,text) from public;
grant execute on function public.record_plan_margin_policy(uuid,text,numeric,numeric,numeric,timestamptz,text,text) to authenticated;

create function public.record_plan_utilization_assumption(
  p_plan_id uuid, p_scenario text, p_allowance_key text, p_utilization numeric,
  p_effective_from timestamptz, p_source text, p_note text default ''
) returns uuid language plpgsql volatile security definer set search_path = '' as $fn$
declare v_id uuid;
begin
  perform app.require_platform_staff();
  if not exists (select 1 from public.platform_plan_quotas where plan_id=p_plan_id and allowance_key=p_allowance_key) then
    raise exception 'allowance does not belong to plan' using errcode='23503';
  end if;
  insert into public.platform_plan_utilization_assumptions
    (plan_id,scenario,allowance_key,utilization,effective_from,source,note,recorded_by)
  values
    (p_plan_id,p_scenario,p_allowance_key,p_utilization,p_effective_from,p_source,p_note,(select auth.uid()))
  returning id into v_id;
  return v_id;
end $fn$;
revoke all on function public.record_plan_utilization_assumption(uuid,text,text,numeric,timestamptz,text,text) from public;
grant execute on function public.record_plan_utilization_assumption(uuid,text,text,numeric,timestamptz,text,text) to authenticated;

create function public.set_meter_cost_model_component(
  p_meter_id text, p_component_key text, p_provider_key text, p_cost_meter_key text,
  p_quantity_multiplier numeric, p_region text default null, p_direction text default null,
  p_resource_type text default null, p_required boolean default true, p_note text default ''
) returns uuid language plpgsql volatile security definer set search_path = '' as $fn$
declare v_id uuid;
begin
  perform app.require_platform_staff();
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
end $fn$;
revoke all on function public.set_meter_cost_model_component(text,text,text,text,numeric,text,text,text,boolean,text) from public;
grant execute on function public.set_meter_cost_model_component(text,text,text,text,numeric,text,text,text,boolean,text) to authenticated;

create function public.record_commercial_retail_rate(
  p_meter_id text, p_currency text, p_unit_amount_micros bigint, p_effective_from timestamptz,
  p_source text, p_plan_id uuid default null, p_organization_id uuid default null,
  p_billing_interval text default null, p_effective_to timestamptz default null,
  p_approval_state text default 'approved', p_note text default ''
) returns uuid language plpgsql volatile security definer set search_path = '' as $fn$
declare v_id uuid;
begin
  perform app.require_platform_staff();
  if p_organization_id is not null and not exists (
    select 1 from public.organization_plan_assignments
     where organization_id=p_organization_id and plan_id=p_plan_id
  ) then raise exception 'organization has no assignment for this plan' using errcode='23503'; end if;
  insert into public.platform_retail_rates
    (meter_id,currency,unit_amount_micros,effective_from,effective_to,approval_state,source,
     recorded_by,note,plan_id,organization_id,billing_interval)
  values
    (p_meter_id,upper(btrim(p_currency)),p_unit_amount_micros,p_effective_from,p_effective_to,
     p_approval_state,p_source,(select auth.uid()),p_note,p_plan_id,p_organization_id,p_billing_interval)
  returning id into v_id;
  return v_id;
end $fn$;
revoke all on function public.record_commercial_retail_rate(text,text,bigint,timestamptz,text,uuid,uuid,text,timestamptz,text,text) from public;
grant execute on function public.record_commercial_retail_rate(text,text,bigint,timestamptz,text,uuid,uuid,text,timestamptz,text,text) to authenticated;

create function public.resolve_commercial_retail_rate(
  p_meter_id text, p_currency text, p_at timestamptz, p_plan_id uuid default null,
  p_organization_id uuid default null, p_billing_interval text default 'month'
) returns table (rate_id uuid, unit_amount_micros bigint, source_scope text, source text)
language sql stable security invoker set search_path = '' as $fn$
  select r.id,r.unit_amount_micros,
         case when r.organization_id is not null then 'organization_agreement'
              when r.plan_id is not null then 'plan' else 'platform_default' end,
         r.source
    from public.platform_retail_rates r
   where r.meter_id=p_meter_id and r.currency=upper(btrim(p_currency))
     and r.approval_state='approved' and r.effective_from<=p_at
     and (r.effective_to is null or r.effective_to>p_at)
     and (r.billing_interval is null or r.billing_interval=p_billing_interval)
     and (r.plan_id is null or r.plan_id=p_plan_id)
     and (r.organization_id is null or r.organization_id=p_organization_id)
   order by (r.organization_id is not null) desc,(r.plan_id is not null) desc,r.effective_from desc
   limit 1
$fn$;
revoke all on function public.resolve_commercial_retail_rate(text,text,timestamptz,uuid,uuid,text) from public;
grant execute on function public.resolve_commercial_retail_rate(text,text,timestamptz,uuid,uuid,text) to authenticated;

create function public.record_organization_plan_agreement(
  p_organization_id uuid, p_plan_id uuid, p_currency text, p_amount_minor bigint,
  p_effective_from timestamptz, p_effective_to timestamptz default null, p_note text default ''
) returns uuid language plpgsql volatile security definer set search_path = '' as $fn$
declare v_id uuid; v_staff uuid := (select auth.uid());
begin
  perform app.require_platform_staff();
  if not exists (
    select 1 from public.organization_plan_assignments a
     where a.organization_id=p_organization_id and a.plan_id=p_plan_id
       and a.period_start <= p_effective_from::date
       and a.period_end > p_effective_from::date
  ) then
    raise exception 'organization has no active assignment for this plan at agreement start' using errcode='23503';
  end if;
  insert into public.organization_plan_agreements
    (organization_id,plan_id,currency,amount_minor,effective_from,effective_to,recorded_by,note)
  values
    (p_organization_id,p_plan_id,upper(btrim(p_currency)),p_amount_minor,p_effective_from,p_effective_to,v_staff,p_note)
  returning id into v_id;
  insert into public.events (organization_id,actor_id,entity_type,entity_id,action,payload)
  values (p_organization_id,v_staff,'organization',p_organization_id,'plan_agreement.recorded',
    jsonb_build_object('agreement_id',v_id,'plan_id',p_plan_id,'amount_minor',p_amount_minor,
      'currency',upper(btrim(p_currency)),'effective_from',p_effective_from,'effective_to',p_effective_to));
  return v_id;
end $fn$;
revoke all on function public.record_organization_plan_agreement(uuid,uuid,text,bigint,timestamptz,timestamptz,text) from public;
grant execute on function public.record_organization_plan_agreement(uuid,uuid,text,bigint,timestamptz,timestamptz,text) to authenticated;

create or replace function public.organization_plan_price(
  p_organization_id uuid, p_plan_id uuid, p_at timestamptz, p_billing_interval text
) returns table (amount_minor bigint, currency text, source text)
language sql stable security invoker set search_path = '' as $fn$
  (select a.amount_minor,a.currency,'agreement'::text
     from public.organization_plan_agreements a
    where a.organization_id=p_organization_id and a.plan_id=p_plan_id
      and a.effective_from<=p_at and (a.effective_to is null or a.effective_to>p_at)
    order by a.effective_from desc limit 1)
  union all
  (select p.amount_minor,p.currency,'standard'::text
     from public.platform_plan_prices p
    where p.plan_id=p_plan_id and p.billing_interval=p_billing_interval
      and p.approval_state='approved' and p.effective_from<=p_at
      and (p.effective_to is null or p.effective_to>p_at)
      and not exists (
        select 1 from public.organization_plan_agreements a
         where a.organization_id=p_organization_id and a.plan_id=p_plan_id
           and a.effective_from<=p_at and (a.effective_to is null or a.effective_to>p_at)
      )
    order by p.effective_from desc limit 1);
$fn$;

create function public.save_commercial_draft_scenario(
  p_scenario_id uuid, p_name text, p_notes text, p_plan_id uuid, p_currency text,
  p_candidate_prices_minor bigint[], p_expected_seats numeric, p_expected_resource_count numeric,
  p_inputs jsonb default '[]'::jsonb, p_addon_plan_ids uuid[] default '{}'::uuid[],
  p_direct_costs jsonb default '[]'::jsonb
) returns uuid language plpgsql volatile security definer set search_path = '' as $fn$
declare v_scenario uuid; v_version uuid; v_revision integer; v_item jsonb; v_addon uuid;
begin
  perform app.require_platform_staff();
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
end $fn$;
revoke all on function public.save_commercial_draft_scenario(uuid,text,text,uuid,text,bigint[],numeric,numeric,jsonb,uuid[],jsonb) from public;
grant execute on function public.save_commercial_draft_scenario(uuid,text,text,uuid,text,bigint[],numeric,numeric,jsonb,uuid[],jsonb) to authenticated;

insert into public.platform_meter_cost_model_components
  (meter_id,component_key,provider_key,cost_meter_key,quantity_multiplier,region,direction,required,note)
values
  ('voice_minutes','pstn','twilio','telephony.pstn.outbound.minute',1,'CA','outbound',true,'Expected outbound PSTN route.'),
  ('voice_minutes','browser_client','twilio','telephony.client.minute',1,null,null,true,'One browser leg per commercial minute.'),
  ('voice_minutes','conference','twilio','telephony.conference.participant_minute',2,null,null,true,'Two participant-minutes per two-party minute.'),
  ('sms_segment','carrier','twilio','messaging.sms.outbound.segment',1,'CA','outbound',true,''),
  ('mms_messages','carrier','twilio','messaging.mms.outbound.message',1,'CA','outbound',true,''),
  ('rcs_messages','carrier','twilio','messaging.rcs.basic.message',1,null,'outbound',true,''),
  ('phone_numbers','rental','twilio','phone_number.local.month',1,'CA',null,true,'Local-number planning baseline.')
on conflict (meter_id,component_key) do nothing;

comment on table public.commercial_draft_scenarios is
  'Organization-free reference-customer planning only. A scenario cannot create an organization, agreement, usage, provider resource, subscription or invoice.';
