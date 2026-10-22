-- Three invariants a later migration loosened without meaning to, found by
-- `schema-conformance.test.ts` after the fact rather than at the time, plus the real bug the
-- first one's investigation turned up.
--
-- `communication_routes`/`messages` have called `auth.uid()` bare in their write policies since
-- they were created; nothing here changed that behaviour, only how often Postgres evaluates it
-- (I2's sibling rule: settle a session scope once per statement, not once per row).
--
-- `usage_cost_components` has always had `organization_id`; its own natural-key uniqueness
-- (`usage_event_id`, `component_key`) simply never led with it.
--
-- `platform_retail_rates` is the interesting one. `20260910000001` created it with no
-- `organization_id` at all -- a pure platform rate card -- so `app.retail_rate_at` never had a
-- tenant to scope by. `20261018000001` later gave the table an *optional* `organization_id` (a
-- negotiated override) and `plan_id` (a Plan-scoped price) without teaching that function about
-- either, and without revisiting the one FK that already pointed at the table
-- (`usage_events_retail_rate_matches`, `20261008000001`). The result: `app.retail_rate_at` could
-- return *any* organization's negotiated rate to *any* other organization's usage, provided it
-- simply sorted last by `effective_from` -- the cross-tenant leak this migration closes.
--
-- What this migration does **not** do: make `usage_events_retail_rate_matches` composite with
-- `organization_id`, or lead `platform_retail_rates`' own `(id, meter_id, currency)` unique key
-- with it either. Both would require every real usage event to match a retail-rate row carrying
-- the *same* `organization_id` -- but the row nearly every usage event actually prices against is
-- the platform-default one, whose `organization_id` is null by construction. A composite FK on
-- that shape cannot ever match a real tenant's id against a null, so it would refuse to record
-- *any* usage once no negotiated rate exists for that tenant -- which is the common case. I2 and
-- I18 exist so one tenant's uniqueness or reference cannot block another's; a platform-shared
-- parent row that belongs to no tenant at all is the inverse case already named five times in
-- `schema-conformance.test.ts`, for the same reason. `id` already makes the unique key globally
-- collision-proof regardless of tenant, so leaving it as-is causes none of the harm I2 exists to
-- prevent. Named as the sixth and seventh exceptions there, with this migration linked from each.

-- ---------------------------------------------------------------------------
-- Settle the session scope once per statement, not once per row (I2's sibling rule)
-- ---------------------------------------------------------------------------

drop policy communication_routes_insert on public.communication_routes;
create policy communication_routes_insert on public.communication_routes
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'field.manage')
    and created_by = (select auth.uid())
  );

drop policy messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'message.send')
    and direction = 'outbound'
    and created_by = (select auth.uid())
  );

drop policy messages_update on public.messages;
create policy messages_update on public.messages
  for update to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'message.send') and created_by = (select auth.uid()))
  with check (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'message.send') and created_by = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- usage_cost_components: lead its own natural key with the organization it already carries (I2)
