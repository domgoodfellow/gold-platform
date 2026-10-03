-- Multi-line checkout (work order C §7/§8). Two gaps the single-Plan design left:
--
-- 1. `plan_price_provider_reference` refused anything but a base Plan (`plan.kind = 'plan'`),
--    because the only checkout line that ever existed was the base Plan. An Add-on now belongs on
--    the same purchase, so the door widens to both kinds -- nothing else about it changes: still
--    `billing.manage`, still only an approved, sellable price.
--
-- 2. An organization-specific agreement price (`organization_plan_agreements`) has no
--    `platform_plan_prices` row at all -- there is nothing for the existing mapping table to key
--    on. `organization_plan_agreement_provider_prices` is its own narrow mapping, one row per
--    (organization, plan, environment, billing interval), never a mutation of the Plan's own
--    standard provider price (I8).

create or replace function public.plan_price_provider_reference(
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
       and plan.kind in ('plan', 'addon')
       and plan.sale_status = 'active'
       and plan.billable
  );
end;
$fn$;

comment on function public.plan_price_provider_reference(uuid, uuid, text) is
  'The processor price reference for a sellable plan or add-on price. Requires billing.manage in the organization; the mapping table itself is staff-only.';

-- ---------------------------------------------------------------------------
-- organization_plan_agreement_provider_prices -- the provider's side of a negotiated price
-- ---------------------------------------------------------------------------

create table public.organization_plan_agreement_provider_prices (
  id                 uuid        primary key default gen_random_uuid(),
  organization_id    uuid        not null references public.organizations (id) on delete cascade,
  plan_id            uuid        not null references public.platform_plans (id),
  environment        text        not null check (environment in ('sandbox', 'live')),
  billing_interval   text        not null check (billing_interval in ('month', 'year', 'one_time')),
  product_reference  text        not null,
  price_reference    text        not null,
  provisioned_at     timestamptz not null default now(),
  provisioned_by     uuid        references auth.users (id),
  unique (organization_id, plan_id, environment, billing_interval)
);

comment on table public.organization_plan_agreement_provider_prices is
  'The processor''s billable representation of one organization''s negotiated Plan/Add-on price '
  '(organization_plan_agreements) -- never the Plan''s own standard provider price, which stays '
  'exactly what platform_plan_provider_prices already says for every other business.';

-- Deliberately no global unique index on (environment, price_reference) -- I2 requires every
-- unique index on a tenant-owned table to lead with organization_id, the same reasoning
-- platform_billing_customers already states. The (organization_id, plan_id, environment,
-- billing_interval) unique constraint above is this table's own idempotency key.

alter table public.organization_plan_agreement_provider_prices enable row level security;
alter table public.organization_plan_agreement_provider_prices force row level security;

create policy organization_plan_agreement_provider_prices_select
  on public.organization_plan_agreement_provider_prices
  for select to authenticated
  using (app.is_platform_staff());

-- No insert/update/delete grant to any role (D40's rule, restated): only
-- record_agreement_provider_price, below, may write this table.
grant select on public.organization_plan_agreement_provider_prices to authenticated;

create function public.record_agreement_provider_price(
  p_organization_id   uuid,
  p_plan_id           uuid,
  p_environment       text,
  p_billing_interval  text,
  p_product_reference text,
  p_price_reference   text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
begin
  perform app.require_platform_capability('platform.commercial');

  insert into public.organization_plan_agreement_provider_prices (
    organization_id, plan_id, environment, billing_interval, product_reference, price_reference, provisioned_by
  )
  values (p_organization_id, p_plan_id, p_environment, p_billing_interval, p_product_reference, p_price_reference, (select auth.uid()))
  on conflict (organization_id, plan_id, environment, billing_interval) do update
    set product_reference = excluded.product_reference,
        price_reference = excluded.price_reference,
        provisioned_at = now(),
        provisioned_by = excluded.provisioned_by
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.record_agreement_provider_price(uuid, uuid, text, text, text, text) is
  'Staff-provisioned processor representation of one organization''s negotiated price. platform.commercial, not platform staff generally -- the same narrower door record_commercial_term already uses.';

revoke all on function public.record_agreement_provider_price(uuid, uuid, text, text, text, text) from public;
grant execute on function public.record_agreement_provider_price(uuid, uuid, text, text, text, text) to authenticated;

create function public.organization_plan_agreement_provider_price_reference(
  p_organization_id  uuid,
  p_plan_id          uuid,
  p_environment      text,
  p_billing_interval text
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
    select price_reference
      from public.organization_plan_agreement_provider_prices
     where organization_id = p_organization_id
       and plan_id = p_plan_id
       and environment = p_environment
       and billing_interval = p_billing_interval
  );
end;
$fn$;

comment on function public.organization_plan_agreement_provider_price_reference(uuid, uuid, text, text) is
  'The processor price reference for one organization''s own negotiated price -- the agreement-priced counterpart to plan_price_provider_reference. Requires billing.manage in the organization; the mapping table itself is staff-only.';

revoke all on function public.organization_plan_agreement_provider_price_reference(uuid, uuid, text, text) from public;
grant execute on function public.organization_plan_agreement_provider_price_reference(uuid, uuid, text, text) to authenticated;

-- A checkout now has one line item per Plan/Add-on, some of which may be agreement-priced and so
-- have no `platform_plan_prices` row to point to at all; `quote_snapshot` (20261108000001) is
-- the authoritative record of every line this attempt actually bought. The column still records
-- the base Plan's own standard price when there is one -- useful provenance, never load-bearing.
alter table public.platform_billing_checkout_sessions
  alter column plan_price_id drop not null;

comment on column public.platform_billing_checkout_sessions.plan_price_id is
  'The base Plan''s standard price, when it has one -- null for an agreement-priced base Plan. '
  'The full set of lines this attempt bought is quote_snapshot, never this column alone.';
