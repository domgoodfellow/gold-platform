-- Work Order B, B7/B8: the customer-side charge composition, and the two read models over it and
-- over GildOps' own cost side (B5).
--
-- **A charge is an obligation, not an invoice and not a payment.** `organization_charge_components`
-- holds why a business owes what it owes for one billing period — never whether it has paid,
-- which stays `organization_platform_subscriptions`' and a future checkout slice's own question
-- entirely. Composing twice must not double an obligation (idempotent upsert, keyed on exactly
-- what produced each component) and finalizing a period must freeze what it found, the same
-- historical discipline Work Order A already holds for a rated usage event (I59).

create table public.organization_charge_components (
  id                   uuid        primary key default gen_random_uuid(),
  organization_id      uuid        not null references public.organizations (id),
  billing_period_start timestamptz not null,
  billing_period_end   timestamptz not null check (billing_period_end > billing_period_start),

  component_type       text        not null
    check (component_type in (
      'base_plan', 'addon', 'recurring_resource', 'usage_overage',
      'one_time_service', 'debit_adjustment', 'credit_adjustment'
    )),

  -- Always the magnitude; component_type says which direction it moves the obligation
  -- (every type adds except credit_adjustment, which subtracts) -- a signed column invites a
  -- caller to get the sign and the type out of step with each other.
  amount_minor         bigint      not null check (amount_minor >= 0),
  currency             text        not null check (currency ~ '^[A-Z]{3}$'),

  -- What produced this component, and the one thing idempotency is keyed on: composing the same
  -- source twice for the same organization, period and component type is the same fact, not two.
  source_domain         text        not null check (length(btrim(source_domain)) between 1 and 80),
  source_record_id      text        not null check (length(btrim(source_record_id)) between 1 and 200),

  description           text        not null check (length(btrim(description)) between 1 and 300),
  -- Enough to answer "why does the customer owe this" without re-deriving it: the assignment,
  -- agreement, usage event ids, rate snapshot or adjustment reason behind the amount.
  provenance             jsonb       not null default '{}'::jsonb,

  computed_at            timestamptz not null default now(),
  computed_by            uuid        references auth.users (id),
  -- Set once, by the one door that freezes a period. Null is still composable/replaceable;
  -- non-null is history, and the upsert below refuses to touch it.
  finalized_at           timestamptz,

  unique (organization_id, billing_period_start, component_type, source_domain, source_record_id)
);

comment on table public.organization_charge_components is
  'Why a business owes what it owes for one billing period -- never an invoice, a payment or a processor state. component_type says the kind; provenance says why; finalized_at, once set, is what Work Order A''s historical-rating discipline looks like on this table (I59, extended).';

create index organization_charge_components_org_period_idx
  on public.organization_charge_components (organization_id, billing_period_start desc);

alter table public.organization_charge_components enable row level security;
alter table public.organization_charge_components force row level security;

-- Revenue, unlike cost, is a fact a tenant may read about its own business (D43's asymmetry,
-- restated): what it owes and why, never what GildOps paid to serve it.
create policy organization_charge_components_select on public.organization_charge_components
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()) or app.is_platform_staff());

grant select on public.organization_charge_components to authenticated;
-- No insert/update/delete grant to anyone: `app.compose_organization_charges` is the only writer.

-- ---------------------------------------------------------------------------
-- Commercial adjustments: the minimal mechanism this charge model needs, and no more
-- ---------------------------------------------------------------------------
-- Not a refund workflow, not a credit wallet, not `organization_credits` reinterpreted (that
-- table stays prepaid communications money, untouched). A staff-recorded fact: this organization's
-- obligation for a period is adjusted by this amount, for this reason. Composition turns an
-- effective one into a charge component; nothing here moves money.
create table public.organization_commercial_adjustments (
  id               uuid        primary key default gen_random_uuid(),
  organization_id  uuid        not null references public.organizations (id),
  direction        text        not null check (direction in ('debit', 'credit')),
  amount_minor     bigint      not null check (amount_minor > 0),
  currency         text        not null check (currency ~ '^[A-Z]{3}$'),
  effective_at     timestamptz not null,
  reason           text        not null check (length(btrim(reason)) between 1 and 300),
  recorded_by      uuid        references auth.users (id),
  recorded_at      timestamptz not null default now()
);

