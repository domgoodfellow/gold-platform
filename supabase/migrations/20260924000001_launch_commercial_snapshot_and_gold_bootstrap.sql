-- Approved launch snapshot from GOLD Business Financial Model, captured 2026-09-11.
-- Imported rows intentionally have no human author: NULL recorded_by means deployment/source import.

alter table public.platform_plan_prices alter column recorded_by drop not null;
alter table public.platform_provider_rates alter column recorded_by drop not null;
alter table public.platform_retail_rates alter column recorded_by drop not null;
alter table public.platform_plans alter column created_by drop not null;
comment on column public.platform_plan_prices.recorded_by is
  'Authenticated staff author for runtime entries; NULL means a deployment/source import with provenance on the row.';
comment on column public.platform_provider_rates.recorded_by is
  'Authenticated staff author for runtime entries; NULL means a deployment/source import with provenance on the row.';
comment on column public.platform_retail_rates.recorded_by is
  'Authenticated staff author for runtime entries; NULL means a deployment/source import with provenance on the row.';
comment on column public.platform_plans.created_by is
  'Authenticated staff creator for runtime entries; NULL means a deployment/source import.';

alter table public.platform_plan_prices drop constraint platform_plan_prices_unique_moment;
alter table public.platform_plan_prices add constraint platform_plan_prices_unique_moment
  unique (plan_id, currency, billing_interval, effective_from);

create table public.platform_plan_cost_assumptions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.platform_plans(id) on delete cascade,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  provider_cost_minor bigint not null check (provider_cost_minor >= 0),
  labour_cost_minor bigint not null check (labour_cost_minor >= 0),
  source text not null default '',
  source_url text,
  captured_at timestamptz not null default now(),
  note text not null default '',
  unique (plan_id, currency, captured_at)
);
comment on table public.platform_plan_cost_assumptions is
  'Monthly planning COGS and labour assumptions, not accounting facts. Margins are derived at read time.';
alter table public.platform_plan_cost_assumptions enable row level security;
alter table public.platform_plan_cost_assumptions force row level security;
create policy platform_plan_cost_assumptions_staff_select on public.platform_plan_cost_assumptions
  for select to authenticated using ((select app.is_platform_staff()));
grant select on public.platform_plan_cost_assumptions to authenticated;

do $seed$
declare
  v_captured constant timestamptz := '2026-09-11 00:00:00+00';
  v_source constant text := 'GOLD Business Financial Model / 06 Price Book / 07 Pricing Tiers';