-- ---------------------------------------------------------------------------
-- No FK references this constraint by name (unlike platform_retail_rates' two below), so leading
-- it costs nothing and closes a real gap: two different organizations' usage could not actually
-- collide here before either (component_key is free text an integration chooses), but the index
-- answered "is this component recorded for this event" with no tenant in the key doing the
-- answering, which is what I2 refuses on principle rather than waiting for a real collision.

alter table public.usage_cost_components
  drop constraint usage_cost_components_usage_event_id_component_key_key,
  add constraint usage_cost_components_org_event_component_unique
    unique (organization_id, usage_event_id, component_key);

-- ---------------------------------------------------------------------------
-- platform_retail_rates' own uniqueness: lead with the organization it may now be scoped to
-- ---------------------------------------------------------------------------
-- Nothing references this index by name, so it is free to lead with organization_id. It still
-- needs `nulls not distinct`: a platform-default row (organization_id null) and a Plan-scoped row
-- with no organization (also null) must each still collide with their own kind at the same
-- meter/currency/plan/interval/moment -- the same correctness `coalesce(...)` bought the old
-- column order, without hiding the leading column from a plain attname lookup.

drop index public.platform_retail_rates_scoped_unique_moment;
create unique index platform_retail_rates_scoped_unique_moment
  on public.platform_retail_rates
  (organization_id, meter_id, currency, plan_id, billing_interval, effective_from)
  nulls not distinct;

-- ---------------------------------------------------------------------------
-- The real bug: a retail rate resolved for nobody in particular
-- ---------------------------------------------------------------------------
-- `app.retail_rate_at` now takes the organization it is pricing for, and prefers, in order: that
-- organization's own negotiated rate; a rate scoped to a Plan the organization currently holds;
-- the platform default (both `organization_id` and `plan_id` null). `billing_interval` is
-- excluded outright -- that dimension prices a Plan's own recurring charge
-- (`organization_plan_price`), never a per-unit usage meter, and the two must not be read as one
-- rate ladder.

drop function app.retail_rate_at(text, text, timestamptz);

create function app.retail_rate_at(
  p_meter_id        text,
  p_currency        text,
  p_organization_id uuid,
  p_at              timestamptz default now()
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
     and r.billing_interval is null
     and r.effective_from <= p_at
     and (r.effective_to is null or r.effective_to > p_at)
     and (r.organization_id is null or r.organization_id = p_organization_id)
     and (
       r.plan_id is null
       or r.plan_id in (
         select a.plan_id
           from public.organization_plan_assignments a
          where a.organization_id = p_organization_id
            and a.period_start <= p_at::date
            and a.period_end > p_at::date
       )
     )
   order by (r.organization_id is not null) desc, (r.plan_id is not null) desc, r.effective_from desc
   limit 1;
$fn$;

revoke all on function app.retail_rate_at(text, text, uuid, timestamptz) from public;
grant execute on function app.retail_rate_at(text, text, uuid, timestamptz) to authenticated;

comment on function app.retail_rate_at(text, text, uuid, timestamptz) is
  'The retail rate in force for a meter, currency and organization at a moment -- that organization''s own negotiated rate, else a rate scoped to a Plan it currently holds, else the platform default. Security invoker: a member reads the rate they are charged; a business with no membership reads none.';

create or replace function app.record_usage(
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
  -- currency and scoped to this organization (its own negotiated rate, else a Plan it holds, else
  -- the platform default -- never another organization's). No currency or no rate leaves it not
  -- priced; a rate of nothing prices it at nothing.
  if v_currency is not null then
    select r.id, r.unit_amount_micros * p_quantity
      into v_retail_rate, v_charge_micros
      from app.retail_rate_at(p_meter_id, v_currency, p_organization_id, p_occurred_at) r;
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
  'The only writer of usage_events. Records the usage whatever its pricing state; resolves both rates at the moment it occurred, scoped to the organization it is pricing for, snapshots the amounts and the rate rows (null where not priced or not costed), and refuses provenance that could not be true. Idempotent on (organization, meter, reference).';

-- ---------------------------------------------------------------------------
-- The other three callers `app.retail_rate_at`'s old three-argument shape left behind
-- ---------------------------------------------------------------------------
-- `app.may_spend_on` already took the organization as its own first argument; it simply never
-- passed it on. Same signature, so `create or replace` keeps its existing grant.

create or replace function app.may_spend_on(
  p_organization_id uuid,
  p_meter_id        text,
  p_units           integer default 1
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_currency text;
  v_rate     bigint;
begin
  select upper(btrim(o.currency)) into v_currency
    from public.organizations o
   where o.id = p_organization_id;

  if v_currency is null then
    -- A business that has not said what it trades in cannot be charged, and must not be
    -- stopped from working while it decides.
    return true;
  end if;

  select r.unit_amount_micros into v_rate from app.retail_rate_at(p_meter_id, v_currency, p_organization_id) r;

  -- No price, or a price of nothing: nothing to draw down, so nothing to refuse.
  if v_rate is null or v_rate = 0 then
    return true;
  end if;

  return app.credit_balance_micros(p_organization_id) >= v_rate * greatest(p_units, 1);
end;
$fn$;

-- `app.record_usage_cost_component` writes a cost component, not a retail rate, but its own
-- idempotency key predates `usage_cost_components`' own I2 fix above and needs the same column
-- added to keep matching a real unique constraint. Same signature, `create or replace` again.

create or replace function app.record_usage_cost_component(
  p_usage_event_id uuid,
  p_component_key text,
  p_provider_key text,
  p_cost_meter_key text,
  p_quantity numeric,
  p_unit text,
  p_provider_binding_id uuid default null,
  p_provider_resource_id uuid default null,
  p_region text default null,
  p_direction text default null,
  p_resource_type text default null,
  p_reporting_currency text default 'CAD'
) returns uuid language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_usage public.usage_events;
  v_rate record;
  v_fx_id uuid;
  v_fx_rate numeric;
  v_native bigint;
  v_reporting bigint;
  v_reporting_currency text;
  v_account uuid;
  v_id uuid;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'cost component quantity must be positive' using errcode = '22023';
  end if;
  select * into v_usage from public.usage_events where id = p_usage_event_id;
  if not found then raise exception 'no such usage event' using errcode = '23503'; end if;
  if p_provider_binding_id is not null then
    select provider_account_id into v_account
      from public.organization_provider_bindings
     where organization_id = v_usage.organization_id and id = p_provider_binding_id
       and provider_key = p_provider_key;
  end if;

  select * into v_rate from app.provider_component_rate_at(
    p_provider_key, p_cost_meter_key, v_usage.occurred_at,
    p_region, p_direction, p_resource_type, v_account);
  if v_rate.id is not null then
    v_native := round(v_rate.unit_amount_micros * p_quantity)::bigint;
    v_reporting_currency := upper(btrim(p_reporting_currency));
    if v_rate.currency = v_reporting_currency then
      v_reporting := v_native;
    else
      select f.id, f.rate into v_fx_id, v_fx_rate
        from app.fx_rate_at(v_rate.currency, v_reporting_currency, v_usage.occurred_at) f;
      if v_fx_id is not null then
        v_reporting := round(v_native * v_fx_rate)::bigint;
      end if;
    end if;
  end if;

  insert into public.usage_cost_components (
    organization_id, usage_event_id, component_key, provider_key, provider_account_id,
    provider_binding_id, provider_resource_id, cost_meter_key, quantity, unit,
    provider_rate_id, native_cost_micros, native_currency, reporting_cost_micros,
    reporting_currency, fx_rate_id, fx_rate, cost_state, unknown_reason, occurred_at)
  values (
    v_usage.organization_id, v_usage.id, p_component_key, p_provider_key, v_account,
    p_provider_binding_id, p_provider_resource_id, p_cost_meter_key, p_quantity, p_unit,
    v_rate.id, v_native, v_rate.currency, v_reporting,
    case when v_reporting is null then null else v_reporting_currency end,
    v_fx_id, v_fx_rate,
    case when v_native is null then 'unknown' else 'estimated' end,
    case when v_native is null then 'No current provider rate matches this component.'
         when v_reporting is null and v_rate.currency <> v_reporting_currency then 'No FX rate matches this component.' end,
    v_usage.occurred_at)
  on conflict (organization_id, usage_event_id, component_key) do update set component_key = excluded.component_key
  returning id into v_id;
  return v_id;
end $fn$;

-- `public.effective_retail_rates` answered "what am I charged" with no organization named at
-- all -- harmless while every row was the platform default, silently ambiguous for a member of
-- more than one business the moment a negotiated rate could exist. It is security invoker, so a
-- caller can only ever be offered a rate RLS already lets them see; naming which of their
-- organizations they are asking for is what makes that rate resolve to the right row rather than
-- whichever one sorted last.

drop function public.effective_retail_rates(text, timestamptz);

create function public.effective_retail_rates(
  p_currency        text,
  p_organization_id uuid,
  p_at              timestamptz default now()
)
returns table (meter_id text, unit_amount_micros bigint, currency text)
language sql
stable
set search_path = ''
as $fn$
  select m.id, r.unit_amount_micros, upper(btrim(p_currency))
    from public.platform_meters m
    cross join lateral app.retail_rate_at(m.id, p_currency, p_organization_id, p_at) r
   order by m.id;
$fn$;

revoke all on function public.effective_retail_rates(text, uuid, timestamptz) from public;
grant execute on function public.effective_retail_rates(text, uuid, timestamptz) to authenticated;
