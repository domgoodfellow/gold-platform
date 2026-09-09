-- A meter is what was consumed; a provider is who was paid for it. D43 conflated the two --
-- `platform_meters.provider` baked one vendor into each meter's own row, which cannot express
-- Deepgram *or* ElevenLabs both answering `transcription_seconds`, or an OpenAI-compatible host
-- sitting beside Anthropic on `ai_tokens_input`. The next slice (provider bindings) needs that
-- expressed now, before it has anything to bind.
--
-- **Why this is a migration and not an edit.** `20260910000001` already shipped and is never
-- modified (D15). This corrects it forward.

-- ---------------------------------------------------------------------------
-- Providers, named apart from what they provide
-- ---------------------------------------------------------------------------

-- Platform vocabulary, migration-written, exactly like `platform_meters` itself -- a tenant
-- never names one of these.
create table public.platform_providers (
  key        text        primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label      text        not null check (length(btrim(label)) between 1 and 120),
  created_at timestamptz not null default now()
);

comment on table public.platform_providers is
  'Who GOLD pays for a unit of a meter. Decoupled from platform_meters on purpose: two providers can answer the same meter (Deepgram and ElevenLabs both transcribe), and the same provider can answer several meters.';

alter table public.platform_providers enable row level security;
alter table public.platform_providers force row level security;

create policy platform_providers_select on public.platform_providers
  for select to authenticated using (true);

create policy platform_providers_platform_select on public.platform_providers
  for select to platform_staff using (true);

grant select on public.platform_providers to authenticated;
grant select on public.platform_providers to platform_staff;

-- **A gap this migration also closes.** Staff have read the /platform console's businesses
-- since M5, but nothing ever granted the `platform_staff` role `select` on `platform_meters` or
-- `platform_products` themselves -- both were written only for `authenticated` in
-- `20260910000001`. The console has called `listMeters`/`listProducts` under the staff session
-- since that migration; this is the first thing to actually exercise that path with a test.
grant select on public.platform_meters to platform_staff;
grant select on public.platform_products to platform_staff;

create policy platform_meters_platform_select on public.platform_meters
  for select to platform_staff using (true);

create policy platform_products_platform_select on public.platform_products
  for select to platform_staff using (true);

insert into public.platform_providers (key, label) values
  ('twilio',           'Twilio'),
  ('deepgram',          'Deepgram'),
  ('elevenlabs',        'ElevenLabs'),
  ('anthropic',         'Anthropic'),
  ('openai_compatible', 'An OpenAI-compatible hosted model'),
  ('resend',            'Resend');

-- ---------------------------------------------------------------------------
-- A meter stops naming one
-- ---------------------------------------------------------------------------

-- The eight rows already there keep their ids, units and descriptions -- only which vendor
-- fulfils each one is no longer part of a meter's own identity, so this changes no historical
-- usage's meaning (a row already written still says `voice_minutes`, exactly as before).
alter table public.platform_meters drop column provider;

comment on table public.platform_meters is
  'What can be metered -- consumption, not vendor. Platform vocabulary, migration-written. Which provider answers a meter, for a given business, is a provider rate (platform_provider_rates) and, per reading, usage_events.provider_key -- never this table.';

-- ---------------------------------------------------------------------------
-- A provider rate is now keyed by provider too
-- ---------------------------------------------------------------------------

-- Nothing has been seeded into this table yet (D43's own rule -- "nothing is seeded" for a
-- rate), so there is no existing row to backfill a provider onto.
alter table public.platform_provider_rates
  add column provider_key text references public.platform_providers (key);

-- One rate per provider, per meter, per currency, per moment -- the old constraint named only
-- meter and currency, which could not tell Deepgram's price from ElevenLabs's for the same
-- meter.
alter table public.platform_provider_rates
  drop constraint platform_provider_rates_unique_moment;

alter table public.platform_provider_rates
  alter column provider_key set not null,
  add constraint platform_provider_rates_unique_moment
    unique (provider_key, meter_id, currency, effective_from);

comment on table public.platform_provider_rates is
  'What GOLD pays a named provider per unit of a meter, per currency, effective-dated (D43). Append-only. Never selectable by a tenant.';

-- ---------------------------------------------------------------------------
-- "Current," now answering in the provider's own currency rather than one asked for
-- ---------------------------------------------------------------------------

-- **The bug this corrects.** The old signature took a currency argument and `charge_for_call`
-- passed the *tenant's* currency -- treating "what does a Canadian tenant trade in" as though it
-- answered "what does Twilio bill GOLD in", which are unrelated facts. A provider bills GOLD in
-- its own currency regardless of who the call was for. This function now returns whichever
-- currency the latest approved rate for that provider and meter was itself recorded in, rather
-- than being told which currency to look for.
drop function if exists app.provider_rate_at(text, text, timestamptz);

create function app.provider_rate_at(
  p_provider_key text,
  p_meter_id     text,
  p_at           timestamptz default now()
)
returns table (unit_amount_micros bigint, currency text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.unit_amount_micros, r.currency
    from public.platform_provider_rates r
   where r.provider_key = p_provider_key
     and r.meter_id = p_meter_id
     and r.approval_state = 'approved'
     and r.effective_from <= p_at
   order by r.effective_from desc
   limit 1;
$fn$;

comment on function app.provider_rate_at(text, text, timestamptz) is
  'GOLD''s own wholesale price per unit from a named provider, in micro-minor-units, and the currency the provider itself bills in -- not a currency the caller supplies. No row means unpriced, which callers read as free (D40''s own rule for an unpriced channel, applied here to cost).';

revoke all on function app.provider_rate_at(text, text, timestamptz) from public;

-- ---------------------------------------------------------------------------
-- Recording a provider rate now says which provider
-- ---------------------------------------------------------------------------

drop function if exists public.record_provider_rate(text, text, bigint, text, text, text, text);

create function public.record_provider_rate(
  p_provider_key       text,
  p_meter_id           text,
  p_currency           text,
  p_unit_amount_micros bigint,
  p_source             text,
  p_source_url         text default null,
  p_approval_state     text default 'approved',
  p_note               text default ''
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_staff uuid := (select auth.uid());
  v_name  text;
  v_id    uuid;
begin
  v_name := app.require_platform_staff();

  if p_approval_state not in ('draft', 'approved') then
    raise exception 'unknown approval state: %', p_approval_state using errcode = '22023';
  end if;

  insert into public.platform_provider_rates
    (provider_key, meter_id, currency, unit_amount_micros, approval_state, source, source_url, recorded_by, note)
  values
    (p_provider_key, p_meter_id, upper(btrim(p_currency)), p_unit_amount_micros, p_approval_state, p_source, p_source_url, v_staff, p_note)
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.record_provider_rate(text, text, text, bigint, text, text, text, text) is
  'The only way to write a wholesale rate, now naming which provider it prices. Staff-checked, SECURITY DEFINER, no table grant behind it (I21''s shape).';

revoke all on function public.record_provider_rate(text, text, text, bigint, text, text, text, text) from public;
grant execute on function public.record_provider_rate(text, text, text, bigint, text, text, text, text) to platform_staff;
