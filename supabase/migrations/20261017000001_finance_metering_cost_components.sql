-- Finance owns valuation; Communications reports operational facts. This migration extends
-- D65's single usage ledger rather than creating a communications- or provider-specific ledger.

-- Provider cost meters are deliberately separate from tenant-facing commercial meters.
create table public.platform_provider_cost_meters (
  key         text primary key check (key ~ '^[a-z][a-z0-9_.]{2,100}$'),
  service     text not null check (length(btrim(service)) between 1 and 80),
  unit        text not null check (length(btrim(unit)) between 1 and 40),
  label       text not null check (length(btrim(label)) between 1 and 160),
  created_at  timestamptz not null default now()
);

comment on table public.platform_provider_cost_meters is
  'Vendor billing vocabulary. Separate from platform_meters, which is the stable tenant-facing commercial vocabulary.';

alter table public.platform_provider_cost_meters enable row level security;
alter table public.platform_provider_cost_meters force row level security;
create policy platform_provider_cost_meters_staff_select
  on public.platform_provider_cost_meters for select to authenticated
  using (app.is_platform_staff());
grant select on public.platform_provider_cost_meters to authenticated;

insert into public.platform_provider_cost_meters (key, service, unit, label) values
  ('voice_minutes', 'Legacy', 'minute', 'Legacy voice minute'),
  ('call_recording_minutes', 'Legacy', 'minute', 'Legacy recording minute'),
  ('sms_segment', 'Legacy', 'segment', 'Legacy SMS segment'),
  ('email_send', 'Legacy', 'send', 'Legacy email send'),
  ('transcription_seconds', 'Legacy', 'second', 'Legacy transcription second'),
  ('tts_characters', 'Legacy', 'character', 'Legacy TTS character'),
  ('ai_tokens_input', 'Legacy', 'token', 'Legacy AI input token'),
  ('ai_tokens_output', 'Legacy', 'token', 'Legacy AI output token'),
  ('telephony.pstn.outbound.minute', 'Telephony', 'minute', 'PSTN outbound minute'),
  ('telephony.pstn.inbound.minute', 'Telephony', 'minute', 'PSTN inbound minute'),
  ('telephony.client.minute', 'Telephony', 'minute', 'Browser client minute'),
  ('telephony.conference.participant_minute', 'Telephony', 'participant_minute', 'Conference participant minute'),
  ('telephony.recording.minute', 'Telephony', 'minute', 'Recording minute'),
  ('messaging.sms.outbound.segment', 'Messaging', 'segment', 'Outbound SMS segment'),
  ('messaging.sms.inbound.segment', 'Messaging', 'segment', 'Inbound SMS segment'),
  ('messaging.mms.outbound.message', 'Messaging', 'message', 'Outbound MMS message'),
  ('messaging.mms.inbound.message', 'Messaging', 'message', 'Inbound MMS message'),
  ('messaging.rcs.basic.message', 'Messaging', 'message', 'RCS message'),
  ('messaging.carrier_fee', 'Messaging', 'message', 'Carrier fee'),
  ('phone_number.local.month', 'Numbers', 'number_month', 'Local number month'),
  ('phone_number.toll_free.month', 'Numbers', 'number_month', 'Toll-free number month')
on conflict (key) do nothing;

-- Keep established commercial keys. Add only concepts that Communications can now emit.
insert into public.platform_meters (id, unit, description) values
  ('mms_messages', 'message', 'MMS messages carried for a business.'),
  ('rcs_messages', 'message', 'RCS messages carried for a business.'),
  ('phone_numbers', 'number_month', 'Phone numbers held during a billing month.')
on conflict (id) do nothing;

-- Existing provider rates remain valid history. Their old commercial meter becomes the legacy
-- cost-meter key; new versions may name a more precise provider cost meter.
alter table public.platform_provider_rates
  add column cost_meter_key text references public.platform_provider_cost_meters (key),
  add column region text,
  add column direction text check (direction is null or direction in ('inbound', 'outbound')),
  add column resource_type text,
  add column effective_to timestamptz,
  add column provider_account_id uuid references public.platform_provider_accounts (id),
  add column imported_at timestamptz not null default now(),
  add constraint platform_provider_rates_effective_window
    check (effective_to is null or effective_to > effective_from);

