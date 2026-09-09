-- A provider's cost and a tenant's charge are two different monetary facts, in two possibly
-- different currencies, and `usage_events` held one column pretending to be both.
--
-- **The bug.** `charge_for_call` looked up GOLD's own wholesale rate using the *tenant's*
-- currency -- Twilio does not bill GOLD in whatever a Canadian customer happens to trade in, and
-- the one `currency` column asserted they were the same fact. This migration splits it into
-- `provider_currency` (what the provider actually bills GOLD in, or null when unpriced) and
-- `customer_currency` (what the tenant was charged in, always known -- `charge_for_call` already
-- refuses to write a row at all when the organization has not said what it trades in). Neither is
-- ever converted into the other; `organization_commercial_summary` (next migration) says so
-- honestly rather than subtracting unlike currencies.

-- ---------------------------------------------------------------------------
-- The split
-- ---------------------------------------------------------------------------

alter table public.usage_events
  add column provider_key      text references public.platform_providers (key),
  add column provider_currency text check (provider_currency ~ '^[A-Z]{3}$'),
  add column customer_currency text check (customer_currency ~ '^[A-Z]{3}$');

-- Nothing has actually been billed through this table outside a demo or a test run (voice is
-- its one real writer, and no provider rate has ever been recorded against it in a live
-- deployment) -- but the backfill is written as though it had, because "this table is empty in
-- practice today" is not a fact this migration should have to stay true to be correct.
update public.usage_events
   set customer_currency = currency,
       provider_currency = case when provider_cost_micros > 0 then currency else null end,
       provider_key      = 'twilio'
 where customer_currency is null;

alter table public.usage_events
  alter column customer_currency set not null,
  alter column provider_key set not null;

-- Mirrors `organization_commercial_terms_currency_or_free`: a zero cost makes no claim about
-- what currency it would have been zero in, but any real cost must say.
alter table public.usage_events
  add constraint usage_events_provider_currency_or_free
    check (provider_currency is not null or provider_cost_micros = 0);

-- **The status column this table never should have carried.** `provider_cost_status` implied a
-- row could move from `estimated` to `reconciled` in place, which contradicts "immutable" two
-- lines below it in the original comment. Reconciliation is `usage_cost_reconciliations`, next
-- migration -- a separate append-only fact keyed to this row, never a flag flipped on it.
alter table public.usage_events
  drop column provider_cost_status,
  drop column currency;

comment on table public.usage_events is
  'One meter reading: what it cost GOLD (provider_cost_micros, provider_currency -- the provider''s own billing currency) and what it charged a business (customer_charge_micros, customer_currency -- the tenant''s own trading currency), in micro-minor-units (D43). Immutable once written; a correction is a row in usage_cost_reconciliations, keyed to this one, never an edit here.';

-- The column grant is recreated because `currency` no longer exists and `customer_currency`
-- takes its place -- `provider_key`/`provider_currency` stay withheld, the same reasoning that
-- already withheld `provider_cost_micros` (I29): which vendor GOLD uses, and what GOLD pays it,
-- are both GOLD's own business.
revoke select on public.usage_events from authenticated;
grant select (id, organization_id, meter_id, quantity, occurred_at, customer_currency, customer_charge_micros, note, created_at)
  on public.usage_events to authenticated;

-- ---------------------------------------------------------------------------
-- Voice, recreated against the corrected lookup
-- ---------------------------------------------------------------------------

-- Recreated in full (D15). The only two behaviour changes: the provider rate is looked up by
-- provider and meter rather than by the tenant's currency, and its own currency travels with it
-- rather than being assumed to match the retail side.
create or replace function app.charge_for_call(p_call_id uuid, p_duration_seconds integer)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_call             public.calls;
  v_currency         text;
  v_rate             bigint;
  v_minutes          integer;
  v_charge_minor     bigint := 0;
  v_provider         record;
  v_provider_micros  bigint := 0;
  v_provider_currency text := null;
begin
  if p_duration_seconds is null or p_duration_seconds <= 0 then
    return;
  end if;

  select c.* into v_call from public.calls c where c.id = p_call_id;
  if not found then
    return;
  end if;

  select o.currency into v_currency
    from public.organizations o
   where o.id = v_call.organization_id;

  if v_currency is null then
    return;
  end if;

  v_minutes := ceil(p_duration_seconds::numeric / 60)::integer;
  v_rate := app.channel_rate(v_currency, 'voice');

  if v_rate is not null and v_rate > 0 then
    v_charge_minor := v_rate * v_minutes;

    insert into public.communication_credits
      (organization_id, amount_minor, currency, reason, channel, call_id, note)
    values
      (v_call.organization_id, -v_charge_minor, v_currency, 'usage', 'voice', v_call.id,
       format('%s minute(s) of voice', v_minutes));
  end if;

  -- GOLD's own cost, from Twilio, in whatever currency Twilio actually bills in -- never the
  -- tenant's own currency, and never assumed to be the same fact.
  select * into v_provider from app.provider_rate_at('twilio', 'voice_minutes');
  if v_provider.unit_amount_micros is not null then
    v_provider_micros := v_provider.unit_amount_micros * v_minutes;
    v_provider_currency := v_provider.currency;
  end if;

  insert into public.usage_events
    (organization_id, meter_id, quantity, provider_key, provider_currency, provider_cost_micros,
     customer_currency, customer_charge_micros, note)
  values
    (v_call.organization_id, 'voice_minutes', v_minutes, 'twilio', v_provider_currency,
     v_provider_micros, v_currency, v_charge_minor * 1000000, format('call %s', v_call.id));
end;
$fn$;

comment on function app.charge_for_call(uuid, integer) is
  'Draws the retail purse down (D40, unchanged) and records what the same call cost GOLD, from Twilio, in Twilio''s own currency, alongside what it charged the business in the tenant''s own currency (D43) -- the two are never assumed equal. Called once per call by record_call_event, whose deduplication is what stops a retried callback charging or recording twice.';

revoke all on function app.charge_for_call(uuid, integer) from public;