comment on table public.organization_commercial_adjustments is
  'A staff-recorded debit or credit against one organization''s obligation, with a reason -- the minimal adjustment mechanism this charge model needs. Not a refund, not a payment, not organization_credits.';

alter table public.organization_commercial_adjustments enable row level security;
alter table public.organization_commercial_adjustments force row level security;

create policy organization_commercial_adjustments_select on public.organization_commercial_adjustments
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()) or app.is_platform_staff());

grant select on public.organization_commercial_adjustments to authenticated;

create function public.record_commercial_adjustment(
  p_organization_id uuid,
  p_direction       text,
  p_amount_minor    bigint,
  p_currency        text,
  p_reason          text,
  p_effective_at    timestamptz default now()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_staff uuid := (select auth.uid());
  v_id    uuid;
begin
  perform app.require_platform_capability('platform.commercial');

  insert into public.organization_commercial_adjustments
    (organization_id, direction, amount_minor, currency, effective_at, reason, recorded_by)
  values
    (p_organization_id, p_direction, p_amount_minor, upper(btrim(p_currency)), p_effective_at, p_reason, v_staff)
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.record_commercial_adjustment(uuid, text, bigint, text, text, timestamptz) is
  'The only writer of organization_commercial_adjustments. Needs platform.commercial.';

revoke all on function public.record_commercial_adjustment(uuid, text, bigint, text, text, timestamptz) from public;
grant execute on function public.record_commercial_adjustment(uuid, text, bigint, text, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Composition
-- ---------------------------------------------------------------------------
-- One organization, one period. Recurring components (base_plan, addon, one_time_service,
-- recurring_resource) need exactly one commercial assignment covering the whole period to price
-- unambiguously; where more than one distinct Plan or Add-on assignment intersects it, that
-- component kind is skipped and named in `proration_required_for` rather than guessed (this work
-- order explicitly refuses to invent a proration rule). Usage overage and adjustments need no
-- such assumption -- they compose regardless.
create function app.compose_organization_charges(
  p_organization_id       uuid,
  p_billing_period_start  timestamptz,
  p_billing_period_end    timestamptz,
  p_actor                 uuid
)
returns table (kind text, written boolean, proration_required boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_period_start date := p_billing_period_start::date;
  v_period_end   date := (p_billing_period_end - interval '1 second')::date;
  v_base_count   integer;
  v_base         record;
  v_addon        record;
  v_price        record;
  v_usage        record;
  v_adj          record;
  v_currency     text;
begin
  select upper(btrim(o.currency)) into v_currency from public.organizations o where o.id = p_organization_id;
  if v_currency is null then
    -- A business that has not said what it trades in cannot be charged -- the same refusal
    -- app.record_usage already makes, one layer up: nothing is priced, nothing is composed.
    return;
  end if;

  -- Base Plan: any assignment that so much as overlaps the period is a candidate, because a Plan
  -- *change* mid-period is exactly two assignments each covering only part of it -- counting only
  -- full coverage would see neither and silently compose nothing, the one outcome this work order
  -- explicitly refuses ("never guess"). Composing cleanly needs exactly one overlapping
  -- assignment, and that one assignment covering the whole period.
  select count(*) into v_base_count
    from public.organization_plan_assignments a
   where a.organization_id = p_organization_id and a.plan_kind = 'plan'
     and a.period_start <= v_period_end and a.period_end > v_period_start;

  if v_base_count > 1 then
    return query select 'base_plan'::text, false, true;
  elsif v_base_count = 1 then
    select a.id as assignment_id, a.plan_id into v_base
      from public.organization_plan_assignments a
     where a.organization_id = p_organization_id and a.plan_kind = 'plan'
       and a.period_start <= v_period_end and a.period_end > v_period_start
     limit 1;

    if not exists (
      select 1 from public.organization_plan_assignments a2
       where a2.id = v_base.assignment_id
         and a2.period_start <= v_period_start and a2.period_end > v_period_end
    ) then
      -- The one assignment found only partly covers the period (started or ended mid-period) --
      -- the same unresolved-proration shape as two assignments, reported the same way.
      return query select 'base_plan'::text, false, true;
    else
      -- Effective price: this organization's own agreement in force at the period start, else
      -- the Plan's own approved standard price -- organization_plan_price's own rule, read
      -- directly rather than called, so this definer function never depends on an invoker's own
      -- RLS view.
      select amount_minor, currency, source into v_price from (
        (select ag.amount_minor, ag.currency, 'agreement'::text as source
           from public.organization_plan_agreements ag
          where ag.organization_id = p_organization_id and ag.plan_id = v_base.plan_id
            and ag.currency = v_currency
            and ag.effective_from <= p_billing_period_start
            and (ag.effective_to is null or ag.effective_to > p_billing_period_start)
          order by ag.effective_from desc limit 1)
        union all
        (select pr.amount_minor, pr.currency, 'standard'::text as source
           from public.platform_plan_prices pr
          where pr.plan_id = v_base.plan_id and pr.currency = v_currency and pr.approval_state = 'approved'
            and pr.billing_interval = 'month'
            and pr.effective_from <= p_billing_period_start
            and (pr.effective_to is null or pr.effective_to > p_billing_period_start)
            and not exists (
              select 1 from public.organization_plan_agreements ag2
               where ag2.organization_id = p_organization_id and ag2.plan_id = v_base.plan_id
                 and ag2.effective_from <= p_billing_period_start
                 and (ag2.effective_to is null or ag2.effective_to > p_billing_period_start)
            )
          order by pr.effective_from desc limit 1)
      ) priced limit 1;

      if v_price.amount_minor is not null then
        insert into public.organization_charge_components
          (organization_id, billing_period_start, billing_period_end, component_type, amount_minor,
           currency, source_domain, source_record_id, description, provenance, computed_by)
        values
          (p_organization_id, p_billing_period_start, p_billing_period_end, 'base_plan', v_price.amount_minor,
           v_price.currency, 'catalogue.plan_assignment', v_base.assignment_id::text, 'Base Plan',
           jsonb_build_object('assignmentId', v_base.assignment_id, 'planId', v_base.plan_id, 'priceSource', v_price.source),
           p_actor)
        on conflict (organization_id, billing_period_start, component_type, source_domain, source_record_id)
        do update set amount_minor = excluded.amount_minor, currency = excluded.currency,
                      description = excluded.description, provenance = excluded.provenance, computed_at = now()
        where public.organization_charge_components.finalized_at is null;
        return query select 'base_plan'::text, true, false;
      else
        return query select 'base_plan'::text, false, false;
      end if;
    end if;
  end if;

  -- Add-ons: a *recurring* one needs its own assignment to cover the whole period, independently
  -- of the others and of the base Plan. A *one-time* one needs none of that -- it is owed once,
  -- the moment its assignment begins, whatever else intersects the period -- so which rule
  -- applies is decided after the price is known, never before.
  for v_addon in
    select a.id as assignment_id, a.plan_id, a.period_start as assignment_period_start,
           count(*) over (partition by a.plan_id) as overlap_count
      from public.organization_plan_assignments a
     where a.organization_id = p_organization_id and a.plan_kind = 'addon'
       and a.period_start <= v_period_end and a.period_end > v_period_start
  loop
    select amount_minor, currency, billing_interval, source into v_price from (
      (select ag.amount_minor, ag.currency, pr0.billing_interval, 'agreement'::text as source
         from public.organization_plan_agreements ag
         join public.platform_plan_prices pr0 on pr0.plan_id = ag.plan_id
        where ag.organization_id = p_organization_id and ag.plan_id = v_addon.plan_id
          and ag.currency = v_currency
          and ag.effective_from <= p_billing_period_start
          and (ag.effective_to is null or ag.effective_to > p_billing_period_start)
        order by ag.effective_from desc limit 1)
      union all
      (select pr.amount_minor, pr.currency, pr.billing_interval, 'standard'::text as source
         from public.platform_plan_prices pr
        where pr.plan_id = v_addon.plan_id and pr.currency = v_currency and pr.approval_state = 'approved'
          and pr.billing_interval in ('month', 'one_time')
          and pr.effective_from <= p_billing_period_start
          and (pr.effective_to is null or pr.effective_to > p_billing_period_start)
          and not exists (
            select 1 from public.organization_plan_agreements ag2
             where ag2.organization_id = p_organization_id and ag2.plan_id = v_addon.plan_id
               and ag2.effective_from <= p_billing_period_start
               and (ag2.effective_to is null or ag2.effective_to > p_billing_period_start)
          )
        order by pr.effective_from desc limit 1)
    ) priced limit 1;

    if v_price.amount_minor is null then
      return query select 'addon'::text, false, false;
      continue;
    end if;

    -- A one-time price composes only in the period the assignment began, and as a one-time
    -- service rather than a recurring addon -- a real, already-stored distinction (the ladder's
    -- own `standard_implementation`/`advanced_migration` carry `billing_interval = 'one_time'`),
    -- never invented here.
    if v_price.billing_interval = 'one_time' then
      if not exists (
        select 1 from public.organization_plan_assignments a3
         where a3.id = v_addon.assignment_id
           and a3.period_start >= v_period_start and a3.period_start <= v_period_end
      ) then
        continue;
      end if;
      insert into public.organization_charge_components
        (organization_id, billing_period_start, billing_period_end, component_type, amount_minor,
         currency, source_domain, source_record_id, description, provenance, computed_by)
      values
        (p_organization_id, p_billing_period_start, p_billing_period_end, 'one_time_service', v_price.amount_minor,
         v_price.currency, 'catalogue.addon_assignment', v_addon.assignment_id::text, 'One-time service',
         jsonb_build_object('assignmentId', v_addon.assignment_id, 'planId', v_addon.plan_id, 'priceSource', v_price.source),
         p_actor)
      on conflict (organization_id, billing_period_start, component_type, source_domain, source_record_id)
      do update set amount_minor = excluded.amount_minor, currency = excluded.currency,
                    description = excluded.description, provenance = excluded.provenance, computed_at = now()
      where public.organization_charge_components.finalized_at is null;
      return query select 'one_time_service'::text, true, false;
      continue;
    end if;

    -- From here the price is recurring, and *now* the whole-period-coverage rule applies: two
    -- distinct assignments of the same Add-on intersecting the period, or one that only partly
    -- covers it, is the same unresolved-proration shape the base Plan refuses above.
    if v_addon.overlap_count > 1 then
      return query select 'addon'::text, false, true;
      continue;
    end if;
    if not exists (
      select 1 from public.organization_plan_assignments a2
       where a2.id = v_addon.assignment_id
         and a2.period_start <= v_period_start and a2.period_end > v_period_end
    ) then
      return query select 'addon'::text, false, true;
      continue;
    end if;

    -- A recurring Add-on granting a `recurring_resource` quota (an extra phone number, say) is
    -- named `recurring_resource`; every other recurring Add-on is `addon`. Both are the same
    -- commercial fact (an assignment, priced), wearing the label that explains what it is.
    declare
      v_component_type text := case when exists (
        select 1 from public.platform_plan_quotas q
         where q.plan_id = v_addon.plan_id and q.allowance_type = 'recurring_resource'
      ) then 'recurring_resource' else 'addon' end;
    begin
      insert into public.organization_charge_components
        (organization_id, billing_period_start, billing_period_end, component_type, amount_minor,
         currency, source_domain, source_record_id, description, provenance, computed_by)
      values
        (p_organization_id, p_billing_period_start, p_billing_period_end, v_component_type, v_price.amount_minor,
         v_price.currency, 'catalogue.addon_assignment', v_addon.assignment_id::text,
         case when v_component_type = 'recurring_resource' then 'Recurring resource' else 'Add-on' end,
         jsonb_build_object('assignmentId', v_addon.assignment_id, 'planId', v_addon.plan_id, 'priceSource', v_price.source),
         p_actor)
      on conflict (organization_id, billing_period_start, component_type, source_domain, source_record_id)
      do update set amount_minor = excluded.amount_minor, currency = excluded.currency,
                    description = excluded.description, provenance = excluded.provenance, computed_at = now()
      where public.organization_charge_components.finalized_at is null;
      return query select v_component_type, true, false;
    end;
  end loop;

  -- Usage overage: Work Order A already rated the billable part of every event. This never
  -- re-rates; it sums what was already decided at the moment each event occurred, one component
  -- per meter so the provenance array stays a readable list rather than one row per reading.
  for v_usage in
    select u.meter_id, u.customer_currency,
           sum(u.customer_charge_micros) as total_micros,
           jsonb_agg(u.id) as usage_event_ids
      from public.usage_events u
     where u.organization_id = p_organization_id
       and u.occurred_at >= p_billing_period_start and u.occurred_at < p_billing_period_end
       and u.customer_charge_micros is not null and u.customer_charge_micros > 0
     group by u.meter_id, u.customer_currency
  loop
    insert into public.organization_charge_components
      (organization_id, billing_period_start, billing_period_end, component_type, amount_minor,
       currency, source_domain, source_record_id, description, provenance, computed_by)
    values
      (p_organization_id, p_billing_period_start, p_billing_period_end, 'usage_overage',
       round(v_usage.total_micros / 1000000.0)::bigint, v_usage.customer_currency,
       'commercial.usage', v_usage.meter_id, format('Usage overage: %s', v_usage.meter_id),
       jsonb_build_object('meterId', v_usage.meter_id, 'usageEventIds', v_usage.usage_event_ids),
       p_actor)
    on conflict (organization_id, billing_period_start, component_type, source_domain, source_record_id)
    do update set amount_minor = excluded.amount_minor, currency = excluded.currency,
                  provenance = excluded.provenance, computed_at = now()
    where public.organization_charge_components.finalized_at is null;
    return query select 'usage_overage'::text, true, false;
  end loop;

  -- Adjustments: effective within the period, each its own component.
  for v_adj in
    select id, direction, amount_minor, currency, reason
      from public.organization_commercial_adjustments
     where organization_id = p_organization_id
       and effective_at >= p_billing_period_start and effective_at < p_billing_period_end
  loop
    insert into public.organization_charge_components
      (organization_id, billing_period_start, billing_period_end, component_type, amount_minor,
       currency, source_domain, source_record_id, description, provenance, computed_by)
    values
      (p_organization_id, p_billing_period_start, p_billing_period_end,
       case when v_adj.direction = 'credit' then 'credit_adjustment' else 'debit_adjustment' end,
       v_adj.amount_minor, v_adj.currency, 'commercial.adjustment', v_adj.id::text, v_adj.reason,
       jsonb_build_object('adjustmentId', v_adj.id), p_actor)
    on conflict (organization_id, billing_period_start, component_type, source_domain, source_record_id)
    do update set amount_minor = excluded.amount_minor, currency = excluded.currency,
                  description = excluded.description, computed_at = now()
    where public.organization_charge_components.finalized_at is null;
    return query select (case when v_adj.direction = 'credit' then 'credit_adjustment' else 'debit_adjustment' end), true, false;
  end loop;

  return;
end;
$fn$;

revoke all on function app.compose_organization_charges(uuid, timestamptz, timestamptz, uuid) from public;

create function public.compose_organization_charges(
  p_organization_id      uuid,
  p_billing_period_start timestamptz,
  p_billing_period_end   timestamptz
)
returns table (kind text, written boolean, proration_required boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform app.require_platform_capability('platform.commercial');
  return query select * from app.compose_organization_charges(
    p_organization_id, p_billing_period_start, p_billing_period_end, (select auth.uid()));
end;
$fn$;

comment on function public.compose_organization_charges(uuid, timestamptz, timestamptz) is
  'Composes (or idempotently refreshes) every charge component for one organization and billing period. A component kind whose commercial assignments disagree mid-period is skipped and reported as proration_required rather than guessed. Needs platform.commercial. Running twice never duplicates a component, and a finalized component is never rewritten.';

revoke all on function public.compose_organization_charges(uuid, timestamptz, timestamptz) from public;
grant execute on function public.compose_organization_charges(uuid, timestamptz, timestamptz) to authenticated;

create function public.finalize_organization_charges(
  p_organization_id      uuid,
  p_billing_period_start timestamptz,
  p_billing_period_end   timestamptz
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_count integer;
begin
  perform app.require_platform_capability('platform.commercial');

  update public.organization_charge_components
     set finalized_at = now()
   where organization_id = p_organization_id
     and billing_period_start = p_billing_period_start
     and billing_period_end = p_billing_period_end
     and finalized_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

comment on function public.finalize_organization_charges(uuid, timestamptz, timestamptz) is
  'Freezes every not-yet-finalized component of one organization''s billing period. After this, a later Plan, agreement, retail-rate or provider-cost change can never rewrite why that period''s obligation existed -- composing again for a finalized period is a no-op on every component it already froze.';

revoke all on function public.finalize_organization_charges(uuid, timestamptz, timestamptz) from public;
grant execute on function public.finalize_organization_charges(uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- B5: cost-to-serve, one organization
-- ---------------------------------------------------------------------------
-- Every number here is **known, attributable cost only**. Shared overhead and unallocated
-- infrastructure are reported alongside, in their own columns, and never folded into this
-- organization's own total -- the one rule this whole work order keeps repeating because it is
-- the rule a margin becomes a lie without.
create function app.organization_cost_to_serve(
  p_organization_id  uuid,
  p_period_start     timestamptz,
  p_period_end       timestamptz,
  p_reporting_currency text default 'CAD'
)
returns table (
  reporting_currency                       text,
  direct_usage_cogs_micros                 bigint,
  direct_usage_has_unknown                 boolean,
  resource_cogs_micros                     bigint,
  infrastructure_attributable_cogs_micros  bigint,
  manual_direct_cogs_micros                bigint,
  attributable_known_cogs_micros           bigint,
  attributable_has_unallocated_peer        boolean,
  shared_platform_cost_micros              bigint,
  unallocated_cost_micros                  bigint,
  component_count                          bigint,
  known_component_count                    bigint,
  cost_coverage                            numeric
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with usage as (
    select
      coalesce(sum(c.reporting_cost_micros) filter (where c.reporting_currency = p_reporting_currency), 0)::bigint as known_micros,
      bool_or(c.cost_state = 'unknown' or (c.reporting_cost_micros is not null and c.reporting_currency <> p_reporting_currency)) as has_unknown,
      count(*) as total,
      count(*) filter (where c.cost_state <> 'unknown' and (c.reporting_cost_micros is null or c.reporting_currency = p_reporting_currency)) as known
    from public.usage_cost_components c
    join public.usage_events u on u.organization_id = c.organization_id and u.id = c.usage_event_id
    where c.organization_id = p_organization_id
      and u.occurred_at >= p_period_start and u.occurred_at < p_period_end
  ),
  infra_org as (
    select
      coalesce(sum(i.reporting_cost_micros) filter (where i.cost_category = 'resource_direct' and i.reporting_currency = p_reporting_currency), 0)::bigint as resource_micros,
      coalesce(sum(i.reporting_cost_micros) filter (where i.cost_category = 'infrastructure_attributable' and i.reporting_currency = p_reporting_currency), 0)::bigint as attributable_micros,
      coalesce(sum(i.reporting_cost_micros) filter (where i.cost_category = 'manual_direct' and i.reporting_currency = p_reporting_currency), 0)::bigint as manual_micros,
      bool_or(i.allocation_quality = 'estimated') as has_estimated,
      count(*) as total,
      count(*) filter (where i.reporting_currency = p_reporting_currency) as known
    from public.platform_infrastructure_cost_components i
    where i.organization_id = p_organization_id
      and i.billing_period >= date_trunc('month', p_period_start)::date
      and i.billing_period <  date_trunc('month', p_period_end)::date
  ),
  shared as (
    select
      coalesce(sum(i.reporting_cost_micros) filter (where i.cost_category = 'infrastructure_shared' and i.reporting_currency = p_reporting_currency), 0)::bigint as shared_micros,
      coalesce(sum(i.reporting_cost_micros) filter (where i.allocation_quality = 'unallocated' and i.reporting_currency = p_reporting_currency), 0)::bigint as unallocated_micros
    from public.platform_infrastructure_cost_components i
    where i.organization_id is null
      and i.billing_period >= date_trunc('month', p_period_start)::date
      and i.billing_period <  date_trunc('month', p_period_end)::date
  )
  select
    p_reporting_currency,
    usage.known_micros,
    usage.has_unknown,
    infra_org.resource_micros,
    infra_org.attributable_micros,
    infra_org.manual_micros,
    (usage.known_micros + infra_org.resource_micros + infra_org.attributable_micros + infra_org.manual_micros),
    infra_org.has_estimated,
    shared.shared_micros,
    shared.unallocated_micros,
    (usage.total + infra_org.total),
    (usage.known + infra_org.known),
    case when (usage.total + infra_org.total) = 0 then 1
         else round((usage.known + infra_org.known)::numeric / (usage.total + infra_org.total), 4) end
  from usage, infra_org, shared
$fn$;

comment on function app.organization_cost_to_serve(uuid, timestamptz, timestamptz, text) is
  'What it cost GildOps to serve this organization in this period: direct usage, resource, infrastructure-attributable and manual-direct COGS, summed only where known and in the reporting currency. Shared platform overhead and the unallocated residual are reported beside it, never folded into attributable_known_cogs_micros. cost_coverage is the fraction of cost components this read model actually found priced in the reporting currency -- 1 with zero components found is an honest "nothing to be incomplete about," not a claim of completeness over real missing data.';

revoke all on function app.organization_cost_to_serve(uuid, timestamptz, timestamptz, text) from public;

create function public.organization_cost_to_serve(
  p_organization_id  uuid,
  p_period_start     timestamptz,
  p_period_end       timestamptz,
  p_reporting_currency text default 'CAD'
)
returns table (
  reporting_currency                       text,
  direct_usage_cogs_micros                 bigint,
  direct_usage_has_unknown                 boolean,
  resource_cogs_micros                     bigint,
  infrastructure_attributable_cogs_micros  bigint,
  manual_direct_cogs_micros                bigint,
  attributable_known_cogs_micros           bigint,
  attributable_has_unallocated_peer        boolean,
  shared_platform_cost_micros              bigint,
  unallocated_cost_micros                  bigint,
  component_count                          bigint,
  known_component_count                    bigint,
  cost_coverage                            numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  perform app.require_platform_staff();
  return query select * from app.organization_cost_to_serve(p_organization_id, p_period_start, p_period_end, p_reporting_currency);
end;
$fn$;

comment on function public.organization_cost_to_serve(uuid, timestamptz, timestamptz, text) is
  'Staff-only door onto app.organization_cost_to_serve. GildOps'' own cost side; a tenant never reaches this, by the same column-grant-shaped reasoning D43 already holds for usage_cost_components.';

revoke all on function public.organization_cost_to_serve(uuid, timestamptz, timestamptz, text) from public;
grant execute on function public.organization_cost_to_serve(uuid, timestamptz, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- B8: revenue + margin, one organization
-- ---------------------------------------------------------------------------
create function public.organization_revenue_summary(
  p_organization_id       uuid,
  p_billing_period_start  timestamptz,
  p_billing_period_end    timestamptz,
  p_reporting_currency    text default 'CAD'
)
returns table (
  reporting_currency        text,
  base_plan_minor            bigint,
  addon_minor                bigint,
  recurring_resource_minor   bigint,
  usage_overage_minor        bigint,
  one_time_service_minor     bigint,
  debit_adjustment_minor     bigint,
  credit_adjustment_minor    bigint,
  customer_obligation_minor  bigint,
  has_mixed_currency         boolean,
  known_cost_to_serve_minor  bigint,
  known_contribution_minor   bigint,
  known_margin               numeric,
  cost_coverage              numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_mixed boolean;
begin
  perform app.require_platform_staff();

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
$fn$;

comment on function public.organization_revenue_summary(uuid, timestamptz, timestamptz, text) is
  'Revenue by component type, known cost-to-serve, known contribution and margin for one organization and billing period. A margin is always computed over known cost only, and cost_coverage says how much of the cost side that known figure actually represents -- it is never presented as complete when it is not. Staff-only: a tenant reads its own revenue through organization_charge_components directly, never this.';

revoke all on function public.organization_revenue_summary(uuid, timestamptz, timestamptz, text) from public;
grant execute on function public.organization_revenue_summary(uuid, timestamptz, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Portfolio: across every organization with a charge for the period
-- ---------------------------------------------------------------------------
create function public.platform_revenue_portfolio(
  p_billing_period_start timestamptz,
  p_billing_period_end   timestamptz,
  p_reporting_currency   text default 'CAD'
)
returns table (
  organization_id           uuid,
  organization_name         text,
  customer_obligation_minor bigint,
  known_cost_to_serve_minor bigint,
  known_contribution_minor  bigint,
  known_margin              numeric,
  cost_coverage             numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  perform app.require_platform_staff();

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
$fn$;

comment on function public.platform_revenue_portfolio(timestamptz, timestamptz, text) is
  'Every organization with a composed charge for this period, ranked by obligation -- the portfolio view behind Finance''s own Home and Economics screens. Staff-only.';

revoke all on function public.platform_revenue_portfolio(timestamptz, timestamptz, text) from public;
grant execute on function public.platform_revenue_portfolio(timestamptz, timestamptz, text) to authenticated;
