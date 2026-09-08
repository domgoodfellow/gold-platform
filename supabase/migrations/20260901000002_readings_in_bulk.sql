-- Fetching only the hours that matter, and writing them in one call.
--
-- **Both halves of this were found by running the thing, and neither is visible from the code.**
-- `20260831000005` shipped `record_external_reading`, singular, and `places_to_watch` returning a
-- point and a metric. A provider answers that question with a week of hourly forecasts — 168
-- numbers per metric per place — and the tick wrote them one round trip at a time. Five places
-- became eight hundred and forty calls and the request never came back.
--
-- **The second half is worse and would not have been noticed for months.** Every reading is a new
-- row on purpose: a forecast is an observation, and a later one does not correct an earlier one.
-- With a fetch every fifteen minutes and a week of hours each time, one location produced around
-- fifty thousand rows a day. The table would have been correct and useless.
--
-- **The fix is to ask a narrower question.** A rule compares the reading for the hour a job
-- starts in, and nothing else is ever read — so nothing else needs storing. `places_to_watch`
-- now says *which hours*, and the tick keeps only those. A place with two jobs booked next week
-- is two rows a tick rather than five hundred.

-- ---------------------------------------------------------------------------
-- Which hours matter
-- ---------------------------------------------------------------------------

drop function public.places_to_watch();

-- One row per place, metric and hour a rule will actually look at. The hour is truncated
-- because that is the resolution a forecast has, and comparing anything finer would be
-- comparing against a number nobody offered.
create function public.places_to_watch()
returns table (
  location_id uuid,
  latitude    double precision,
  longitude   double precision,
  metric      text,
  needed_at   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select distinct l.id, l.latitude, l.longitude, r.trigger_metric,
         date_trunc('hour', lower(w.scheduled_during))
    from public.automation_rules r
    join public.organization_modules m
      on m.organization_id = r.organization_id and m.module_key = 'automations'
    join public.work_items w
      on w.organization_id = r.organization_id
     and w.scheduled_during is not null
     and lower(w.scheduled_during) between now() and now() + interval '7 days'
    join public.locations l
      on l.organization_id = r.organization_id
     and l.id = w.location_id
     and l.latitude is not null
     and l.longitude is not null
   where r.enabled
     and r.trigger_kind = 'external_reading';
$fn$;

revoke all on function public.places_to_watch() from public;
grant execute on function public.places_to_watch() to automation_runner;

-- ---------------------------------------------------------------------------
-- Writing them together
-- ---------------------------------------------------------------------------

drop function public.record_external_reading(uuid, text, double precision, text, timestamptz);

-- **One call per place rather than one per number.** Takes a location and an array; the array is
-- what the caller has anyway, because a provider answers about a place rather than about an
-- instant. The organization is still derived here and is still not something a caller may name —
-- the same shape `record_provider_payment` and `record_message_delivery` have.
--
-- Returns how many rows it wrote, so the tick can report a number rather than assume one.
create function public.record_external_readings(
  p_location_id uuid,
  p_readings    jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_org     uuid;
  v_written integer;
begin
  select organization_id into v_org from public.locations where id = p_location_id;
  if v_org is null then
    raise exception 'no such location' using errcode = '42501';
  end if;

  if jsonb_typeof(p_readings) <> 'array' then
    raise exception 'readings must be an array';
  end if;

  insert into public.external_readings
    (organization_id, location_id, metric, value, unit, applies_at)
  select v_org, p_location_id, entry.metric, entry.value, entry.unit, entry.applies_at
    from jsonb_to_recordset(p_readings)
      as entry(metric text, value double precision, unit text, applies_at timestamptz);

  get diagnostics v_written = row_count;
  return v_written;
end;
$fn$;

revoke all on function public.record_external_readings(uuid, jsonb) from public;
grant execute on function public.record_external_readings(uuid, jsonb) to automation_runner;

-- ---------------------------------------------------------------------------
-- Keeping the table from growing without bound anyway
-- ---------------------------------------------------------------------------

-- Even asking narrowly, a job sitting in the diary for a week is re-read every tick — which is
-- correct, because a forecast changes and the newest one is the one a rule should act on. What
-- is not correct is keeping every one of them forever.
--
-- **Deliberately not a scheduled cleanup.** There is no second thing to schedule and no caller
-- for one; what there is, is a write that already runs. A reading older than the window any rule
-- can look at is unreachable by every query in this schema, so the insert drops them as it goes.
create function app.forget_stale_readings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  delete from public.external_readings
   where organization_id = new.organization_id
     and location_id = new.location_id
     and metric = new.metric
     and applies_at = new.applies_at
     -- Everything but the newest observation of the same hour. `due_reading_automations` reads
     -- exactly one — the most recently observed — so the rest answer no question.
     and observed_at < new.observed_at;

  return null;
end;
$fn$;

comment on function app.forget_stale_readings() is
  'Keeps one observation per place, metric and hour: the newest. Everything older answers no query, because the rule reads the most recent one.';

create trigger external_readings_forget_stale
  after insert on public.external_readings
  for each row execute function app.forget_stale_readings();
