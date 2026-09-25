-- One economics graph: meter -> usage event -> provider fulfilment and cost -> retail rate.
--
-- A usage event was a meter, a quantity and two snapshotted amounts. It could not say which
-- capability produced it, which of the business's own provider bindings or resources carried it,
-- or which rate rows the amounts came from. This adds those, each as a real foreign key that
-- cannot cross a tenant, and one door (`app.record_usage`) that is the only thing which writes
-- the table.
--
-- **Usage is a fact whether or not it can be priced.** GOLD incurred it the moment a provider
-- carried it; that the business has no currency yet, or the meter has no retail rate, or the
-- provider has no rate on file, changes what can be *charged* and *costed*, never whether the
-- usage exists. So the two amounts are nullable, and null means *not priced* / *not costed*,
-- which is a different fact from a price of nothing.

-- ---------------------------------------------------------------------------
-- Keys a usage event can reference without being able to disagree with them
-- ---------------------------------------------------------------------------
-- A composite foreign key can only point at a unique key, so each parent states the wider key its
-- children will use. They add no new fact; they are what lets the database, rather than a
-- function, refuse a rate for the wrong meter or a binding for the wrong provider.
alter table public.platform_retail_rates
  add constraint platform_retail_rates_id_meter_currency_unique unique (id, meter_id, currency);

alter table public.platform_provider_rates
  add constraint platform_provider_rates_id_meter_provider_currency_unique
    unique (id, meter_id, provider_key, currency);

alter table public.organization_provider_bindings
  add constraint organization_provider_bindings_org_id_provider_unique
    unique (organization_id, id, provider_key);

alter table public.organization_provider_resources
  add constraint organization_provider_resources_org_binding_id_unique
    unique (organization_id, binding_id, id);

alter table public.platform_provider_accounts
  add constraint platform_provider_accounts_id_provider_unique unique (id, provider_key);

-- ---------------------------------------------------------------------------
-- usage_events: provenance
-- ---------------------------------------------------------------------------
-- What must stay true if a binding or an account is reassigned later is which ones served this
-- usage *then*, so the account is recorded here as well as reachable through the binding. Every
-- reference is a foreign key without a delete action: the rows a usage event points at are not
-- deleted, and if one ever were, that would have to be decided rather than cascaded.
--
-- The rate columns record *which rows* the two snapshotted amounts came from, which is what lets
-- a later reader see the whole chain -- usage, cost rate, retail rate -- without recomputing
-- anything against today's rates.
alter table public.usage_events
  add column feature_id           uuid references public.platform_catalog_features (id),
  add column fulfilled_through    text not null default 'unrecorded'
    check (fulfilled_through in ('organization_binding', 'platform_account', 'unrecorded')),
  add column provider_cost_applicable boolean not null default true,
  add column provider_account_id  uuid,
  add column provider_binding_id  uuid,
  add column provider_resource_id uuid,
  add column provider_rate_id     uuid,
  add column retail_rate_id       uuid,
  add column reference            text
    check (reference is null or length(btrim(reference)) between 1 and 200);

-- How this usage was fulfilled is a fact of this event, said by whoever reports it, and not of the
-- meter: the same meter can be carried by GOLD's own account for one business and by the
-- business's own number, domain or connection for another. `organization_binding` names the
-- business's binding; `platform_account` is served from GOLD's account, so there is nothing of the
-- business's to name and naming one is refused; `unrecorded` is a gap that can be filled later.
-- A row that says nothing is unrecorded, which is what every row before this was.
alter table public.usage_events
  add constraint usage_events_fulfilment_matches_binding
    check ((fulfilled_through = 'organization_binding') = (provider_binding_id is not null));

-- ---------------------------------------------------------------------------
-- Not priced is not zero, and not costed is not free
-- ---------------------------------------------------------------------------
-- A charge of nothing and no charge were the same number, so a business with no currency, or a
-- meter with no retail rate, produced usage that looked free. Now null is *not priced* and zero is
-- a price that really is zero. The same for GOLD's cost: null is *not costed* (awaiting a provider
-- rate or a reconciliation) and `provider_cost_applicable = false` is usage that carries no
-- provider cost at all.
alter table public.usage_events
  alter column customer_currency      drop not null,
  alter column customer_charge_micros drop not null,
  alter column customer_charge_micros drop default,
  alter column provider_cost_micros   drop not null,
  alter column provider_cost_micros   drop default;

