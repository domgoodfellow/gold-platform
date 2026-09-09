-- What the /platform console needs to answer the owner's six questions, and nothing a tenant
-- should read alongside it.

-- **D40 never gave platform_staff a way to read the purse it built.** The console needs to show
-- a tenant's calling credit balance and statement alongside its other commercial facts; staff
-- could not read either before this. Read-only, the same shape `organizations_platform_select`
-- and the rest of I21's grants already use -- no write grant travels with it.
create policy communication_credits_platform_select on public.communication_credits
  for select to platform_staff using (true);

grant select on public.communication_credits to platform_staff;

create policy communication_rates_platform_select on public.communication_rates
  for select to platform_staff using (true);

grant select on public.communication_rates to platform_staff;

grant execute on function public.credit_balance(uuid) to platform_staff;

-- **A reconciliation job that could not confirm GOLD's own estimate against a provider's real
-- bill.** Ships empty, the same way `platform_failures` shipped empty between M5 and M6 --
-- nothing in this slice calls a vendor's billing API, so nothing writes here yet. Named as a
-- deferred writer rather than left silently absent (`constraints.md` D43).
create table public.platform_provider_sync_failures (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        references public.organizations (id) on delete cascade,
  meter_id        text        references public.platform_meters (id),
  occurred_at     timestamptz not null default now(),
  detail          text        not null check (length(btrim(detail)) between 1 and 2000),
  created_at      timestamptz not null default now()
);

comment on table public.platform_provider_sync_failures is
  'A reconciliation that could not confirm GOLD''s own estimated cost against a provider''s real bill. Ships empty in this slice -- the writer is vendor-adapter work outside it (see constraints.md D43), the same way platform_failures shipped empty between M5 and M6.';

alter table public.platform_provider_sync_failures enable row level security;
alter table public.platform_provider_sync_failures force row level security;

create policy platform_provider_sync_failures_select on public.platform_provider_sync_failures
  for select to platform_staff using (true);

grant select on public.platform_provider_sync_failures to platform_staff;
-- No insert/update/delete grant to anyone -- there is no writer in this slice.

-- **Usage, provider cost, customer charge and margin, per meter and currency, for one business.**
-- security invoker over a table platform_staff can already select in full -- the grant below is
-- what actually withholds this from a tenant, not the function body. Rounds once, at the end,
-- the same "round once" rule I4 and I5 already hold margin and availability to.
create function public.organization_commercial_summary(
  p_organization_id uuid,
  p_from            date default null,
  p_to              date default null
)
returns table (
  meter_id               text,
  currency               text,
  quantity               bigint,
  provider_cost_minor    bigint,
  customer_charge_minor  bigint,
  margin_minor           bigint
)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select u.meter_id,
         u.currency,
         sum(u.quantity)::bigint,
         round(sum(u.provider_cost_micros) / 1000000.0)::bigint,
         round(sum(u.customer_charge_micros) / 1000000.0)::bigint,
         round((sum(u.customer_charge_micros) - sum(u.provider_cost_micros)) / 1000000.0)::bigint
    from public.usage_events u
   where u.organization_id = p_organization_id
     and (p_from is null or u.occurred_at >= p_from::timestamptz)
     and (p_to   is null or u.occurred_at <  p_to::timestamptz)
   group by u.meter_id, u.currency
   order by u.meter_id, u.currency;
$fn$;

comment on function public.organization_commercial_summary(uuid, date, date) is
  'Usage, GOLD''s own cost, the customer''s charge, and the margin between them, per meter and currency. Never granted to authenticated -- the withholding is the grant, not a row this function could not otherwise see.';

revoke all on function public.organization_commercial_summary(uuid, date, date) from public;
grant execute on function public.organization_commercial_summary(uuid, date, date) to platform_staff;