begin
  insert into public.platform_plans (key, kind, label, description, billable, sale_status, display_order, created_by) values
    ('platform', 'plan', 'GOLD Platform', 'Core GOLD operating platform.', true, 'active', 10, null),
    ('sales_os_founding', 'plan', 'Sales OS — Founding', 'Founding launch Sales OS offer.', true, 'unlisted', 20, null),
    ('sales_os', 'plan', 'Sales OS', 'Sales operating system.', true, 'active', 30, null),
    ('operations_os', 'plan', 'Operations OS', 'Operations operating system.', true, 'active', 40, null),
    ('business_managed', 'plan', 'Business / Managed', 'Combined sales and operations offer.', true, 'active', 50, null),
    ('additional_user', 'addon', 'Additional standard user', 'One additional standard user.', true, 'active', 110, null),
    ('additional_caller', 'addon', 'Additional calling user', 'One additional calling user.', true, 'active', 120, null),
    ('local_phone_number', 'addon', 'Local phone number', 'One local phone number.', true, 'active', 130, null),
    ('ai_lite', 'addon', 'AI Lite', 'AI Lite add-on.', true, 'active', 140, null),
    ('ai_pro', 'addon', 'AI Pro', 'AI Pro add-on.', true, 'active', 150, null),
    ('advanced_routing', 'addon', 'Advanced Routing', 'Advanced routing add-on.', true, 'active', 160, null),
    ('premium_support', 'addon', 'Premium Support', 'Premium support add-on.', true, 'active', 170, null),
    ('standard_implementation', 'addon', 'Standard Implementation', 'One-time standard implementation.', true, 'active', 180, null),
    ('advanced_migration', 'addon', 'Advanced Migration', 'One-time advanced migration.', true, 'active', 190, null)
  on conflict (key) do nothing;

  insert into public.platform_plan_prices (plan_id, currency, amount_minor, billing_interval, effective_from, approval_state, source, captured_at, recorded_by, note)
  select p.id, 'CAD', x.amount, x.interval, v_captured, 'approved', v_source, v_captured, null, 'Approved launch pricing snapshot.'
  from (values
    ('platform','month',49500), ('platform','year',534600),
    ('sales_os_founding','month',179500), ('sales_os_founding','year',1938600),
    ('sales_os','month',199500), ('sales_os','year',2154600),
    ('operations_os','month',149500), ('operations_os','year',1614600),
    ('business_managed','month',299500), ('business_managed','year',3234600),
    ('additional_user','month',3500), ('additional_caller','month',7500), ('local_phone_number','month',500),
    ('ai_lite','month',9900), ('ai_pro','month',29900), ('advanced_routing','month',19900), ('premium_support','month',49900),
    ('standard_implementation','one_time',250000), ('advanced_migration','one_time',750000)
  ) as x(key, interval, amount) join public.platform_plans p on p.key=x.key
  on conflict (plan_id, currency, billing_interval, effective_from) do nothing;

  insert into public.platform_plan_quotas (plan_id, allowance_key, label, unit, included_quantity, period, overage_policy, meter_id, display_order)
  select p.id, q.key, q.label, q.unit, q.quantity, 'month', q.overage, q.meter, q.display_order
  from (values
    ('platform','users','Users','user',5::numeric,'not_applicable',null::text,1),
    ('sales_os_founding','users','Users','user',10,'not_applicable',null,1), ('sales_os_founding','calling_users','Calling users','user',5,'not_applicable',null,2), ('sales_os_founding','intelligent_call_minutes','Intelligent call minutes','minute',2500,'allowed','voice_minutes',3), ('sales_os_founding','sms_segments','SMS segments','segment',1000,'allowed','sms_segment',4),
    ('sales_os','users','Users','user',10,'not_applicable',null,1), ('sales_os','calling_users','Calling users','user',5,'not_applicable',null,2), ('sales_os','intelligent_call_minutes','Intelligent call minutes','minute',2500,'allowed','voice_minutes',3), ('sales_os','sms_segments','SMS segments','segment',1000,'allowed','sms_segment',4),
    ('operations_os','users','Users','user',10,'not_applicable',null,1), ('operations_os','technicians','Technicians','user',5,'not_applicable',null,2), ('operations_os','sms_segments','SMS segments','segment',2000,'allowed','sms_segment',3),
    ('business_managed','users','Users','user',20,'not_applicable',null,1), ('business_managed','calling_users','Calling users','user',10,'not_applicable',null,2), ('business_managed','technicians','Technicians','user',10,'not_applicable',null,3), ('business_managed','intelligent_call_minutes','Intelligent call minutes','minute',5000,'allowed','voice_minutes',4), ('business_managed','sms_segments','SMS segments','segment',5000,'allowed','sms_segment',5),
    ('additional_user','users','Users','user',1,'not_applicable',null,1), ('additional_caller','calling_users','Calling users','user',1,'not_applicable',null,1), ('local_phone_number','phone_numbers','Phone numbers','number',1,'not_applicable',null,1)
  ) as q(plan_key,key,label,unit,quantity,overage,meter,display_order) join public.platform_plans p on p.key=q.plan_key
  on conflict (plan_id, allowance_key) do nothing;

  insert into public.platform_plan_cost_assumptions (plan_id,currency,provider_cost_minor,labour_cost_minor,source,captured_at,note)
  select p.id,'CAD',x.provider_cost,x.labour_cost,v_source,v_captured,'Monthly planning assumption.'
  from (values ('platform',4500,4500),('sales_os_founding',26500,13500),('sales_os',28500,13500),('operations_os',12800,13500),('business_managed',42500,22500)) x(key,provider_cost,labour_cost)
  join public.platform_plans p on p.key=x.key on conflict do nothing;

  -- Only currently available, truthful catalogue features are granted; planned items remain ungranted.
  insert into public.platform_plan_feature_grants (plan_id, feature_id, included)
  select p.id, f.id, true from public.platform_plans p
  join public.platform_catalog_features f on f.implementation_state='available'
  where (p.key='platform' and f.key in ('contacts','pipeline','booking','rule_authoring','run_history'))
     or (p.key in ('sales_os_founding','sales_os') and f.key in ('contacts','pipeline','outbound_calling','inbound_calling','rule_authoring','run_history'))
     or (p.key='operations_os' and f.key in ('contacts','booking','jobs','schedule','resources','customer_portal','rule_authoring','run_history'))
     or (p.key='business_managed' and f.key in ('contacts','pipeline','outbound_calling','inbound_calling','booking','jobs','schedule','resources','customer_portal','rule_authoring','run_history'))
  on conflict do nothing;

  insert into public.communication_rates (currency, channel, unit_amount_minor)
  values ('CAD','voice',12), ('CAD','sms',6)
  on conflict (currency,channel) do update set unit_amount_minor=excluded.unit_amount_minor, updated_at=now();

  insert into public.platform_provider_rates (provider_key,meter_id,currency,unit_amount_micros,effective_from,approval_state,source,source_url,captured_at,recorded_by,note)
  values
    ('twilio','voice_minutes','USD',1400000,v_captured,'approved','Twilio Canada Voice Pricing','https://www.twilio.com/en-us/voice/pricing/ca',v_captured,null,'Canada outbound voice baseline; generic meter does not encode direction.'),
    ('twilio','sms_segment','USD',830000,v_captured,'approved','Twilio Canada SMS Pricing','https://www.twilio.com/en-us/sms/pricing/ca',v_captured,null,'Canada long-code SMS.'),
    ('deepgram','transcription_seconds','USD',12833,v_captured,'approved','Deepgram pricing','https://deepgram.com/pricing',v_captured,null,'Nova-3 STT, normalized from USD 0.0077/min.'),
    ('elevenlabs','transcription_seconds','USD',6111,v_captured,'approved','ElevenLabs API pricing','https://elevenlabs.io/pricing/api',v_captured,null,'Scribe v1/v2, normalized from USD 0.22/hour.'),
    ('elevenlabs','tts_characters','USD',7750,v_captured,'draft','GOLD Business Financial Model / 03 Provider DB','https://elevenlabs.io/pricing/api',v_captured,null,'Planning midpoint USD 0.0775/1K characters, not a verified billed SKU.'),
    ('openai_compatible','ai_tokens_input','USD',25,v_captured,'draft','OpenAI API pricing','https://openai.com/api/pricing/',v_captured,null,'Planning benchmark: OpenAI GPT-5 mini; provider key is the platform''s OpenAI-compatible runtime class.'),
    ('openai_compatible','ai_tokens_output','USD',200,v_captured,'draft','OpenAI API pricing','https://openai.com/api/pricing/',v_captured,null,'Planning benchmark: OpenAI GPT-5 mini; provider key is the platform''s OpenAI-compatible runtime class.'),
    ('resend','email_send','USD',90000,v_captured,'approved','Resend pricing','https://resend.com/pricing',v_captured,null,'Overage USD 0.90/1,000 emails.')
  on conflict (provider_key,meter_id,currency,effective_from) do nothing;
