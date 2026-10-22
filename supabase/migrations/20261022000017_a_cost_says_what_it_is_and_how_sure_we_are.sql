-- Work Order B, B1/B2: one canonical taxonomy for a GildOps cost that is not already a provider
-- component of a usage event, and one table that holds every one of them.
--
-- `usage_cost_components` (20261017000001) already answers "what did this reading cost GildOps"
-- for usage that runs through `app.record_usage` — that stays exactly as it is (`usage_direct`,
-- the one category this migration does not touch). Everything GildOps pays for that is *not* a
-- metered reading needed a home: a phone number's monthly rental, Supabase's storage bill,
-- Vercel's shared subscription, a manually-tracked invoice. Five more categories, one table,
-- because a cost per branch is the thing `app.check_custom_fields`'s six kinds already refused to
-- become and D65 already refused on the usage axis.
--
-- **Allocation quality is a fact, not a footnote.** A number with no record of how sure GildOps
-- is about it is a number nobody can defend later. `direct` (this provider resource is this
-- organization's, full stop), `measured` (a real per-organization driver was read), `estimated`
-- (a documented proxy was used), `shared` (this is overhead and stays overhead on purpose), and
-- `unallocated` (a cost exists and nothing yet says whose it is) are five different epistemic
-- states, and a screen that cannot tell them apart will eventually present one as the others.

create table public.platform_infrastructure_cost_components (
  id                    uuid        primary key default gen_random_uuid(),

  -- Null is a shared/unallocated cost; set is an attribution to one business. Never both answers
  -- at once, and never inferred from a provider's name (I2's own discipline, applied to a nullable
  -- tenant axis rather than a required one).
  organization_id       uuid        references public.organizations (id),

  cost_category         text        not null
    check (cost_category in ('resource_direct', 'infrastructure_attributable', 'infrastructure_shared', 'manual_direct')),
  allocation_quality    text        not null
    check (allocation_quality in ('direct', 'measured', 'estimated', 'shared', 'unallocated')),

  -- A cost attributed to an organization is direct, measured or estimated; a cost with no
  -- organization is shared or unallocated. The pairing is the fact, not a convention a query has
  -- to remember.
  constraint platform_infrastructure_cost_components_quality_matches_org
    check (
      (organization_id is not null and allocation_quality in ('direct', 'measured', 'estimated'))
      or (organization_id is null and allocation_quality in ('shared', 'unallocated'))
    ),
  -- infrastructure_shared is definitionally organization-less; resource_direct is definitionally
  -- somebody's, because a recurring resource belongs to the business that holds it.
  constraint platform_infrastructure_cost_components_category_matches_scope
    check (
      (cost_category = 'infrastructure_shared') = (organization_id is null and allocation_quality = 'shared')
      and (cost_category <> 'resource_direct' or organization_id is not null)
    ),

  provider_key          text        references public.platform_providers (key),
  provider_account_id   uuid        references public.platform_provider_accounts (id),
  -- Set only for resource_direct: the specific recurring thing this cost is for (a phone number,
  -- a dedicated domain). Composite, the same shape `usage_cost_components` already uses, so a
  -- resource cannot be named for the wrong business or the wrong binding.
  provider_binding_id   uuid,
  provider_resource_id  uuid,

  -- A calendar month, consistent with usage_events.billing_period — infrastructure bills arrive
  -- by the month, not by the instant.
  billing_period        date        not null,

  native_cost_micros    bigint      not null check (native_cost_micros >= 0),
  native_currency       text        not null check (native_currency ~ '^[A-Z]{3}$'),
  reporting_cost_micros bigint      check (reporting_cost_micros is null or reporting_cost_micros >= 0),
  reporting_currency    text        check (reporting_currency is null or reporting_currency ~ '^[A-Z]{3}$'),
  fx_rate_id            uuid        references public.platform_fx_rates (id),
  fx_rate               numeric(24,12) check (fx_rate is null or fx_rate > 0),
  check ((reporting_cost_micros is null) = (reporting_currency is null)),
  check ((fx_rate_id is null) = (fx_rate is null)),
  -- Reporting is resolved once, the same currency throughout, or honestly absent — never silently
  -- equal to the native amount when no FX was actually applied and the currencies differ.
  check (native_currency <> coalesce(reporting_currency, native_currency) or reporting_cost_micros = native_cost_micros),

  -- **How the number was reached**, for `measured`/`estimated` rows — the span and quantity a
  -- rate was multiplied against (e.g. `byte_days`, 2_678_400) so "why this amount" survives
  -- independently of whatever rate table produced it, the same provenance discipline
  -- `usage_events` already holds for a retail charge.
  driver_basis           text,
  driver_quantity         numeric,

  provider_reference    text,
  source                text        not null check (length(btrim(source)) between 1 and 200),
  note                  text        not null default '',
  recorded_by           uuid        references auth.users (id),
  recorded_at           timestamptz not null default now(),

  foreign key (organization_id, provider_binding_id, provider_key)
    references public.organization_provider_bindings (organization_id, id, provider_key),
  foreign key (organization_id, provider_binding_id, provider_resource_id)
    references public.organization_provider_resources (organization_id, binding_id, id),
  check (provider_resource_id is null or provider_binding_id is not null)
);

