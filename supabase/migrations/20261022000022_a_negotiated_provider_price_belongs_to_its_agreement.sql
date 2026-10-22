-- C1/C2 closeout. Three corrections to what 20261108000001/2 shipped.
--
-- 1. A price names the exact record it came from. `organization_plan_price` answered amount,
--    currency and a source *word*; a quote line therefore knew "an agreement" but not *which*
--    one, and had to re-look-up a standard price a second time in TypeScript (a second
--    resolution that could disagree with the first). It now also returns the winning row's id.
--
-- 2. A negotiated price's provider representation belongs to the agreement record that produced
--    the amount, not to organization + Plan + interval. Keyed the old way, a later agreement
--    rewrote the earlier agreement's provider price in place, so a checkout snapshot taken under
--    the earlier agreement no longer identified what the customer was actually offered (I8).
--
-- 3. `unlisted` means sellable privately -- hidden from the ordinary catalogue, assigned by
--    staff (gold_internal and sales_os_founding are both `unlisted` and both assigned). The
--    reference door refused anything but `active`, which made an assigned `unlisted` Plan
--    unsubscribable. `archived` stays refused.

-- ---------------------------------------------------------------------------
-- 1. organization_plan_price returns the id of the row that decided the price
-- ---------------------------------------------------------------------------
-- The return type changes, so the function is dropped and recreated rather than replaced; the
-- three-argument wrapper selects from it and goes first. Nothing in SQL depends on either.
drop function public.organization_plan_price(uuid, uuid, timestamptz);
drop function public.organization_plan_price(uuid, uuid, timestamptz, text);

