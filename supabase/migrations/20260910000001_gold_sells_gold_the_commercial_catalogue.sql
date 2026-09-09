-- GOLD's own commercial catalogue: what can be metered, what is sold, and what each costs.
--
-- **The question this migration starts answering.** Every table in this platform so far answers
-- a question about a *tenant's* business -- what they charge, what a job cost, what reaching a
-- customer costs them (D40). Nothing answers the question GOLD needs about itself: what do we
-- sell, and what does it cost us. This is that layer's vocabulary and its two rate cards. The
-- next three migrations build the parts that use it: entitlement (D41, generalized), the usage
-- ledger, and the platform console that reads all of it.
--
-- **Two money paths, restated for a third time (D27, D42).** A tenant's `price_book_items` is
-- what a business sells its own customers. What follows here is GOLD selling GOLD -- a different
-- direction entirely, which is why it lives in `lib/domain/commercial/`, never `lib/domain/billing/`.

-- ---------------------------------------------------------------------------
-- A shared gate, extracted before its second caller rather than after (this migration and the
-- next both need it, and a third arrives with usage reconciliation)
-- ---------------------------------------------------------------------------

-- The exact check `provision_organization` already makes, pulled out because this change adds
-- several more callers of it at once -- the bar for extracting a rule, met in one change rather
-- than found the slow way across several. Returns the staff member's own name (for an audit
-- payload) and raises otherwise; it does not take a table grant with it, so `platform_staff`
-- still holds none.
create function app.require_platform_staff()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_name  text;
begin
  if v_actor is null then
    raise exception 'this operation requires an authenticated caller' using errcode = '42501';
  end if;

  select s.name into v_name from public.platform_staff s where s.user_id = v_actor;

  if v_name is null then
    raise exception 'only platform staff may do this' using errcode = '42501';
  end if;

  return v_name;
end;
$fn$;

comment on function app.require_platform_staff() is
  'Raises unless the caller is listed in platform_staff; returns their name for an audit payload otherwise. Called from inside other SECURITY DEFINER functions -- it carries no grant of its own, exactly as platform_staff carries no table grant.';

revoke all on function app.require_platform_staff() from public;

-- ---------------------------------------------------------------------------
-- What can be metered
-- ---------------------------------------------------------------------------

-- **A table, not an enum** -- unlike `communication_channel`, because a new provider should be a
-- row, not a migration touching this table's own shape. Platform vocabulary (D6's reasoning,
-- applied to money): a tenant never names one of these, and none is derived from anything a
-- tenant configures.
create table public.platform_meters (
  id          text        primary key check (id ~ '^[a-z][a-z0-9_]{1,60}$'),
  provider    text        not null check (length(btrim(provider)) between 1 and 40),
  unit        text        not null check (length(btrim(unit)) between 1 and 40),
  description text        not null check (length(btrim(description)) between 1 and 200),
  created_at  timestamptz not null default now()
);

comment on table public.platform_meters is
  'What can be metered. Platform vocabulary, migration-written. Defining a meter is not the same claim as pricing or charging it -- see platform_provider_rates and usage_events, where "nothing is seeded" still holds.';

alter table public.platform_meters enable row level security;
alter table public.platform_meters force row level security;

create policy platform_meters_select on public.platform_meters
  for select to authenticated using (true);

grant select on public.platform_meters to authenticated;