update public.platform_provider_rates set cost_meter_key = meter_id where cost_meter_key is null;
alter table public.platform_provider_rates alter column cost_meter_key set not null;
create index platform_provider_rates_cost_resolution_idx
  on public.platform_provider_rates
    (provider_key, cost_meter_key, effective_from desc, effective_to, region, direction, resource_type);

create function app.default_provider_cost_meter()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  new.cost_meter_key := coalesce(new.cost_meter_key, new.meter_id);
  return new;
end $fn$;

create trigger platform_provider_rates_default_cost_meter
before insert on public.platform_provider_rates
for each row execute function app.default_provider_cost_meter();

-- Auditable, modest FX: one effective-dated conversion rate and its source.
create table public.platform_fx_rates (
  id             uuid primary key default gen_random_uuid(),
  base_currency  text not null check (base_currency ~ '^[A-Z]{3}$'),
  quote_currency text not null check (quote_currency ~ '^[A-Z]{3}$'),
  rate           numeric(24,12) not null check (rate > 0),
  effective_from timestamptz not null,
  effective_to   timestamptz,
  source         text not null check (length(btrim(source)) between 1 and 200),
  imported_at    timestamptz not null default now(),
  recorded_by    uuid references auth.users (id),
  unique (base_currency, quote_currency, effective_from),
  check (base_currency <> quote_currency),
  check (effective_to is null or effective_to > effective_from)
);

alter table public.platform_fx_rates enable row level security;
alter table public.platform_fx_rates force row level security;
create policy platform_fx_rates_staff_select on public.platform_fx_rates
  for select to authenticated using (app.is_platform_staff());
grant select on public.platform_fx_rates to authenticated;

create function app.fx_rate_at(p_base text, p_quote text, p_at timestamptz)
returns table (id uuid, rate numeric)
language sql stable security definer set search_path = '' as $fn$
  select f.id, f.rate
    from public.platform_fx_rates f
   where f.base_currency = upper(btrim(p_base))
     and f.quote_currency = upper(btrim(p_quote))
     and f.effective_from <= p_at
     and (f.effective_to is null or f.effective_to > p_at)
   order by f.effective_from desc
   limit 1
$fn$;
revoke all on function app.fx_rate_at(text, text, timestamptz) from public;

create function app.provider_component_rate_at(
  p_provider_key text,
  p_cost_meter_key text,
  p_at timestamptz,
  p_region text default null,
  p_direction text default null,
  p_resource_type text default null,
  p_provider_account_id uuid default null
) returns table (id uuid, unit_amount_micros bigint, currency text)
language sql stable security definer set search_path = '' as $fn$
  select r.id, r.unit_amount_micros, r.currency
    from public.platform_provider_rates r
   where r.provider_key = p_provider_key
     and r.cost_meter_key = p_cost_meter_key
     and r.approval_state = 'approved'
     and r.effective_from <= p_at
     and (r.effective_to is null or r.effective_to > p_at)
     and (r.region is null or r.region = p_region)
     and (r.direction is null or r.direction = p_direction)
     and (r.resource_type is null or r.resource_type = p_resource_type)
     and (r.provider_account_id is null or r.provider_account_id = p_provider_account_id)
   order by
     (r.provider_account_id is not null)::integer desc,
     (r.region is not null)::integer desc,
     (r.direction is not null)::integer desc,
     (r.resource_type is not null)::integer desc,
     r.effective_from desc
   limit 1
$fn$;
revoke all on function app.provider_component_rate_at(text, text, timestamptz, text, text, text, uuid) from public;

alter table public.usage_events
  add column source_domain text not null default 'unknown'
    check (source_domain ~ '^[a-z][a-z0-9_.]{1,80}$'),
  add column source_record_id text,
  add column billing_period date,
  add constraint usage_events_source_record_pair
    check ((source_record_id is null) = (source_domain = 'unknown'));

