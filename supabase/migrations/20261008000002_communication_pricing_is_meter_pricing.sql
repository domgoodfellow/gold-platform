-- Voice, SMS and email are priced the way every other meter is: by an effective-dated retail rate
-- for their meter. `communication_rates` was a second retail price list with no dates and no
-- approval, written by migration alone; it is converted into `platform_retail_rates` and removed.

-- ---------------------------------------------------------------------------
-- The prices move; the numbers do not
-- ---------------------------------------------------------------------------
-- A rate was minor units per unit; a retail rate is micro-minor units per unit (I10), so the
-- number is multiplied by a million and nothing else about it changes. It takes effect from when
-- the old row was last set, which is when that price began to apply.
insert into public.platform_retail_rates
  (meter_id, currency, unit_amount_micros, effective_from, approval_state, source, note)
select case r.channel
         when 'voice' then 'voice_minutes'
         when 'sms'   then 'sms_segment'
         when 'email' then 'email_send'
       end,
       upper(btrim(r.currency)),
       r.unit_amount_minor * 1000000,
       r.updated_at,
       'approved',
       'Converted from communication_rates',
       ''
  from public.communication_rates r
on conflict (meter_id, currency, effective_from) do nothing;

-- ---------------------------------------------------------------------------
-- The credit purse: money in, money out that is not usage
-- ---------------------------------------------------------------------------
-- What a business has bought in advance is a real thing (D40). What it has spent is not a second
-- ledger: it is the charge on each usage event, which already says what was charged, in what
-- currency and on which meter. The `usage` rows here were a copy of that, and a copy is two
-- numbers that can disagree. The purse keeps only what usage cannot say -- purchases and
-- adjustments -- and the balance is the difference.
delete from public.communication_credits where reason = 'usage';

alter table public.communication_credits rename to organization_credits;

alter table public.organization_credits
  drop constraint communication_credits_channel_matches_reason,
  drop constraint communication_credits_reason_check,
  drop constraint communication_credits_call_same_org,
  drop column channel,
  drop column call_id;

alter table public.organization_credits
  add constraint organization_credits_reason_check check (reason in ('purchase', 'adjustment')),
  add constraint organization_credits_purchase_is_money_in check (reason <> 'purchase' or amount_minor > 0);

do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'public.organization_credits'::regclass and conname like 'communication_credits%'
  loop
    execute format('alter table public.organization_credits rename constraint %I to %I',
                   r.conname, replace(r.conname, 'communication_credits', 'organization_credits'));
  end loop;
  for r in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'organization_credits'
  loop
    execute format('alter policy %I on public.organization_credits rename to %I',
                   r.policyname, replace(r.policyname, 'communication_credits', 'organization_credits'));
  end loop;
end
$$;

alter index public.communication_credits_org_occurred_idx rename to organization_credits_org_occurred_idx;

comment on table public.organization_credits is
  'Credit a business bought in advance, and adjustments to it. Never usage: what was spent is the customer charge on usage_events. Written by nobody signed in; money in arrives through a payment.';

-- The balance, in micro-minor units of the business's own currency: credit in that currency less
-- every usage charge in it. Nothing is converted (I10); a credit or a charge in another currency
-- is simply not part of this business's balance. A sum and never a column (I4).
drop function public.credit_balance(uuid);
drop function app.credit_balance_unchecked(uuid);