comment on table public.platform_infrastructure_cost_components is
  'Every GildOps cost that is not a usage_cost_components reading: a recurring resource''s rental, a shared or attributed slice of a platform infrastructure bill, or a manually tracked direct cost. cost_category says which; allocation_quality says how sure GildOps is about whose it is. The fourth stored category this repo''s cost taxonomy recognises is usage_direct, which stays exactly where it already was (usage_cost_components) — this table never duplicates it.';

comment on column public.platform_infrastructure_cost_components.allocation_quality is
  'direct: this resource is this organization''s, full stop. measured: a real per-organization driver was read. estimated: a documented proxy was used. shared: deliberately platform-wide overhead, never divided by tenant count. unallocated: a real cost exists and nothing yet says whose share it is -- never spread across tenants and called measured.';

create index platform_infrastructure_cost_components_org_period_idx
  on public.platform_infrastructure_cost_components (organization_id, billing_period desc)
  where organization_id is not null;
create index platform_infrastructure_cost_components_category_period_idx
  on public.platform_infrastructure_cost_components (cost_category, billing_period desc);

alter table public.platform_infrastructure_cost_components enable row level security;
alter table public.platform_infrastructure_cost_components force row level security;

-- Staff only, the same reasoning I29 already holds for usage_cost_components: a provider cost is
-- never a tenant's to read, attributed or not.
create policy platform_infrastructure_cost_components_staff_select
  on public.platform_infrastructure_cost_components for select to authenticated
  using (app.is_platform_staff());

grant select on public.platform_infrastructure_cost_components to authenticated;
-- No insert/update/delete grant to anyone: the one door below is the only writer, the same shape
-- every other staff-recorded commercial fact uses (D40's rule, restated for a fourth table).

create function public.record_infrastructure_cost(
  p_cost_category        text,
  p_allocation_quality    text,
  p_billing_period        date,
  p_native_cost_micros    bigint,
  p_native_currency       text,
  p_source                text,
  p_organization_id       uuid default null,
  p_provider_key          text default null,
  p_provider_account_id   uuid default null,
  p_provider_binding_id   uuid default null,
  p_provider_resource_id  uuid default null,
  p_reporting_cost_micros bigint default null,
  p_reporting_currency    text default null,
  p_fx_rate_id            uuid default null,
  p_fx_rate               numeric default null,
  p_driver_basis          text default null,
  p_driver_quantity       numeric default null,
  p_provider_reference    text default null,
  p_note                  text default ''
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
$fn$;

comment on function public.record_infrastructure_cost(text, text, date, bigint, text, text, uuid, text, uuid, uuid, uuid, bigint, text, uuid, numeric, text, numeric, text, text) is
  'The only writer of platform_infrastructure_cost_components. Needs platform.commercial, the same boundary Work Order A put over every other commercial write.';

revoke all on function public.record_infrastructure_cost(text, text, date, bigint, text, text, uuid, text, uuid, uuid, uuid, bigint, text, uuid, numeric, text, numeric, text, text) from public;
grant execute on function public.record_infrastructure_cost(text, text, date, bigint, text, text, uuid, text, uuid, uuid, uuid, bigint, text, uuid, numeric, text, numeric, text, text) to authenticated;

-- Supabase now has a real GildOps-paid bill this migration can name (storage, and whatever else
-- is measured later). Cloudflare deliberately gets no row here: `cloudflare` already names a
-- tenant-authorized connector (`platform_connectors`, a tenant's own DNS connection) and a
-- platform vendor and a tenant connector are two different vocabularies that must never share a
-- key (`connector-catalogue.test.ts`'s own invariant) -- GildOps' own Cloudflare zone, if its cost
-- is ever tracked, earns a distinguishable key of its own when that day comes, not this one.
insert into public.platform_providers (key, label) values
  ('supabase', 'Supabase')
on conflict (key) do nothing;