create function public.organization_plan_price(
  p_organization_id uuid, p_plan_id uuid, p_at timestamptz, p_billing_interval text
) returns table (amount_minor bigint, currency text, source text, source_id uuid)
language sql stable security invoker set search_path = '' as $fn$
  (select a.amount_minor, a.currency, 'agreement'::text, a.id
     from public.organization_plan_agreements a
    where a.organization_id=p_organization_id and a.plan_id=p_plan_id
      and a.effective_from<=p_at and (a.effective_to is null or a.effective_to>p_at)
    order by a.effective_from desc limit 1)
  union all
  (select p.amount_minor, p.currency, 'standard'::text, p.id
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

create function public.organization_plan_price(p_organization_id uuid, p_plan_id uuid, p_at timestamptz default now())
returns table (amount_minor bigint, currency text, source text, source_id uuid)
language sql stable security invoker set search_path = '' as $fn$
  select * from public.organization_plan_price(p_organization_id, p_plan_id, p_at, 'month');
$fn$;

comment on function public.organization_plan_price(uuid, uuid, timestamptz, text) is
  'The price one organization pays for one Plan at a moment. source says which table decided it and source_id is that row''s own id: organization_plan_agreements.id for ''agreement'', platform_plan_prices.id for ''standard''.';

revoke all on function public.organization_plan_price(uuid, uuid, timestamptz, text) from public;
revoke all on function public.organization_plan_price(uuid, uuid, timestamptz) from public;
grant execute on function public.organization_plan_price(uuid, uuid, timestamptz, text) to authenticated;
grant execute on function public.organization_plan_price(uuid, uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The provider's price for a negotiated amount belongs to one agreement
-- ---------------------------------------------------------------------------
-- A composite key target, so the mapping can name an agreement only inside its own business (I2).
alter table public.organization_plan_agreements
  add constraint organization_plan_agreements_org_id_unique unique (organization_id, id);

alter table public.organization_plan_agreement_provider_prices
  add column agreement_id uuid;

-- A mapping already recorded belongs to the agreement that was in force when it was provisioned;
-- that is the only agreement staff could have been provisioning.
update public.organization_plan_agreement_provider_prices m
   set agreement_id = (
     select a.id from public.organization_plan_agreements a
      where a.organization_id = m.organization_id and a.plan_id = m.plan_id
        and a.effective_from <= m.provisioned_at
      order by a.effective_from desc limit 1
   );

-- A mapping that cannot name its agreement identifies nothing a checkout could be offered; the
-- provider's own idempotency key makes re-provisioning it harmless.
delete from public.organization_plan_agreement_provider_prices where agreement_id is null;

alter table public.organization_plan_agreement_provider_prices
  alter column agreement_id set not null,
  -- Dropping the column also drops the old (organization, plan, environment, interval) unique
  -- constraint that involved it -- the key this change replaces.
  drop column plan_id,
  add constraint organization_plan_agreement_provider_prices_agreement_fk
    foreign key (organization_id, agreement_id)
    references public.organization_plan_agreements (organization_id, id),
  add constraint organization_plan_agreement_provider_prices_one_per_agreement
    unique (organization_id, agreement_id, environment, billing_interval);

comment on table public.organization_plan_agreement_provider_prices is
  'The processor''s billable representation of ONE negotiated price -- one organization_plan_agreements '
  'row. A later agreement gets its own mapping and never touches this one, so a checkout snapshot '
  'that names an agreement still identifies the provider price that agreement was offered under (I8).';

drop function public.record_agreement_provider_price(uuid, uuid, text, text, text, text);
drop function public.organization_plan_agreement_provider_price_reference(uuid, uuid, text, text);

-- The organization and the Plan come from the agreement itself, so a caller cannot record a
-- mapping whose pieces disagree about whose price it is.
create function public.record_agreement_provider_price(
  p_agreement_id      uuid,
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
  v_org uuid;
  v_id  uuid;
begin
  perform app.require_platform_capability('platform.commercial');

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
$fn$;

comment on function public.record_agreement_provider_price(uuid, text, text, text, text) is
  'Staff-provisioned processor representation of one negotiated price (one agreement). platform.commercial, not platform staff generally -- the same narrower door record_commercial_term already uses. Idempotent; never rewrites a mapping.';

revoke all on function public.record_agreement_provider_price(uuid, text, text, text, text) from public;
grant execute on function public.record_agreement_provider_price(uuid, text, text, text, text) to authenticated;

-- A tenant resolves only the mapping of an agreement that is its own and in force now: the
-- agreement organization_plan_price would pick today, not a superseded one.
create function public.organization_plan_agreement_provider_price_reference(
  p_organization_id  uuid,
  p_agreement_id     uuid,
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
    select m.price_reference
      from public.organization_plan_agreement_provider_prices m
      join public.organization_plan_agreements a
        on a.organization_id = m.organization_id and a.id = m.agreement_id
     where m.organization_id = p_organization_id
       and m.agreement_id = p_agreement_id
       and m.environment = p_environment
       and m.billing_interval = p_billing_interval
       and a.effective_from <= now()
       and (a.effective_to is null or a.effective_to > now())
       and not exists (
         select 1 from public.organization_plan_agreements later
          where later.organization_id = a.organization_id and later.plan_id = a.plan_id
            and later.id <> a.id and later.effective_from > a.effective_from
            and later.effective_from <= now()
            and (later.effective_to is null or later.effective_to > now())
       )
  );
end;
$fn$;

comment on function public.organization_plan_agreement_provider_price_reference(uuid, uuid, text, text) is
  'The processor price reference for one organization''s own in-force negotiated price (an agreement id) -- the agreement-priced counterpart to plan_price_provider_reference. Requires billing.manage in the organization; the mapping table itself is staff-only.';

revoke all on function public.organization_plan_agreement_provider_price_reference(uuid, uuid, text, text) from public;
grant execute on function public.organization_plan_agreement_provider_price_reference(uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. An `unlisted` Plan is sellable; an `archived` one is not
-- ---------------------------------------------------------------------------
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
       and plan.sale_status in ('active', 'unlisted')
       and plan.billable
  );
end;
$fn$;