-- **Eight named meters, one real writer.** `charge_for_call` (this slice, migration four) is the
-- only caller that ever writes a `usage_events` row today, for `voice_minutes`. The other seven
-- are vocabulary only -- exactly as `communication_channel` shipped `sms` and `email` for two
-- migrations before either one actually charged anything. Naming what CAN be metered is the
-- generalization the owner asked for; wiring every provider's adapter is not this slice.
insert into public.platform_meters (id, provider, unit, description) values
  ('voice_minutes',           'twilio',     'minute',    'A call, billed by the minute GOLD is charged for.'),
  ('call_recording_minutes',  'twilio',     'minute',    'Storing and retrieving a call recording, billed by the minute recorded.'),
  ('sms_segment',             'twilio',     'segment',   'One text message segment.'),
  ('email_send',              'resend',     'send',      'One email sent on a business''s behalf.'),
  ('transcription_seconds',   'deepgram',   'second',    'Turning recorded audio into text, billed by the second transcribed.'),
  ('tts_characters',          'elevenlabs', 'character', 'Turning text into spoken audio, billed by the character spoken.'),
  ('ai_tokens_input',         'anthropic',  'token',     'What a model reads while answering a question or drafting a configuration.'),
  ('ai_tokens_output',        'anthropic',  'token',     'What a model writes while answering a question or drafting a configuration.');

-- ---------------------------------------------------------------------------
-- What GOLD sells, recurring
-- ---------------------------------------------------------------------------

create table public.platform_products (
  key        text        primary key check (key ~ '^[a-z][a-z0-9_:]{1,60}$'),
  kind       text        not null check (kind in ('platform', 'module', 'seat')),

  -- Matches organization_modules.module_key -- not a foreign key to it, for the same reason that
  -- column isn't a foreign key to anything either: a module is a key MODULES names, not a row a
  -- table can reference.
  module_key text        check (module_key ~ '^[a-z][a-z_]{1,40}$'),
  label      text        not null check (length(btrim(label)) between 1 and 120),
  created_at timestamptz not null default now(),

  constraint platform_products_module_key_matches_kind
    check ((kind = 'module') = (module_key is not null))
);

comment on table public.platform_products is
  'What GOLD sells, recurring. A term (organization_commercial_terms, next migration) names one of these rather than describing itself. Migration-written, like platform_meters -- vision.md''s "platform fee + modules + usage" is base + module + seat here, usage being the meters above.';

alter table public.platform_products enable row level security;
alter table public.platform_products force row level security;

create policy platform_products_select on public.platform_products
  for select to authenticated using (true);

grant select on public.platform_products to authenticated;

-- One row per module MODULES actually lists (`apps/web/lib/navigation.ts`) -- `work`,
-- `scheduling` and `customers` are rows `organization_modules` has always carried but are not
-- real switches (no MODULES entry, D25), so there is nothing for a term to cover for them.
insert into public.platform_products (key, kind, module_key, label) values
  ('platform_base',        'platform', null,             'Platform'),
  ('module:billing',       'module',   'billing',        'Billing'),
  ('module:assets',        'module',   'assets',         'Assets'),
  ('module:booking',       'module',   'booking',        'Public booking'),
  ('module:portal',        'module',   'portal',         'Customer portal'),
  ('module:automations',   'module',   'automations',    'Automations'),
  ('module:weather',       'module',   'weather',        'Weather'),
  ('module:maintenance',   'module',   'maintenance',    'Maintenance'),
  ('module:drafting',      'module',   'drafting',       'Guided setup'),
  ('module:assistant',     'module',   'assistant',      'Ask'),
  ('module:reporting',     'module',   'reporting',      'Reporting'),
  ('module:card_payments', 'module',   'card_payments',  'Card payments'),
  ('module:reception',     'module',   'reception',      'Reception and sales'),
  ('seat:reception_agent', 'seat',     null,             'Reception seat');

-- ---------------------------------------------------------------------------
-- The two rate cards -- what GOLD pays, and what GOLD charges
-- ---------------------------------------------------------------------------

