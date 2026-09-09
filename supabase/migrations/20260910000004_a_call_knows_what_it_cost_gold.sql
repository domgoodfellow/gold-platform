-- Generalizing D40's usage thinking: what GOLD paid for a unit of anything, and what it charged
-- for the same unit, on one row.
--
-- D40 built the tenant-facing half of this -- a purse that gets drawn down before a business may
-- spend. It never recorded the other half: what that spend actually cost GOLD at the carrier.
-- This is that ledger, general enough to hold a call, a transcription second, an AI token or a
-- character of speech without a schema change per provider -- and, in this slice, one real
-- writer: `charge_for_call`, replaced to record a `usage_events` row alongside the
-- `communication_credits` debit it already writes. Nothing about that debit, or `may_spend_on`,
-- or `open_call`, changes.

create table public.usage_events (
  id                     uuid        primary key default gen_random_uuid(),
  organization_id        uuid        not null references public.organizations (id) on delete cascade,
  meter_id               text        not null references public.platform_meters (id),
  quantity               bigint      not null check (quantity > 0),
  occurred_at            timestamptz not null default now(),
  currency               text        not null check (currency ~ '^[A-Z]{3}$'),

  -- Estimated at the moment of use; reconciled later against a provider's own invoice, which is
  -- vendor-adapter work this slice does not build (see platform_provider_sync_failures). Never
  -- rewritten in place -- a reconciliation would be a new row's problem, not this one's, the same
  -- "never overwrite a historical fact" rule D40 already holds for a rate change.
  provider_cost_status   text        not null check (provider_cost_status in ('estimated', 'reconciled')) default 'estimated',

  -- Micro-minor-units (D43): sub-cent provider costs are the norm for a token or a character,
  -- and rounding per row before summing would make a margin wrong by construction.
  provider_cost_micros   bigint      not null default 0 check (provider_cost_micros >= 0),
  customer_charge_micros bigint      not null default 0 check (customer_charge_micros >= 0),

  -- Free text, not a reference back to whatever produced this row -- the second polymorphic
  -- column this table would otherwise need per producing entity, which is exactly what
  -- `communication_credits.call_id` warned it was conceding only because there were two
  -- channels. There are eight meters here; a note is the idiom that scales.
  note                   text        not null default '',
  created_at             timestamptz not null default now()
);

comment on table public.usage_events is
  'One meter reading: what it cost GOLD and what it charged a business, in micro-minor-units (D43). No reference back to whatever produced it.';

create index usage_events_org_occurred_idx
  on public.usage_events (organization_id, occurred_at desc);

alter table public.usage_events enable row level security;
alter table public.usage_events force row level security;

create policy usage_events_select on public.usage_events
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy usage_events_platform_select on public.usage_events
  for select to platform_staff using (true);

-- **A tenant sees what it used and what it was charged -- never what it cost GOLD.** RLS is
-- row-level and cannot withhold one column of a row it otherwise allows, so the withholding is
-- a column grant, the same mechanism `field_definitions` already uses to keep `kind` and `key`
-- out of reach while granting the rest of the row.
grant select (id, organization_id, meter_id, quantity, occurred_at, currency, customer_charge_micros, note, created_at)
  on public.usage_events to authenticated;

grant select on public.usage_events to platform_staff;
-- No insert/update/delete grant to anyone. The only writer in this slice is app.charge_for_call,
-- below, which already knows the fact first-hand.

-- ---------------------------------------------------------------------------
-- Voice: the one real writer
-- ---------------------------------------------------------------------------

-- Recreated in full (D15 -- a migration already applied is never modified). Everything above the
-- new block is charge_for_call exactly as `20260905000004` left it; the new block records what
-- the same call cost GOLD, independently of what it charged the business.
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
  v_provider_micros  bigint;
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

  -- GOLD's own cost, looked up independently of what this business is charged. No rate recorded
  -- yet reads as zero -- the same "unpriced means free" rule D40 already applies to the retail
  -- side, now applied to cost.
  v_provider_micros := coalesce(app.provider_rate_at('voice_minutes', v_currency), 0) * v_minutes;

  insert into public.usage_events
    (organization_id, meter_id, quantity, currency, provider_cost_micros, customer_charge_micros, note)
  values
    (v_call.organization_id, 'voice_minutes', v_minutes, v_currency, v_provider_micros,
     v_charge_minor * 1000000, format('call %s', v_call.id));
end;
$fn$;

comment on function app.charge_for_call(uuid, integer) is
  'Draws the retail purse down (D40, unchanged) and records what the same call cost GOLD and charged the business (D43), both rounded up to the minute. Called once per call by record_call_event, whose deduplication is what stops a retried callback charging or recording twice.';

revoke all on function app.charge_for_call(uuid, integer) from public;
