-- A usage event starts saying how much of itself the business had already paid for.
--
-- `app.record_usage` recorded the operational fact and rated the whole of it: quantity times the
-- retail rate in force. With allowances resolved (`20261105000002`) that is wrong for every
-- business whose package includes some of what it just used -- it would charge a business twice
-- for the first 500 minutes of a plan that includes 500 minutes.
--
-- **Quantity stays the quantity.** An eight-minute call is eight minutes of usage whatever was
-- included; the operational fact is not rewritten to hold only the chargeable part. What is new
-- is the split, stored beside it: how much the allowance covered, how much is billable, which
-- allowance and which window decided it, and what the included total and prior consumption were
-- at that moment. That is what lets "why was this charged this amount?" still be answerable after
-- the Plan, the allowance or the rate changes -- the same reason the rate row ids are already
-- snapshotted here (I8).
--
-- **One ledger.** No `usage_events_v2`, no `allowance_usage`, no second rating table. Columns on
-- the row that already records the fact.
--
-- **Two axes, not one state.** `retail_state` keeps its three answers -- priced (a price of
-- nothing included), no currency, no rate -- because that is a fact about *the rate*. How much of
-- the event the allowance covered is a different fact, and it gets its own derived answer. That
-- is what makes *included*, *zero-priced* and *unpriced* three readable facts rather than three
-- meanings for one zero.

-- ---------------------------------------------------------------------------
-- 1. The split, on the row that already holds the fact
-- ---------------------------------------------------------------------------
alter table public.usage_events
  add column allowance_key              text
    check (allowance_key is null or allowance_key ~ '^[a-z][a-z0-9_]{1,60}$'),
  -- What the allowance included for the whole window, and what had been consumed of it before
  -- this event. Kept so the split can be re-derived and explained, never recomputed from today's
  -- Plan.
  add column allowance_included_total   numeric check (allowance_included_total   is null or allowance_included_total   >= 0),
  add column allowance_consumed_before  numeric check (allowance_consumed_before  is null or allowance_consumed_before  >= 0),
  -- Of this event's own quantity.
  add column allowance_included_applied numeric check (allowance_included_applied is null or allowance_included_applied >= 0),
  add column allowance_overage_quantity numeric check (allowance_overage_quantity is null or allowance_overage_quantity >= 0),
  add column allowance_window_start     timestamptz,
  add column allowance_window_end       timestamptz,
  add column allowance_window_basis     text
    check (allowance_window_basis is null
           or allowance_window_basis in ('subscription', 'assignment', 'calendar', 'none'));

-- An allowance governed this event, or none did. Half an answer is not available.
alter table public.usage_events
  add constraint usage_events_allowance_split_is_whole
    check (num_nulls(allowance_key, allowance_included_total, allowance_consumed_before,
                     allowance_included_applied, allowance_overage_quantity,
                     allowance_window_basis) in (0, 6)),
  -- The split is of this event's quantity and nothing else: the two parts are the whole.
  add constraint usage_events_allowance_split_sums_to_quantity
    check (allowance_key is null
           or allowance_included_applied + allowance_overage_quantity = quantity),
  add constraint usage_events_allowance_window_matches_basis
    check (allowance_window_basis is null
           or (allowance_window_basis = 'none') = (allowance_window_start is null))
;

comment on column public.usage_events.allowance_key is
  'The allowance that governed this event, resolved at the moment it occurred. Null means no allowance in the business''s package governs this meter, and the whole quantity is rated.';
comment on column public.usage_events.allowance_overage_quantity is
  'The billable part of this event''s quantity -- what the allowance did not include. The customer charge is this times the retail rate, never the whole quantity times it.';