-- **Millionths of one minor currency unit, not minor units themselves (D43).** A per-unit
-- wholesale price is routinely sub-cent -- a minute of transcription or a single AI token costs a
-- small fraction of a cent -- and rounding that to the nearest minor unit before multiplying by
-- volume would make a margin wrong by construction, not by accident. Every fact this platform
-- actually discloses still rounds to a minor unit exactly once, at the point it is finally
-- totalled (I4, I5's "round once" rule, applied to a number I10 did not anticipate needing).
--
-- **Append-only and effective-dated, not written by migration alone.** D40 said plainly that a
-- rate is "written by migration and by nothing else" and that staff hold no write grant on any
-- table. That sentence stays true of `communication_rates`, untouched by this migration. It is
-- deliberately amended here, for these two new tables only: staff need to record a wholesale cost
-- or a retail price the day they learn it, not the day someone deploys a migration, and D41
-- already anticipated a runtime writer for platform-side money (it imagined `payment_webhook`;
-- there is no Stripe integration yet, so a person at GOLD is the writer instead, through the same
-- one-function-one-grant shape `provision_organization` already uses).
create table public.platform_provider_rates (
  id                     uuid        primary key default gen_random_uuid(),
  meter_id               text        not null references public.platform_meters (id),
  currency               text        not null check (currency ~ '^[A-Z]{3}$'),
  unit_amount_micros     bigint      not null check (unit_amount_micros >= 0),
  effective_from         timestamptz not null default now(),

  -- **Draft vs approved, so an AI cost analyst has somewhere to propose a number without that
  -- number ever being authoritative on its own.** `app.provider_rate_at`, below, only ever
  -- considers an approved row -- nothing this slice builds can write a draft (only staff can
  -- write anything here at all), but the column exists so that future caller has a shape to land
  -- in without a schema change.
  approval_state         text        not null check (approval_state in ('draft', 'approved')) default 'approved',

  source                 text        not null check (length(btrim(source)) between 1 and 200),
  source_url             text,
  captured_at            timestamptz not null default now(),
  recorded_by            uuid        not null references auth.users (id),
  note                   text        not null default '',

  constraint platform_provider_rates_unique_moment unique (meter_id, currency, effective_from)
);

comment on table public.platform_provider_rates is
  'What GOLD pays a provider per unit, per currency, effective-dated (D43). Append-only: "current" is the latest approved row with effective_from <= now(), never an edited one. Never selectable by a tenant -- this is GOLD''s own cost.';

create index platform_provider_rates_meter_currency_idx
  on public.platform_provider_rates (meter_id, currency, effective_from desc);

alter table public.platform_provider_rates enable row level security;
alter table public.platform_provider_rates force row level security;

create policy platform_provider_rates_platform_select on public.platform_provider_rates
  for select to platform_staff using (true);

grant select on public.platform_provider_rates to platform_staff;
-- No grant to authenticated at all -- GOLD's own wholesale cost is never a tenant-visible row.
-- No insert/update/delete grant to anyone -- public.record_provider_rate, below, is the only writer.

-- Same shape, the other direction, except for who may read it: a business is entitled to know
-- what it is charged (the same reasoning `communication_rates_select` already uses), so this one
-- grants `authenticated` too. Deliberately does not cover voice, SMS or email -- their retail
-- price stays `communication_rates` (D40), read directly rather than duplicated here, so there is
-- exactly one place either number lives.
create table public.platform_retail_rates (
  id                 uuid        primary key default gen_random_uuid(),
  meter_id           text        not null references public.platform_meters (id),
  currency           text        not null check (currency ~ '^[A-Z]{3}$'),
  unit_amount_micros bigint      not null check (unit_amount_micros >= 0),
  effective_from     timestamptz not null default now(),
  approval_state     text        not null check (approval_state in ('draft', 'approved')) default 'approved',
  source             text        not null check (length(btrim(source)) between 1 and 200),
  source_url         text,
  captured_at        timestamptz not null default now(),
  recorded_by        uuid        not null references auth.users (id),
  note               text        not null default '',

  constraint platform_retail_rates_unique_moment unique (meter_id, currency, effective_from)
);

comment on table public.platform_retail_rates is
  'What GOLD charges a business per unit, per currency, effective-dated (D43). Covers every meter except voice, SMS and email, whose retail price stays communication_rates (D40) rather than being duplicated here.';

create index platform_retail_rates_meter_currency_idx
  on public.platform_retail_rates (meter_id, currency, effective_from desc);

alter table public.platform_retail_rates enable row level security;
alter table public.platform_retail_rates force row level security;

create policy platform_retail_rates_select on public.platform_retail_rates
  for select to authenticated using (true);

create policy platform_retail_rates_platform_select on public.platform_retail_rates
  for select to platform_staff using (true);

grant select on public.platform_retail_rates to authenticated;
grant select on public.platform_retail_rates to platform_staff;
-- No insert/update/delete grant to anyone -- public.record_retail_rate, below, is the only writer.

-- ---------------------------------------------------------------------------
-- "Current," asked rather than stored
-- ---------------------------------------------------------------------------

create function app.provider_rate_at(p_meter_id text, p_currency text, p_at timestamptz default now())
returns bigint
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.unit_amount_micros
    from public.platform_provider_rates r
   where r.meter_id = p_meter_id
     and r.currency = upper(btrim(p_currency))
     and r.approval_state = 'approved'
     and r.effective_from <= p_at
   order by r.effective_from desc
   limit 1;
$fn$;

comment on function app.provider_rate_at(text, text, timestamptz) is
  'GOLD''s own wholesale price per unit, in micro-minor-units, at a moment -- null when nothing has been recorded, which callers read as "free" (D40''s own rule for an unpriced channel, applied here to cost rather than charge).';

revoke all on function app.provider_rate_at(text, text, timestamptz) from public;

create function public.retail_rate_at(p_meter_id text, p_currency text, p_at timestamptz default now())
returns bigint
language sql
stable
security invoker
set search_path = ''
as $fn$
  select r.unit_amount_micros
    from public.platform_retail_rates r
   where r.meter_id = p_meter_id
     and r.currency = upper(btrim(p_currency))
     and r.approval_state = 'approved'
     and r.effective_from <= p_at
   order by r.effective_from desc
   limit 1;
$fn$;

comment on function public.retail_rate_at(text, text, timestamptz) is
  'What GOLD currently charges for a unit of a meter, in micro-minor-units. security invoker over a table already readable by authenticated -- there is nothing here a business could not already read a row of.';

revoke all on function public.retail_rate_at(text, text, timestamptz) from public;
grant execute on function public.retail_rate_at(text, text, timestamptz) to authenticated, platform_staff;

-- ---------------------------------------------------------------------------
-- Recording a rate -- the one door, for both tables
-- ---------------------------------------------------------------------------

create function public.record_provider_rate(
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
    (meter_id, currency, unit_amount_micros, approval_state, source, source_url, recorded_by, note)
  values
    (p_meter_id, upper(btrim(p_currency)), p_unit_amount_micros, p_approval_state, p_source, p_source_url, v_staff, p_note)
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.record_provider_rate(text, text, bigint, text, text, text, text) is
  'The only way to write a wholesale rate. Staff-checked, SECURITY DEFINER, no table grant behind it (I21''s shape). Not scoped to any organization, so it writes no events row -- the append-only row itself, with recorded_by and captured_at, is the audit trail (see D43); GOLD''s own price list is not a fact about any one tenant''s timeline.';

revoke all on function public.record_provider_rate(text, text, bigint, text, text, text, text) from public;
grant execute on function public.record_provider_rate(text, text, bigint, text, text, text, text) to platform_staff;

create function public.record_retail_rate(
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

  insert into public.platform_retail_rates
    (meter_id, currency, unit_amount_micros, approval_state, source, source_url, recorded_by, note)
  values
    (p_meter_id, upper(btrim(p_currency)), p_unit_amount_micros, p_approval_state, p_source, p_source_url, v_staff, p_note)
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.record_retail_rate(text, text, bigint, text, text, text, text) is
  'The retail twin of public.record_provider_rate. Same shape, same reasoning.';

revoke all on function public.record_retail_rate(text, text, bigint, text, text, text, text) from public;
grant execute on function public.record_retail_rate(text, text, bigint, text, text, text, text) to platform_staff;