-- One commercial event may have any number of vendor components, including none. Unknown has a
-- row and a reason; it is never encoded as zero.
create table public.usage_cost_components (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations (id),
  usage_event_id           uuid not null,
  component_key            text not null check (component_key ~ '^[a-z][a-z0-9_.:-]{1,120}$'),
  provider_key             text not null references public.platform_providers (key),
  provider_account_id      uuid references public.platform_provider_accounts (id),
  provider_binding_id      uuid,
  provider_resource_id     uuid,
  cost_meter_key           text not null references public.platform_provider_cost_meters (key),
  quantity                 numeric(24,9) not null check (quantity > 0),
  unit                     text not null check (length(btrim(unit)) between 1 and 40),
  provider_rate_id         uuid references public.platform_provider_rates (id),
  native_cost_micros       bigint check (native_cost_micros is null or native_cost_micros >= 0),
  native_currency          text check (native_currency is null or native_currency ~ '^[A-Z]{3}$'),
  reporting_cost_micros    bigint check (reporting_cost_micros is null or reporting_cost_micros >= 0),
  reporting_currency       text check (reporting_currency is null or reporting_currency ~ '^[A-Z]{3}$'),
  fx_rate_id               uuid references public.platform_fx_rates (id),
  fx_rate                  numeric(24,12) check (fx_rate is null or fx_rate > 0),
  cost_state               text not null check (cost_state in ('estimated', 'unknown')),
  unknown_reason           text,
  occurred_at              timestamptz not null,
  created_at               timestamptz not null default now(),
  unique (usage_event_id, component_key),
  foreign key (organization_id, usage_event_id)
    references public.usage_events (organization_id, id),
  foreign key (organization_id, provider_binding_id, provider_key)
    references public.organization_provider_bindings (organization_id, id, provider_key),
  foreign key (organization_id, provider_binding_id, provider_resource_id)
    references public.organization_provider_resources (organization_id, binding_id, id),
  check ((cost_state = 'unknown') = (native_cost_micros is null)),
  check ((native_cost_micros is null) = (native_currency is null)),
  check ((reporting_cost_micros is null) = (reporting_currency is null)),
  check ((fx_rate_id is null) = (fx_rate is null)),
  check (cost_state <> 'unknown' or length(btrim(unknown_reason)) > 0)
);

create index usage_cost_components_org_occurred_idx
  on public.usage_cost_components (organization_id, occurred_at desc);
create index usage_cost_components_rate_idx
  on public.usage_cost_components (provider_rate_id) where provider_rate_id is not null;
alter table public.usage_cost_components enable row level security;
alter table public.usage_cost_components force row level security;
create policy usage_cost_components_staff_select on public.usage_cost_components
  for select to authenticated using (app.is_platform_staff());
grant select on public.usage_cost_components to authenticated;

alter table public.usage_cost_components
  add constraint usage_cost_components_org_id_unique unique (organization_id, id);

create table public.usage_cost_component_adjustments (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations (id),
  cost_component_id        uuid not null,
  state                    text not null check (state in ('reconciled', 'adjusted')),
  native_cost_micros       bigint not null check (native_cost_micros >= 0),
  native_currency          text not null check (native_currency ~ '^[A-Z]{3}$'),
  provider_reference       text not null default '',
  source                   text not null check (length(btrim(source)) between 1 and 200),
  recorded_at              timestamptz not null default now(),
  recorded_by              uuid references auth.users (id),
  note                     text not null default '',
  unique (organization_id, id),
  foreign key (organization_id, cost_component_id)
    references public.usage_cost_components (organization_id, id)
);

alter table public.usage_cost_component_adjustments enable row level security;
alter table public.usage_cost_component_adjustments force row level security;
create policy usage_cost_component_adjustments_staff_select on public.usage_cost_component_adjustments
  for select to authenticated using (app.is_platform_staff());
grant select on public.usage_cost_component_adjustments to authenticated;