-- Every row before this could not tell the two apart: zero meant "no price" because a rate of
-- nothing was treated as no rate. Those rows are honestly unpriced and uncosted, not free.
update public.usage_events set customer_charge_micros = null
 where customer_charge_micros = 0 and retail_rate_id is null;
update public.usage_events set provider_cost_micros = null
 where provider_currency is null and provider_cost_micros = 0;

alter table public.usage_events
  add constraint usage_events_charge_needs_currency
    check (customer_charge_micros is null or customer_currency is not null),
  add constraint usage_events_retail_rate_needs_charge
    check (retail_rate_id is null or customer_charge_micros is not null),
  add constraint usage_events_provider_rate_needs_cost
    check (provider_rate_id is null or provider_cost_micros is not null),
  add constraint usage_events_cost_applicability
    check (provider_cost_applicable or (provider_cost_micros is null and provider_rate_id is null));

-- The binding is the organization's own, at the provider this event names.
alter table public.usage_events
  add constraint usage_events_binding_same_org_and_provider
    foreign key (organization_id, provider_binding_id, provider_key)
    references public.organization_provider_bindings (organization_id, id, provider_key);

-- The resource is the organization's own and belongs to the binding this event names.
alter table public.usage_events
  add constraint usage_events_resource_same_org_and_binding
    foreign key (organization_id, provider_binding_id, provider_resource_id)
    references public.organization_provider_resources (organization_id, binding_id, id),
  add constraint usage_events_resource_needs_binding
    check (provider_resource_id is null or provider_binding_id is not null);

-- The GOLD account belongs to the provider this event names.
alter table public.usage_events
  add constraint usage_events_account_same_provider
    foreign key (provider_account_id, provider_key)
    references public.platform_provider_accounts (id, provider_key);

-- The rate rows are for this meter, this provider and the currency the amount is in.
alter table public.usage_events
  add constraint usage_events_provider_rate_matches
    foreign key (provider_rate_id, meter_id, provider_key, provider_currency)
    references public.platform_provider_rates (id, meter_id, provider_key, currency),
  add constraint usage_events_provider_rate_has_currency
    check (provider_rate_id is null or provider_currency is not null),
  add constraint usage_events_retail_rate_matches
    foreign key (retail_rate_id, meter_id, customer_currency)
    references public.platform_retail_rates (id, meter_id, currency);

-- A caller that reports the same thing twice must not record it twice.
create unique index usage_events_org_meter_reference_unique
  on public.usage_events (organization_id, meter_id, reference)
  where reference is not null;

-- The two joins something will actually walk: usage through a business's own number or domain,
-- and a provider statement reconciled against the usage that ran on that GOLD account.
create index usage_events_org_resource_idx
  on public.usage_events (organization_id, provider_resource_id)
  where provider_resource_id is not null;

create index usage_events_account_occurred_idx
  on public.usage_events (provider_account_id, occurred_at desc)
  where provider_account_id is not null;

-- The column grant to `authenticated` is by name, so none of the columns above reaches a
-- business: which of GOLD's accounts, bindings and rates served it is GOLD's to know (D43).

-- ---------------------------------------------------------------------------
-- Rate resolution: one function per side, keyed by meter, currency and moment
-- ---------------------------------------------------------------------------
-- The unique key on each rate table is (meter, currency, effective_from), so at any moment the
-- applicable rate is the approved row with the latest effective_from not after it, and there is
-- never a tie. A draft never applies; a future row does not apply yet; no row means no price,
-- which is a free meter and not an error (D40).
create function app.retail_rate_at(
  p_meter_id text,
  p_currency text,
  p_at       timestamptz default now()
)
returns table (id uuid, unit_amount_micros bigint)
language sql
stable
set search_path = ''
as $fn$
  select r.id, r.unit_amount_micros
    from public.platform_retail_rates r
   where r.meter_id = p_meter_id
     and r.currency = upper(btrim(p_currency))
     and r.approval_state = 'approved'
     and r.effective_from <= p_at
   order by r.effective_from desc
   limit 1;
$fn$;

revoke all on function app.retail_rate_at(text, text, timestamptz) from public;
grant execute on function app.retail_rate_at(text, text, timestamptz) to authenticated;