end;
$seed$;

-- Interval is part of price identity and resolution. The three-argument wrapper preserves old monthly callers.
drop function if exists public.organization_plan_price(uuid, uuid, timestamptz);
create function public.organization_plan_price(p_organization_id uuid, p_plan_id uuid, p_at timestamptz, p_billing_interval text)
returns table (amount_minor bigint, currency text, source text) language sql stable security invoker set search_path = '' as $fn$
  (select amount_minor,currency,'agreement'::text from public.organization_plan_agreements where organization_id=p_organization_id and plan_id=p_plan_id and effective_from<=p_at order by effective_from desc limit 1)
  union all
  (select amount_minor,currency,'standard'::text from public.platform_plan_prices where plan_id=p_plan_id and billing_interval=p_billing_interval and approval_state='approved' and effective_from<=p_at and not exists (select 1 from public.organization_plan_agreements where organization_id=p_organization_id and plan_id=p_plan_id and effective_from<=p_at) order by effective_from desc limit 1);
$fn$;
create function public.organization_plan_price(p_organization_id uuid, p_plan_id uuid, p_at timestamptz default now())
returns table (amount_minor bigint, currency text, source text) language sql stable security invoker set search_path = '' as $fn$
  select * from public.organization_plan_price(p_organization_id,p_plan_id,p_at,'month');
$fn$;
grant execute on function public.organization_plan_price(uuid,uuid,timestamptz,text) to authenticated;
grant execute on function public.organization_plan_price(uuid,uuid,timestamptz) to authenticated;