create function app.record_usage_cost_component(
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
  on conflict (usage_event_id, component_key) do update set component_key = excluded.component_key
  returning id into v_id;
  return v_id;
end $fn$;
revoke all on function app.record_usage_cost_component(uuid, text, text, text, numeric, text, uuid, uuid, text, text, text, text) from public;

-- Source provenance is written once in the same transaction by the operational adapter.
create function app.identify_usage_source(
  p_usage_event_id uuid, p_source_domain text, p_source_record_id text, p_billing_period date default null
) returns void language plpgsql volatile security definer set search_path = '' as $fn$
begin
  update public.usage_events
     set source_domain = p_source_domain,
         source_record_id = p_source_record_id,
         billing_period = p_billing_period
   where id = p_usage_event_id and source_domain = 'unknown';
end $fn$;
revoke all on function app.identify_usage_source(uuid, text, text, date) from public;

-- Voice emits one commercial meter and independently describes every vendor component.
create or replace function app.charge_for_call(p_call_id uuid, p_duration_seconds integer)
returns void language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_call public.calls;
  v_minutes integer;
  v_actual_minutes numeric;
  v_participant_minutes numeric;
  v_number text;
  v_binding uuid;
  v_resource uuid;
  v_feature uuid;
  v_usage uuid;
begin
  if p_duration_seconds is null or p_duration_seconds <= 0 then return; end if;
  select * into v_call from public.calls where id = p_call_id;
  if not found or v_call.status <> 'completed' then return; end if;
  v_minutes := ceil(p_duration_seconds::numeric / 60)::integer;
  v_actual_minutes := p_duration_seconds::numeric / 60;
  v_number := case v_call.direction when 'outbound' then v_call.from_number else v_call.to_number end;
  select r.id, r.binding_id into v_resource, v_binding
    from public.phone_numbers n
    join public.organization_provider_resources r
      on r.organization_id = n.organization_id and r.id = n.provider_resource_id
    join public.organization_provider_bindings b
      on b.organization_id = r.organization_id and b.id = r.binding_id and b.provider_key = 'twilio'
   where n.organization_id = v_call.organization_id and n.e164 = v_number;
  if v_binding is null then
    select id into v_binding from public.organization_provider_bindings
     where organization_id = v_call.organization_id and provider_key = 'twilio' limit 1;
  end if;
  select f.id into v_feature from public.platform_catalog_features f
    join public.platform_catalog_modules m on m.id = f.module_id
   where m.key = 'voice' and f.key = case v_call.direction when 'outbound' then 'outbound_calling' else 'inbound_calling' end;
  v_usage := app.record_usage(v_call.organization_id, 'voice_minutes', v_minutes, 'twilio',
    coalesce(v_call.ended_at, now()), v_feature, v_binding, v_resource, v_call.id::text, format('call %s', v_call.id));
  perform app.identify_usage_source(v_usage, 'communications.call', v_call.id::text);
  perform app.record_usage_cost_component(v_usage, 'pstn', 'twilio',
    case v_call.direction when 'outbound' then 'telephony.pstn.outbound.minute' else 'telephony.pstn.inbound.minute' end,
    v_minutes, 'minute', v_binding, v_resource, 'CA', v_call.direction, null, 'CAD');
  perform app.record_usage_cost_component(v_usage, 'browser_client', 'twilio',
    'telephony.client.minute', v_minutes, 'minute', v_binding, v_resource, null, v_call.direction, null, 'CAD');
  select coalesce(sum(extract(epoch from (coalesce(left_at, v_call.ended_at, now()) - joined_at)) / 60), 0)
    into v_participant_minutes from public.call_participants
   where organization_id = v_call.organization_id and call_id = v_call.id and joined_at is not null;
  if v_participant_minutes <= 0 then v_participant_minutes := v_actual_minutes * 2; end if;
  perform app.record_usage_cost_component(v_usage, 'conference', 'twilio',
    'telephony.conference.participant_minute', v_participant_minutes, 'participant_minute',
    v_binding, v_resource, null, v_call.direction, null, 'CAD');
  if v_call.recording_url is not null then
    perform app.record_usage_cost_component(v_usage, 'recording', 'twilio',
      'telephony.recording.minute', v_minutes, 'minute', v_binding, v_resource, null, null, null, 'CAD');
  end if;
end $fn$;
revoke all on function app.charge_for_call(uuid, integer) from public;

alter table public.messages add column segment_count integer check (segment_count is null or segment_count > 0);

create or replace function app.charge_for_message(p_message_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_message public.messages;
  v_segments integer;
  v_binding uuid;
  v_resource uuid;
  v_feature uuid;
  v_meter text;
  v_cost_meter text;
  v_usage uuid;
begin
  select * into v_message from public.messages where id = p_message_id;
  if not found or v_message.status in ('failed', 'undelivered') or v_message.transport is null then return; end if;
  v_segments := coalesce(v_message.segment_count, greatest(1, ceil(length(v_message.body)::numeric / 160)::integer));
  v_meter := case v_message.transport when 'sms' then 'sms_segment' when 'mms' then 'mms_messages' else 'rcs_messages' end;
  v_cost_meter := case
    when v_message.transport = 'sms' and v_message.direction = 'outbound' then 'messaging.sms.outbound.segment'
    when v_message.transport = 'sms' then 'messaging.sms.inbound.segment'
    when v_message.transport = 'mms' and v_message.direction = 'outbound' then 'messaging.mms.outbound.message'
    when v_message.transport = 'mms' then 'messaging.mms.inbound.message'
    else 'messaging.rcs.basic.message' end;
  select r.id, r.binding_id into v_resource, v_binding
    from public.conversations c
    join public.phone_numbers n on n.organization_id = c.organization_id and n.id = c.phone_number_id
    join public.organization_provider_resources r on r.organization_id = n.organization_id and r.id = n.provider_resource_id
    join public.organization_provider_bindings b on b.organization_id = r.organization_id and b.id = r.binding_id and b.provider_key = 'twilio'
   where c.organization_id = v_message.organization_id and c.id = v_message.conversation_id;
  if v_binding is null then select id into v_binding from public.organization_provider_bindings where organization_id = v_message.organization_id and provider_key = 'twilio' limit 1; end if;
  select f.id into v_feature from public.platform_catalog_features f
    join public.platform_catalog_modules m on m.id = f.module_id
   where m.key = 'sms' and f.key = case v_message.direction when 'outbound' then 'outbound_sms' else 'inbound_sms' end;
  v_usage := app.record_usage(v_message.organization_id, v_meter,
    case when v_message.transport = 'sms' then v_segments else 1 end,
    'twilio', coalesce(v_message.sent_at, v_message.created_at), v_feature, v_binding, v_resource,
    v_message.id::text, format('message %s', v_message.id));
  perform app.identify_usage_source(v_usage, 'communications.message', v_message.id::text);
  perform app.record_usage_cost_component(v_usage, 'transport', 'twilio', v_cost_meter,
    case when v_message.transport = 'sms' then v_segments else 1 end,
    case when v_message.transport = 'sms' then 'segment' else 'message' end,
    v_binding, v_resource, 'CA', v_message.direction, null, 'CAD');
end $fn$;
revoke all on function app.charge_for_message(uuid) from public;

create or replace function public.record_message_status(
  p_external_id text, p_status text, p_failure_reason text default null
) returns uuid language plpgsql volatile security definer set search_path = '' as $fn$
declare v_id uuid; v_previous_status text;
begin
  select status into v_previous_status from public.messages where external_id = p_external_id;
  update public.messages set status = p_status,
    failure_reason = coalesce(p_failure_reason, failure_reason),
    delivered_at = case when p_status in ('delivered', 'read') then coalesce(delivered_at, now()) else delivered_at end
   where external_id = p_external_id returning id into v_id;
  if v_id is not null and p_status in ('sent', 'delivered', 'read')
     and v_previous_status not in ('sent', 'delivered', 'read') then
    perform app.charge_for_message(v_id);
  end if;
  return v_id;
end $fn$;
revoke all on function public.record_message_status(text, text, text) from public;
grant execute on function public.record_message_status(text, text, text) to sms_webhook;

-- An explicit, idempotent number-month producer. No automatic historical backfill is attempted:
-- phone_numbers does not retain a trustworthy historical active interval for every old row.
create function public.record_phone_number_month(p_phone_number_id uuid, p_billing_period date)
returns uuid language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_number public.phone_numbers;
  v_binding uuid;
  v_usage uuid;
  v_period date := date_trunc('month', p_billing_period)::date;
  v_cost_meter text;
begin
  perform app.require_platform_staff();
  select * into v_number from public.phone_numbers where id = p_phone_number_id;
  if not found then raise exception 'no such phone number' using errcode = '23503'; end if;
  if v_number.lifecycle <> 'active' then return null; end if;
  select binding_id into v_binding from public.organization_provider_resources
   where organization_id = v_number.organization_id and id = v_number.provider_resource_id;
  v_cost_meter := case when v_number.e164 like '+18%' then 'phone_number.toll_free.month' else 'phone_number.local.month' end;
  v_usage := app.record_usage(v_number.organization_id, 'phone_numbers', 1, 'twilio',
    v_period::timestamptz, null, v_binding, v_number.provider_resource_id,
    format('%s:%s', v_number.id, to_char(v_period, 'YYYY-MM')), format('number %s for %s', v_number.id, to_char(v_period, 'YYYY-MM')));
  perform app.identify_usage_source(v_usage, 'communications.phone_number', v_number.id::text, v_period);
  perform app.record_usage_cost_component(v_usage, 'rental', 'twilio', v_cost_meter, 1,
    'number_month', v_binding, v_number.provider_resource_id, 'CA', null, 'twilio_phone_number', 'CAD');
  return v_usage;
end $fn$;
revoke all on function public.record_phone_number_month(uuid, date) from public;
grant execute on function public.record_phone_number_month(uuid, date) to authenticated;

create function public.record_provider_cost_rate(
  p_provider_key text,
  p_commercial_meter_id text,
  p_cost_meter_key text,
  p_currency text,
  p_unit_amount_micros bigint,
  p_effective_from timestamptz,
  p_source text,
  p_region text default null,
  p_direction text default null,
  p_resource_type text default null,
  p_effective_to timestamptz default null,
  p_provider_account_id uuid default null,
  p_note text default ''
) returns uuid language plpgsql volatile security definer set search_path = '' as $fn$
declare v_id uuid;
begin
  perform app.require_platform_staff();
  if p_effective_from < now() - interval '5 minutes' then
    raise exception 'a new provider rate cannot rewrite the past' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.platform_provider_rates r
     where r.provider_key = p_provider_key and r.cost_meter_key = p_cost_meter_key
       and r.currency = upper(btrim(p_currency))
       and coalesce(r.region, '') = coalesce(nullif(btrim(p_region), ''), '')
       and coalesce(r.direction, '') = coalesce(p_direction, '')
       and coalesce(r.resource_type, '') = coalesce(nullif(btrim(p_resource_type), ''), '')
       and r.provider_account_id is not distinct from p_provider_account_id
       and r.effective_from = p_effective_from
       and r.unit_amount_micros = p_unit_amount_micros
  ) then
    select r.id into v_id from public.platform_provider_rates r
     where r.provider_key = p_provider_key and r.cost_meter_key = p_cost_meter_key
       and r.currency = upper(btrim(p_currency)) and r.effective_from = p_effective_from
     limit 1;
    return v_id;
  end if;
  insert into public.platform_provider_rates (
    provider_key, meter_id, cost_meter_key, currency, unit_amount_micros, effective_from,
    effective_to, approval_state, source, recorded_by, note, region, direction,
    resource_type, provider_account_id)
  values (p_provider_key, p_commercial_meter_id, p_cost_meter_key, upper(btrim(p_currency)),
    p_unit_amount_micros, p_effective_from, p_effective_to, 'approved', p_source,
    auth.uid(), coalesce(p_note, ''), nullif(btrim(p_region), ''), p_direction,
    nullif(btrim(p_resource_type), ''), p_provider_account_id)
  returning id into v_id;
  return v_id;
end $fn$;
revoke all on function public.record_provider_cost_rate(text, text, text, text, bigint, timestamptz, text, text, text, text, timestamptz, uuid, text) from public;
grant execute on function public.record_provider_cost_rate(text, text, text, text, bigint, timestamptz, text, text, text, text, timestamptz, uuid, text) to authenticated;

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
  known_cost_micros bigint, reporting_currency text, cost_state text
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
              else 'estimated' end
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
revoke all on function public.platform_usage_economics(timestamptz, timestamptz, uuid, text, text, text) from public;
grant execute on function public.platform_usage_economics(timestamptz, timestamptz, uuid, text, text, text) to authenticated;

create function public.platform_usage_cost_components(p_usage_event_id uuid)
returns table (
  id uuid, component_key text, provider_key text, cost_meter_key text, quantity numeric,
  unit text, provider_rate_id uuid, native_cost_micros bigint, native_currency text,
  reporting_cost_micros bigint, reporting_currency text, cost_state text,
  unknown_reason text, effective_state text
) language sql stable security definer set search_path = '' as $fn$
  select app.require_platform_staff();
  select c.id, c.component_key, c.provider_key, c.cost_meter_key, c.quantity, c.unit,
         c.provider_rate_id, coalesce(a.native_cost_micros, c.native_cost_micros),
         coalesce(a.native_currency, c.native_currency), c.reporting_cost_micros,
         c.reporting_currency, c.cost_state, c.unknown_reason,
         coalesce(a.state, c.cost_state)
    from public.usage_cost_components c
    left join lateral (
      select x.native_cost_micros, x.native_currency, x.state
        from public.usage_cost_component_adjustments x
       where x.organization_id = c.organization_id and x.cost_component_id = c.id
       order by x.recorded_at desc limit 1
    ) a on true
   where c.usage_event_id = p_usage_event_id
   order by c.component_key
$fn$;
revoke all on function public.platform_usage_cost_components(uuid) from public;
grant execute on function public.platform_usage_cost_components(uuid) to authenticated;