create function app.credit_balance_micros(p_organization_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce((
           select sum(c.amount_minor)::bigint * 1000000
             from public.organization_credits c
            where c.organization_id = o.id and upper(btrim(c.currency)) = upper(btrim(o.currency))
         ), 0)
       - coalesce((
           select sum(u.customer_charge_micros)::bigint
             from public.usage_events u
            where u.organization_id = o.id and u.customer_currency = upper(btrim(o.currency))
         ), 0)
    from public.organizations o
   where o.id = p_organization_id;
$fn$;

revoke all on function app.credit_balance_micros(uuid) from public;

-- What is left, in whole minor units, rounded down: a part-spent minor unit is not spendable.
-- A member of the business or platform staff may ask; anybody else is told there is nothing,
-- which is what the row policy on the ledger used to say for them.
create function public.credit_balance(p_organization_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not (p_organization_id in (select app.current_tenant_ids()) or app.is_platform_staff()) then
    return 0;
  end if;

  return floor(coalesce(app.credit_balance_micros(p_organization_id), 0) / 1000000.0)::bigint;
end;
$fn$;

revoke all on function public.credit_balance(uuid) from public;
grant execute on function public.credit_balance(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Spending authorization is a question about a meter
-- ---------------------------------------------------------------------------
create function app.may_spend_on(
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

  select r.unit_amount_micros into v_rate from app.retail_rate_at(p_meter_id, v_currency) r;

  -- No price, or a price of nothing: nothing to draw down, so nothing to refuse.
  if v_rate is null or v_rate = 0 then
    return true;
  end if;

  return app.credit_balance_micros(p_organization_id) >= v_rate * greatest(p_units, 1);
end;
$fn$;

revoke all on function app.may_spend_on(uuid, text, integer) from public;
grant execute on function app.may_spend_on(uuid, text, integer) to authenticated;

comment on function app.may_spend_on(uuid, text, integer) is
  'Whether the business can pay for this many units of a meter now. Refuses only when the meter has a retail rate in the business''s currency and the balance does not cover it.';

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
begin
  -- **Before the room is written and long before the carrier is asked.** A business out of
  -- credit is stopped here, in the database, where an automation or an AI action reaches it
  -- too -- rather than at a disabled button, which only the screen obeys.
  if not app.may_spend_on(p_organization_id, 'voice_minutes', 1) then
    raise exception 'there is no calling credit left on this account'
      using errcode = '23514';
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
-- A finished call reports its minutes; the economics decides what they are worth
-- ---------------------------------------------------------------------------
-- The call knows its own facts: how long it ran, which way, and which of the business's numbers
-- it used. It reports that as voice minutes and names the capability, the binding and the
-- resource it can find. The number decides the resource where the business has recorded one; the
-- binding is then that resource's, and otherwise the business's binding at the carrier, if any.
-- What it cannot find stays null, which under an `organization_resource` meter reads as
-- unrecorded. The call's id is the reference, so a carrier retrying a `completed` callback
-- cannot bill a call twice.
--
-- **A call that carried voice is usage whether or not the business can be priced.** It used to
-- return here when the business had no currency, which lost the usage and GOLD's cost with it.
-- `record_usage` records it with the charge left null.
--
-- Known limit, left for the provider work: the carrier is named here as 'twilio'. The call should
-- reach its provider through the binding and service that fulfil the capability, not assume one.
create or replace function app.charge_for_call(p_call_id uuid, p_duration_seconds integer)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_call     public.calls;
  v_minutes  integer;
  v_number   text;
  v_binding  uuid;
  v_resource uuid;
  v_feature  uuid;
begin
  if p_duration_seconds is null or p_duration_seconds <= 0 then
    return;
  end if;

  select c.* into v_call from public.calls c where c.id = p_call_id;
  if not found then
    return;
  end if;

  v_minutes := ceil(p_duration_seconds::numeric / 60)::integer;

  -- The business's own number on this call: the one it dialled from, or the one that was dialled.
  v_number := case v_call.direction when 'outbound' then v_call.from_number else v_call.to_number end;

  select r.id, r.binding_id
    into v_resource, v_binding
    from public.phone_numbers n
    join public.organization_provider_resources r
      on r.organization_id = n.organization_id and r.id = n.provider_resource_id
    join public.organization_provider_bindings b
      on b.organization_id = r.organization_id and b.id = r.binding_id and b.provider_key = 'twilio'
   where n.organization_id = v_call.organization_id
     and n.e164 = v_number;

  if v_binding is null then
    select b.id into v_binding
      from public.organization_provider_bindings b
     where b.organization_id = v_call.organization_id and b.provider_key = 'twilio';
  end if;

  select f.id into v_feature
    from public.platform_catalog_features f
    join public.platform_catalog_modules m on m.id = f.module_id
   where m.key = 'voice'
     and f.key = case v_call.direction when 'outbound' then 'outbound_calling' else 'inbound_calling' end;

  perform app.record_usage(
    v_call.organization_id, 'voice_minutes', v_minutes, 'twilio', now(),
    v_feature, v_binding, v_resource, v_call.id::text, format('call %s', v_call.id));
end;
$fn$;

-- ---------------------------------------------------------------------------
-- The old generation
-- ---------------------------------------------------------------------------
drop function app.channel_rate(text, public.communication_channel);
drop function app.may_spend_on(uuid, public.communication_channel, integer);
drop table public.communication_rates;
drop type public.communication_channel;

-- ---------------------------------------------------------------------------
-- What a business is charged, read from the one place it lives
-- ---------------------------------------------------------------------------
-- The retail rate in force for every meter that has one, in a currency, at a moment. Security
-- invoker, so a member reads it and a caller who belongs to no business reads nothing.
create function public.effective_retail_rates(
  p_currency text,
  p_at       timestamptz default now()
)
returns table (meter_id text, unit_amount_micros bigint, currency text)
language sql
stable
set search_path = ''
as $fn$
  select m.id, r.unit_amount_micros, upper(btrim(p_currency))
    from public.platform_meters m
    cross join lateral app.retail_rate_at(m.id, p_currency, p_at) r
   order by m.id;
$fn$;

revoke all on function public.effective_retail_rates(text, timestamptz) from public;
grant execute on function public.effective_retail_rates(text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- What staff read: usage with its pricing and costing state, never a guessed zero
-- ---------------------------------------------------------------------------
-- `not priced` and `not costed` are counted, not summed as nothing, and a margin is only reported
-- when every event in the group has both a price and a cost (or a cost that does not apply).
drop function public.organization_commercial_summary(uuid, date, date);

create function public.organization_commercial_summary(
  p_organization_id uuid,
  p_from            date default null,
  p_to              date default null
)
returns table (
  meter_id              text,
  customer_currency     text,
  customer_charge_minor bigint,
  provider_currency     text,
  provider_cost_minor   bigint,
  quantity              bigint,
  margin_minor          bigint,
  unpriced_quantity     bigint,
  uncosted_quantity     bigint
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select app.require_platform_staff();

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
$fn$;

revoke all on function public.organization_commercial_summary(uuid, date, date) from public;
grant execute on function public.organization_commercial_summary(uuid, date, date) to authenticated;

drop function public.organization_usage_detail(uuid);

create function public.organization_usage_detail(p_organization_id uuid)
returns table (
  usage_event_id         uuid,
  meter_id               text,
  quantity               bigint,
  occurred_at            timestamptz,
  provider_key           text,
  estimated_cost_micros  bigint,
  estimated_currency     text,
  reconciled_cost_micros bigint,
  reconciled_currency    text,
  reconciled_at          timestamptz,
  customer_currency      text,
  customer_charge_micros bigint,
  retail_state           text,
  provider_state         text,
  fulfilled_through      text,
  awaiting_reconciliation boolean
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
         -- priced (a price of nothing is still priced), or why it is not
         case when u.customer_charge_micros is not null then 'priced'
              when u.customer_currency is null then 'no_currency'
              else 'no_rate' end,
         -- costed by a rate, not costed yet, or carrying no provider cost at all
         case when not u.provider_cost_applicable then 'not_applicable'
              when u.provider_cost_micros is null and r.reconciled_at is null then 'uncosted'
              else 'costed' end,
         u.fulfilled_through,
         -- an applicable provider cost that no provider statement has confirmed yet
         (u.provider_cost_applicable and r.reconciled_at is null)
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

revoke all on function public.organization_usage_detail(uuid) from public;
grant execute on function public.organization_usage_detail(uuid) to authenticated;