comment on function app.retail_rate_at(text, text, timestamptz) is
  'The retail rate in force for a meter and currency at a moment. Security invoker: a member reads the rate they are charged; a business with no membership reads none.';

-- Now names the rate row it found, which the usage event records.
drop function app.provider_rate_at(text, text, timestamptz);

create function app.provider_rate_at(
  p_provider_key text,
  p_meter_id     text,
  p_at           timestamptz default now()
)
returns table (id uuid, unit_amount_micros bigint, currency text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.id, r.unit_amount_micros, r.currency
    from public.platform_provider_rates r
   where r.provider_key = p_provider_key
     and r.meter_id = p_meter_id
     and r.approval_state = 'approved'
     and r.effective_from <= p_at
   order by r.effective_from desc
   limit 1;
$fn$;

revoke all on function app.provider_rate_at(text, text, timestamptz) from public;

-- ---------------------------------------------------------------------------
-- The one door that writes a usage event
-- ---------------------------------------------------------------------------
-- Callers report that usage happened; this decides what it is worth. It resolves both rates at
-- the moment the usage occurred, snapshots the two amounts and the rate rows they came from, and
-- refuses provenance that could not be true. It records the usage whatever the pricing state: a
-- missing currency, a missing retail rate or a missing provider rate leaves the corresponding
-- amount null, never a made-up zero. No role holds insert on `usage_events`, and this function is
-- the only one that inserts.
create function app.record_usage(
  p_organization_id       uuid,
  p_meter_id              text,
  p_quantity              bigint,
  p_provider_key          text,
  p_occurred_at           timestamptz default now(),
  p_feature_id            uuid default null,
  p_provider_binding_id   uuid default null,
  p_provider_resource_id  uuid default null,
  p_reference             text default null,
  p_note                  text default '',
  p_fulfilled_through     text default null,
  p_provider_cost_applicable boolean default true
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_currency      text;
  v_existing      uuid;
  v_account       uuid;
  v_fulfilled     text;
  v_provider_rate uuid;
  v_provider_currency text;
  v_cost_micros   bigint;
  v_retail_rate   uuid;
  v_charge_micros bigint;
  v_id            uuid;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'usage must be a positive quantity' using errcode = '22023';
  end if;

  if p_occurred_at > now() + interval '5 minutes' then
    raise exception 'usage cannot have happened in the future' using errcode = '22023';
  end if;

  select o.currency into v_currency
    from public.organizations o where o.id = p_organization_id;
  if not found then
    raise exception 'no such organization' using errcode = '23503';
  end if;
  -- A business that has not said what it trades in cannot be priced, and that is not a reason to
  -- lose the usage.
  v_currency := nullif(upper(btrim(v_currency)), '');

  perform 1 from public.platform_meters m where m.id = p_meter_id;
  if not found then
    raise exception 'no such meter' using errcode = '23503';
  end if;

  -- Reported before: the same fact, not a second one.
  if p_reference is not null then
    select u.id into v_existing
      from public.usage_events u
     where u.organization_id = p_organization_id
       and u.meter_id = p_meter_id
       and u.reference = p_reference;
    if found then
      return v_existing;
    end if;
  end if;

  -- The capability must be one that this meter measures.
  if p_feature_id is not null and not exists (
    select 1 from public.platform_catalog_features f
     where f.id = p_feature_id and p_meter_id = any (f.meter_ids)
  ) then
    raise exception 'that capability is not measured by that meter' using errcode = '22023';
  end if;

  -- How it was fulfilled: naming a binding is the business's own; otherwise the reporter says
  -- GOLD's account served it, or nothing (unrecorded).
  v_fulfilled := coalesce(
    p_fulfilled_through,
    case when p_provider_binding_id is not null then 'organization_binding' else 'unrecorded' end);
  if v_fulfilled not in ('organization_binding', 'platform_account', 'unrecorded') then
    raise exception 'unknown fulfilment: %', v_fulfilled using errcode = '22023';
  end if;
  if (v_fulfilled = 'organization_binding') <> (p_provider_binding_id is not null) then
    raise exception 'a binding is named exactly when the usage was fulfilled through one'
      using errcode = '22023';
  end if;

  if p_provider_resource_id is not null and p_provider_binding_id is null then
    raise exception 'a resource is named through its binding' using errcode = '22023';
  end if;

  -- The account that served it, read once and recorded, so reassigning the binding later cannot
  -- change which account this usage was billed against.
  if p_provider_binding_id is not null then
    select b.provider_account_id into v_account
      from public.organization_provider_bindings b
     where b.organization_id = p_organization_id
       and b.id = p_provider_binding_id
       and b.provider_key = p_provider_key;
    if not found then
      raise exception 'that binding is not this business''s at that provider' using errcode = '23503';
    end if;
  end if;

  -- What it cost GOLD: a provider rate in force when it happened, or not costed yet. Usage that
  -- carries no provider cost at all says so and is neither costed nor awaiting a cost.
  if p_provider_cost_applicable then
    select r.id, r.unit_amount_micros * p_quantity, r.currency
      into v_provider_rate, v_cost_micros, v_provider_currency
      from app.provider_rate_at(p_provider_key, p_meter_id, p_occurred_at) r;
  end if;

  -- What it is worth to the business: a retail rate in force when it happened, in the business's
  -- currency. No currency or no rate leaves it not priced; a rate of nothing prices it at nothing.
  if v_currency is not null then
    select r.id, r.unit_amount_micros * p_quantity
      into v_retail_rate, v_charge_micros
      from app.retail_rate_at(p_meter_id, v_currency, p_occurred_at) r;
  end if;

  insert into public.usage_events
    (organization_id, meter_id, quantity, occurred_at, provider_key, provider_cost_applicable,
     provider_currency, provider_cost_micros, provider_rate_id, customer_currency,
     customer_charge_micros, retail_rate_id, feature_id, fulfilled_through, provider_account_id,
     provider_binding_id, provider_resource_id, reference, note)
  values
    (p_organization_id, p_meter_id, p_quantity, p_occurred_at, p_provider_key, p_provider_cost_applicable,
     v_provider_currency, v_cost_micros, v_provider_rate, v_currency,
     v_charge_micros, v_retail_rate, p_feature_id, v_fulfilled, v_account,
     p_provider_binding_id, p_provider_resource_id, p_reference, coalesce(p_note, ''))
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function app.record_usage(uuid, text, bigint, text, timestamptz, uuid, uuid, uuid, text, text, text, boolean) from public;

comment on function app.record_usage(uuid, text, bigint, text, timestamptz, uuid, uuid, uuid, text, text, text, boolean) is
  'The only writer of usage_events. Records the usage whatever its pricing state; resolves both rates at the moment it occurred, snapshots the amounts and the rate rows (null where not priced or not costed), and refuses provenance that could not be true. Idempotent on (organization, meter, reference).';

-- ---------------------------------------------------------------------------
-- A retail rate can be dated ahead, and never behind
-- ---------------------------------------------------------------------------
-- The door offered no date at all, so a price change could only start the moment it was typed.
-- A rate is appended and never rewritten, so a date in the past would change what "the rate at
-- that moment" resolves to for a moment already lived through; the events already written keep
-- the rate they used, but nobody should be able to make history answer differently.
drop function public.record_retail_rate(text, text, bigint, text, text, text, text);

create function public.record_retail_rate(
  p_meter_id           text,
  p_currency           text,
  p_unit_amount_micros bigint,
  p_source             text,
  p_source_url         text default null,
  p_approval_state     text default 'approved',
  p_note               text default '',
  p_effective_from     timestamptz default now()
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
  perform app.require_platform_staff();

  if p_approval_state not in ('draft', 'approved') then
    raise exception 'unknown approval state: %', p_approval_state using errcode = '22023';
  end if;

  if p_effective_from < now() - interval '1 minute' then
    raise exception 'a price cannot start in the past: a rate is appended, never rewritten backwards'
      using errcode = '22023';
  end if;

  insert into public.platform_retail_rates
    (meter_id, currency, unit_amount_micros, effective_from, approval_state, source, source_url,
     recorded_by, note)
  values
    (p_meter_id, upper(btrim(p_currency)), p_unit_amount_micros, p_effective_from, p_approval_state,
     p_source, p_source_url, (select auth.uid()), p_note)
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function public.record_retail_rate(text, text, bigint, text, text, text, text, timestamptz) from public;
grant execute on function public.record_retail_rate(text, text, bigint, text, text, text, text, timestamptz) to authenticated;
