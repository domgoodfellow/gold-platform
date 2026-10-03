-- A meter stops being three columns and an assumption.
--
-- `platform_meters` held an id, a unit and a description. Three things an allowance engine and a
-- staff operator both need were missing or merely assumed:
--
--   **a label.** Every screen was spelling one itself -- `meter.description` on the Meters page,
--     `meterId.replaceAll('_', ' ')` on Usage. Two places inventing a name for one row.
--   **aggregation.** `app.allowance_consumption` sums readings in a window because every meter
--     today accumulates. That was an assumption written into one function, not a fact of the
--     meter, so a meter that does not accumulate had nowhere to say so.
--   **who writes it.** Defining a meter was never the same claim as recording it (this table's
--     own comment says so since `20260910000001`), but nothing said which of the two a given row
--     was. Six of the eleven meters have no writer at all, and a Plan quota over one of them
--     would promise tracking that does not happen -- the reason `20261015000002` deliberately
--     seeded no SMS, email or AI quota rows. That reasoning deserves to be a column rather than a
--     paragraph in a migration header nobody reads at the right moment.
--
-- `writer` is the function that calls `app.record_usage` for this meter. It is checked against
-- `pg_proc` by an architecture test rather than trusted: a meter claiming a writer that does not
-- name it, or a meter claiming none while something writes it, fails the gate.

alter table public.platform_meters
  add column label       text,
  add column aggregation text not null default 'sum'
    check (aggregation in ('sum', 'high_water')),
  add column writer      text
    check (writer is null or writer ~ '^(app|public)\.[a-z_]+$');

comment on column public.platform_meters.label is
  'What this meter is called where a person reads it. One string, so a screen never spells one from the id.';
comment on column public.platform_meters.aggregation is
  'How readings combine over an allowance window: sum accumulates them, high_water takes the largest. Read by app.allowance_consumption -- a fact of the meter, not an assumption inside one function.';
comment on column public.platform_meters.writer is
  'The function that records usage on this meter, or null for a meter that is vocabulary only -- defined and priceable, with nothing recording it yet. Defining a meter is not the same claim as recording it.';

update public.platform_meters set label = x.label, writer = x.writer
  from (values
    ('voice_minutes',          'Voice minutes',          'app.charge_for_call'),
    ('sms_segment',            'SMS segments',           'app.charge_for_message'),
    ('mms_messages',           'MMS messages',           'app.charge_for_message'),
    ('rcs_messages',           'RCS messages',           'app.charge_for_message'),
    ('phone_numbers',          'Phone number months',    'public.record_phone_number_month'),
    ('call_recording_minutes', 'Call recording minutes', null),
    ('email_send',             'Emails sent',            null),
    ('transcription_seconds',  'Transcription seconds',  null),
    ('tts_characters',         'Spoken characters',      null),
    ('ai_tokens_input',        'AI input tokens',        null),
    ('ai_tokens_output',       'AI output tokens',       null)
  ) as x(id, label, writer)
 where public.platform_meters.id = x.id;

-- Anything added later without a label would be a row two screens have to name themselves again.
update public.platform_meters set label = initcap(replace(id, '_', ' ')) where label is null;
alter table public.platform_meters alter column label set not null;
alter table public.platform_meters add constraint platform_meters_label_said
  check (length(btrim(label)) between 1 and 120);

comment on table public.platform_meters is
  'What can be metered -- consumption, not vendor. Platform vocabulary, migration-written. Which provider answers a meter, for a given business, is a provider rate (platform_provider_rates) and, per reading, usage_events.provider_key -- never this table. `writer` says whether anything records it yet; a meter with none is honest vocabulary, not a tracked quantity.';

-- ---------------------------------------------------------------------------
-- Aggregation becomes enforced rather than assumed
-- ---------------------------------------------------------------------------
-- Recreated so the one function that counts a metered allowance reads the meter's own answer.
-- Everything else about it is unchanged.
create or replace function app.allowance_consumption(
  p_organization_id uuid,
  p_allowance_key   text,
  p_allowance_type  text,
  p_meter_id        text,
  p_from            timestamptz,
  p_to              timestamptz
)
returns table (consumed numeric, enforcement text)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_counter     text;
  v_argument    text;
  v_aggregation text;
  v_consumed    numeric;
begin
  -- A metered allowance counts the one ledger that already records consumption, the way the
  -- meter says its readings combine. A null window is an unbounded one
  -- (`reset_semantics = 'none'`), where all of it counts.
  if p_allowance_type = 'usage' and p_meter_id is not null then
    select m.aggregation into v_aggregation
      from public.platform_meters m where m.id = p_meter_id;

    select case when v_aggregation = 'high_water'
                then coalesce(max(u.quantity), 0)
                else coalesce(sum(u.quantity), 0) end
      into v_consumed
      from public.usage_events u
     where u.organization_id = p_organization_id
       and u.meter_id = p_meter_id
       and (p_from is null or u.occurred_at >= p_from)
       and (p_to   is null or u.occurred_at <  p_to);
    return query select v_consumed, 'metered'::text;
    return;
  end if;

  select c.counter_key, c.counter_argument into v_counter, v_argument
    from public.platform_allowance_counters c
   where c.allowance_key = p_allowance_key;

  -- A count of what is in use now. A seat or a number is held at a moment, not accumulated over
  -- a window, so the window is descriptive for these and deliberately not a filter.
  if v_counter = 'memberships' then
    select count(*) into v_consumed
      from public.memberships m where m.organization_id = p_organization_id;
    return query select v_consumed, 'counted'::text;
    return;
  elsif v_counter = 'members_with_capability' then
    select count(*) into v_consumed
      from public.memberships m
      join public.roles r on r.organization_id = m.organization_id and r.id = m.role_id
     where m.organization_id = p_organization_id
       and v_argument = any (r.capabilities);
    return query select v_consumed, 'counted'::text;
    return;
  elsif v_counter = 'active_phone_numbers' then
    select count(*) into v_consumed
      from public.phone_numbers n
     where n.organization_id = p_organization_id and n.lifecycle = 'active';
    return query select v_consumed, 'counted'::text;
    return;
  end if;

  return query select null::numeric, 'unenforced'::text;
end;
$fn$;