-- The column grant is by name (D43), so widening it is deliberate: every column added here is
-- about the business''s own allowance and its own charge. Nothing about which provider carried
-- it, which of GildOps' accounts or bindings served it, or what it cost GildOps is added.
revoke select on public.usage_events from authenticated;
grant select (
  id, organization_id, meter_id, quantity, occurred_at, customer_currency,
  customer_charge_micros, note, created_at,
  allowance_key, allowance_included_total, allowance_consumed_before,
  allowance_included_applied, allowance_overage_quantity,
  allowance_window_start, allowance_window_end, allowance_window_basis
) on public.usage_events to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The one writer, now allowance-aware
-- ---------------------------------------------------------------------------
-- Recreated in full (D15). Everything about provenance, idempotency, fulfilment and provider cost
-- is exactly as `20261028000001` left it. Three things are new:
--
--   the allowance governing this meter is resolved at the moment the usage *occurred*, so a late
--     callback lands in the window it belongs to;
--   the quantity is split into the included part and the billable part, and the retail rate is
--     applied to the billable part alone;
--   an advisory lock over (organization, allowance) is taken before consumption is read, so two
--     concurrent calls cannot both see the same last included unit and both spend it.
--
-- **Included is allocated in the order usage is recorded, not the order it occurred.** Two events
-- in one window race only against each other, and the lock decides which one takes what is left.
-- An event reported late takes whatever remains when it is reported. That is the rule a ledger
-- can actually hold -- the alternative is re-rating every event in the window whenever an older
-- one arrives, which would rewrite history (I8).
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
  v_unit_micros   bigint;
  v_charge_micros bigint;
  v_allowance     text;
  v_state         record;
  v_included_total  numeric;
  v_consumed_before numeric;
  v_included      numeric;
  v_overage       numeric;
  v_window_start  timestamptz;
  v_window_end    timestamptz;
  v_window_basis  text;
  v_billable      numeric;
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

  -- Reported before: the same fact, not a second one. Checked before the lock, so a carrier
  -- retrying a callback never waits on anything.
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
  -- GildOps' account served it, or nothing (unrecorded).
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

  -- What it cost GildOps: a provider rate in force when it happened, or not costed yet. Usage
  -- that carries no provider cost at all says so and is neither costed nor awaiting a cost.
  if p_provider_cost_applicable then
    select r.id, r.unit_amount_micros * p_quantity, r.currency
      into v_provider_rate, v_cost_micros, v_provider_currency
      from app.provider_rate_at(p_provider_key, p_meter_id, p_occurred_at) r;
  end if;

  -- **How much of this the business had already paid for.** At most one allowance may govern a
  -- meter; two is a catalogue mistake `app.allowance_states` reports, and this leaves the usage
  -- ungoverned rather than silently picking one.
  v_allowance := app.allowance_key_for_meter(p_organization_id, p_meter_id, p_occurred_at);

  if v_allowance is not null then
    -- Serialize this organization's consumption of this allowance for the rest of the
    -- transaction. Two callers reporting usage at once queue here, so the second one reads the
    -- first one's event as already consumed rather than spending the same included unit twice.
    perform pg_advisory_xact_lock(
      hashtextextended(p_organization_id::text || ':' || v_allowance, 0));

    select * into v_state
      from app.allowance_states(p_organization_id, v_allowance, p_occurred_at) limit 1;

    if v_state.included is null or v_state.consumed is null then
      -- A configuration error, or an allowance nothing counts. The usage is still recorded and
      -- rated in full; the allowance screen is where the problem is reported.
      v_allowance := null;
    else
      v_included_total  := v_state.included;
      v_consumed_before := v_state.consumed;
      v_included := least(greatest(v_included_total - v_consumed_before, 0), p_quantity::numeric);
      v_overage  := p_quantity::numeric - v_included;
      v_window_start := v_state.window_starts_at;
      v_window_end   := v_state.window_ends_at;
      v_window_basis := v_state.window_basis;
    end if;
  end if;

  -- What it is worth to the business: a retail rate in force when it happened, in the business's
  -- currency and scoped to this organization (its own negotiated rate, else a Plan it holds, else
  -- the platform default -- never another organization's), applied to the **billable** quantity.
  -- No currency or no rate leaves it not priced; a rate of nothing prices it at nothing; a
  -- quantity entirely included is priced at nothing for a different reason, which
  -- `allowance_included_applied` is what says.
  v_billable := coalesce(v_overage, p_quantity::numeric);
  if v_currency is not null then
    select r.id, r.unit_amount_micros
      into v_retail_rate, v_unit_micros
      from app.retail_rate_at(p_meter_id, v_currency, p_organization_id, p_occurred_at) r;
    if v_retail_rate is not null then
      v_charge_micros := round(v_unit_micros::numeric * v_billable)::bigint;
    end if;
  end if;

  insert into public.usage_events
    (organization_id, meter_id, quantity, occurred_at, provider_key, provider_cost_applicable,
     provider_currency, provider_cost_micros, provider_rate_id, customer_currency,
     customer_charge_micros, retail_rate_id, feature_id, fulfilled_through, provider_account_id,
     provider_binding_id, provider_resource_id, reference, note,
     allowance_key, allowance_included_total, allowance_consumed_before,
     allowance_included_applied, allowance_overage_quantity,
     allowance_window_start, allowance_window_end, allowance_window_basis)
  values
    (p_organization_id, p_meter_id, p_quantity, p_occurred_at, p_provider_key, p_provider_cost_applicable,
     v_provider_currency, v_cost_micros, v_provider_rate, v_currency,
     v_charge_micros, v_retail_rate, p_feature_id, v_fulfilled, v_account,
     p_provider_binding_id, p_provider_resource_id, p_reference, coalesce(p_note, ''),
     v_allowance, v_included_total, v_consumed_before, v_included, v_overage,
     v_window_start, v_window_end, v_window_basis)
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function app.record_usage(uuid, text, bigint, text, timestamptz, uuid, uuid, uuid, text, text, text, boolean) is
  'The only writer of usage_events. Records the usage whatever its pricing state; resolves the allowance governing the meter at the moment it occurred, splits the quantity into the included and billable parts under a lock so two callers cannot spend one included unit twice, rates the billable part at the retail rate then in force, snapshots every amount and rate row, and refuses provenance that could not be true. Idempotent on (organization, meter, reference).';

-- ---------------------------------------------------------------------------
-- 3. Credit is money, an allowance is entitlement, and they are two gates
-- ---------------------------------------------------------------------------
-- `app.may_spend_on` reasoned from the retail price of the whole requested quantity against the
-- prepaid purse, which asked a business to hold credit for minutes its own plan includes. A
-- customer with included minutes must not need prepaid credit to consume them, and a hard
-- allowance limit must refuse regardless of how much credit is sitting there. They are separate
-- questions and they stay separate:
--
--   the allowance decides whether the units may be consumed at all, and how many of them are
--     chargeable;
--   the purse decides whether the business can pay for the chargeable ones.
--
-- A configuration error permits: a disagreement between GildOps' own Plans must never stop a
-- business working, and the staff allowance screen is where it is reported.
create function app.spend_decision(
  p_organization_id uuid,
  p_meter_id        text,
  p_units           numeric default 1
)
returns table (allowed boolean, reason text, detail text)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  d          record;
  v_asked    numeric := greatest(coalesce(p_units, 1), 1);
  v_currency text;
  v_rate     bigint;
  v_billable numeric;
begin
  select * into d
    from app.allowance_decision_for_meter(p_organization_id, p_meter_id, v_asked) limit 1;

  if d.result = 'hard_limit_reached' then
    return query select false, 'allowance_hard_limit'::text, d.detail; return;
  end if;
  if d.result = 'not_entitled' then
    return query select false, 'not_entitled'::text, d.detail; return;
  end if;

  -- Only the part the allowance does not include is ever paid for.
  v_billable := case when d.governed then coalesce(d.overage_applied, 0) else v_asked end;

  if v_billable <= 0 then
    return query select true, 'included'::text,
      coalesce(d.detail, 'Included in this business''s plan.'); return;
  end if;

  select upper(btrim(o.currency)) into v_currency
    from public.organizations o where o.id = p_organization_id;
  if v_currency is null then
    -- A business that has not said what it trades in cannot be charged, and must not be stopped
    -- from working while it decides.
    return query select true, 'no_currency'::text, null::text; return;
  end if;

  select r.unit_amount_micros into v_rate
    from app.retail_rate_at(p_meter_id, v_currency, p_organization_id) r;

  -- No price, or a price of nothing: nothing to draw down, so nothing to refuse.
  if v_rate is null or v_rate = 0 then
    return query select true, 'unpriced'::text, null::text; return;
  end if;

  if app.credit_balance_micros(p_organization_id) >= v_rate::numeric * v_billable then
    return query select true, 'credit'::text, null::text; return;
  end if;

  return query select false, 'insufficient_credit'::text, null::text;
end;
$fn$;

comment on function app.spend_decision(uuid, text, numeric) is
  'Whether this business may consume this many units of a meter now, and why: included by its allowance, covered by prepaid credit, unpriced -- or refused because a hard allowance limit is reached or the purse does not cover the chargeable part. Two gates, never merged: an allowance is entitlement and credit is money.';

revoke all on function app.spend_decision(uuid, text, numeric) from public;
grant execute on function app.spend_decision(uuid, text, numeric) to authenticated;

-- Same signature, so `create or replace` keeps the grant `open_call` depends on. The boolean
-- shape stays for the callers that only need to know whether to proceed.
create or replace function app.may_spend_on(
  p_organization_id uuid,
  p_meter_id        text,
  p_units           integer default 1
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select d.allowed
    from app.spend_decision(p_organization_id, p_meter_id, greatest(coalesce(p_units, 1), 1)) d;
$fn$;

comment on function app.may_spend_on(uuid, text, integer) is
  'Whether the business may consume this many units of a meter now -- app.spend_decision''s boolean. Refuses on a hard allowance limit whatever the balance, and never on a balance for units the plan includes.';

-- `open_call` says which of the two refused it, because "you have reached your included calling
-- limit" and "there is no calling credit left" are two different things for a person to do
-- something about. Recreated in full (D15); nothing else about it changes.
create or replace function public.open_call(
  p_organization_id uuid,
  p_customer_id     uuid,
  p_conference_name text,
  p_from_number     text,
  p_to_number       text
)
returns uuid
language plpgsql
set search_path = ''
as $fn$
declare
  v_id uuid;
  d    record;
begin
  -- **Before the room is written and long before the carrier is asked.** A business that may not
  -- place this call is stopped here, in the database, where an automation, an AI action or a
  -- provider callback reaches it too -- rather than at a disabled button, which only the screen
  -- obeys.
  select * into d from app.spend_decision(p_organization_id, 'voice_minutes', 1);

  if not d.allowed then
    if d.reason = 'allowance_hard_limit' then
      raise exception 'this account has used all the calling its plan allows: %', coalesce(d.detail, 'the included minutes are used up')
        using errcode = '23514';
    else
      raise exception 'there is no calling credit left on this account'
        using errcode = '23514';
    end if;
  end if;

  insert into public.calls
    (organization_id, customer_id, direction, status, from_number, to_number,
     conference_name, created_by)
  values
    (p_organization_id, p_customer_id, 'outbound', 'ringing', p_from_number, p_to_number,
     p_conference_name, (select auth.uid()))
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, (select auth.uid()), 'customer', p_customer_id, 'call.placed',
     jsonb_build_object('call_id', v_id, 'direction', 'outbound', 'to_number', p_to_number));

  return v_id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. The two staff projections carry the customer side of the rating
-- ---------------------------------------------------------------------------
-- Dropped and recreated rather than replaced: a function's return type cannot be widened in
-- place. Neither gains a single column about provider cost that it did not already have, and
-- `platform_usage_economics` keeps COGS exactly where it was -- the point of showing the customer
-- side beside it is that a staff member can read allowance -> overage -> retail charge and
-- provider components -> COGS as two independent accounts, never as one blended "rate".

drop function public.organization_usage_detail(uuid);

create function public.organization_usage_detail(p_organization_id uuid)
returns table (
  usage_event_id             uuid,
  meter_id                   text,
  quantity                   bigint,
  occurred_at                timestamptz,
  provider_key               text,
  estimated_cost_micros      bigint,
  estimated_currency         text,
  reconciled_cost_micros     bigint,
  reconciled_currency        text,
  reconciled_at              timestamptz,
  customer_currency          text,
  customer_charge_micros     bigint,
  retail_state               text,
  provider_state             text,
  fulfilled_through          text,
  awaiting_reconciliation    boolean,
  allowance_key              text,
  allowance_included_total   numeric,
  allowance_consumed_before  numeric,
  allowance_included_applied numeric,
  allowance_overage_quantity numeric,
  allowance_window_start     timestamptz,
  allowance_window_end       timestamptz,
  allowance_window_basis     text,
  allowance_state            text
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select app.require_platform_staff();

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
$fn$;

comment on function public.organization_usage_detail(uuid) is
  'Every usage event next to its own allowance split, its original cost estimate and its latest reconciliation -- staff only. Two independent accounts on one row: the customer''s (allowance, overage, retail charge) and GildOps'' (provider estimate, reconciliation).';

revoke all on function public.organization_usage_detail(uuid) from public;
grant execute on function public.organization_usage_detail(uuid) to authenticated;

drop function public.platform_usage_economics(timestamptz, timestamptz, uuid, text, text, text);

create function public.platform_usage_economics(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_organization_id uuid default null,
  p_meter_id text default null,
  p_provider_key text default null,
  p_cost_state text default null
) returns table (
  usage_event_id uuid, organization_id uuid, organization_name text, meter_id text,
  quantity bigint, occurred_at timestamptz, source_domain text, source_record_id text,
  customer_currency text, customer_charge_micros bigint, component_count bigint,
  known_cost_micros bigint, reporting_currency text, cost_state text,
  allowance_key text, allowance_included_total numeric, allowance_included_applied numeric,
  allowance_overage_quantity numeric, allowance_window_start timestamptz,
  allowance_window_end timestamptz, allowance_window_basis text,
  allowance_state text, retail_state text, retail_rate_id uuid
) language sql stable security definer set search_path = '' as $fn$
  select app.require_platform_staff();
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
$fn$;

comment on function public.platform_usage_economics(timestamptz, timestamptz, uuid, text, text, text) is
  'Staff usage economics: the customer side (allowance, overage, retail state and charge) and GildOps'' side (provider components, known COGS, cost state) on one row and never blended into one rate.';

revoke all on function public.platform_usage_economics(timestamptz, timestamptz, uuid, text, text, text) from public;
grant execute on function public.platform_usage_economics(timestamptz, timestamptz, uuid, text, text, text) to authenticated;
