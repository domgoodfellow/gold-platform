-- A resource says when it works, and when it does not.
--
-- Until now a resource's availability was the organization's operating hours minus what it was
-- already committed to. This adds the two things a person, a van or a machine can say about
-- itself: a recurring weekly pattern, and dates it is unavailable.
--
--   open  = organization hours  ∩  resource working hours  −  resource exceptions
--   free  = open  −  commitments            (the subtraction stays `freeWindows`, in TypeScript)
--
-- **Three questions, kept apart.** A requirement says whether a resource is *eligible*; an
-- assignment says whether it is *assigned*; this says whether it is *working*. None of them
-- reads the others.
--
-- **Mode is a row, not a count of rows.** A resource with no `resource_working_schedules` row
-- inherits the organization's hours: nothing changes for anything that exists today. A resource
-- with one follows its own hours, and a schedule with no days is a resource that never works --
-- a statement somebody made, rather than a guess drawn from an empty table. Removing the row
-- removes the hours with it (cascade), so the two cannot disagree.
--
-- **What is refused, and what is not.** A new or moved appointment may not fall outside an
-- assigned resource's open windows, nor over one of its exceptions. A resource that inherits is
-- held only to its exceptions: organization hours are advisory today (`availability.ts`), and
-- turning them into a refusal for every existing business is not this migration's call. A
-- resource that has said it follows its own hours is held to the intersection.
-- Changing hours or adding an exception over work already booked refuses nothing and moves
-- nothing: `resource_availability_conflicts` reports it instead, because an operator may have to
-- record the sickness before they can repair the diary.

-- ---------------------------------------------------------------------------
-- Weekly pattern
-- ---------------------------------------------------------------------------

create table public.resource_working_schedules (
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  resource_id     uuid        not null,
  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),
  primary key (organization_id, resource_id),
  constraint resource_working_schedules_resource_same_org
    foreign key (organization_id, resource_id)
    references public.resources (organization_id, id)
);

comment on table public.resource_working_schedules is
  'A row says this resource follows its own working hours; no row says it inherits the organization''s. Mode is stated, never inferred from whether hours rows exist.';

create table public.resource_working_hours (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null,
  resource_id     uuid        not null,
  -- ISO 8601, as operating_hours: 1 = Monday .. 7 = Sunday.
  day_of_week     smallint    not null check (day_of_week between 1 and 7),
  -- Tenant-local wall-clock, resolved against the organization's zone when a day is calculated
  -- (see operating_hours for why this is `time` and not an instant). Overnight is two rows.
  opens_at        time        not null,
  closes_at       time        not null,
  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),
  constraint resource_working_hours_closes_after_opens check (closes_at > opens_at),
  constraint resource_working_hours_schedule_same_org
    foreign key (organization_id, resource_id)
    references public.resource_working_schedules (organization_id, resource_id) on delete cascade,
  -- Unlike operating hours, overlap is refused: a resource that works 08-12 and 10-14 on one day
  -- has said something that is not a shift pattern, and this is the one place it can be stopped.
  -- Back-to-back (08-12, 12-17) is fine; the ranges are half-open.
  constraint resource_working_hours_no_overlap
    exclude using gist (
      organization_id with =,
      resource_id     with =,
      day_of_week     with =,
      numrange(extract(epoch from opens_at)::numeric, extract(epoch from closes_at)::numeric) with &&
    )
);

create index resource_working_hours_by_resource
  on public.resource_working_hours (organization_id, resource_id, day_of_week);

-- ---------------------------------------------------------------------------
-- Exceptions
-- ---------------------------------------------------------------------------

create table public.resource_availability_exceptions (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  resource_id     uuid        not null,
  -- Absolute instants: a date-specific interval has one meaning, unlike a recurring reading. The
  -- caller resolves "June 10" against the organization's zone before it gets here.
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  -- One kind today. A column rather than an assumption so a second one is a check change, not a
  -- second table; nothing else in the schema or the code reads it as anything but "not available".
  kind            text        not null default 'unavailable' check (kind in ('unavailable')),
  -- The business's own words: vacation, maintenance, calibration. Never interpreted.
  reason          text        check (reason is null or char_length(btrim(reason)) between 1 and 200),
  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),
  constraint resource_availability_exceptions_ends_after_starts check (ends_at > starts_at),
  constraint resource_availability_exceptions_resource_same_org
    foreign key (organization_id, resource_id)
    references public.resources (organization_id, id)
);

comment on table public.resource_availability_exceptions is
  'Dates a resource cannot take part, for any reason. Scheduling constraints, not work: nothing here is a job.';

create index resource_availability_exceptions_by_resource
  on public.resource_availability_exceptions (organization_id, resource_id, starts_at);

-- ---------------------------------------------------------------------------
-- Read access; every write is a function below
-- ---------------------------------------------------------------------------

alter table public.resource_working_schedules enable row level security;
alter table public.resource_working_schedules force row level security;
alter table public.resource_working_hours enable row level security;
alter table public.resource_working_hours force row level security;
alter table public.resource_availability_exceptions enable row level security;
alter table public.resource_availability_exceptions force row level security;

create policy resource_working_schedules_select on public.resource_working_schedules
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy resource_working_hours_select on public.resource_working_hours
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy resource_availability_exceptions_select on public.resource_availability_exceptions
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- No insert, update or delete grant to anyone: the functions below hold the capability check, the
-- validation and the event in one transaction.
grant select on public.resource_working_schedules to authenticated;
grant select on public.resource_working_hours to authenticated;
grant select on public.resource_availability_exceptions to authenticated;

-- ---------------------------------------------------------------------------
-- The one calculation of when a resource is open
-- ---------------------------------------------------------------------------

-- Organization hours ∩ resource hours − exceptions, clipped to the range asked about. Multiranges
-- do the set arithmetic, so overlapping organization rows merge exactly as `freeWindows` merges
-- them, and subtracting an exception from the middle of a window cannot raise.
--
-- Local days are walked from the day before the range to the day after it, so a window that begins
-- before the range or runs past midnight is still seen; the clip at the end removes the excess.
-- `(date + time) at time zone` is Postgres's own DST resolution; this function is the only place
-- the weekly pattern becomes instants for the database.
create function app.resource_open_windows(
  p_organization_id uuid,
  p_resource_id     uuid,
  p_during          tstzrange
)
returns tstzmultirange
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_zone   text;
  v_org    tstzmultirange;
  v_own    tstzmultirange;
  v_custom boolean;
  v_open   tstzmultirange;
  v_has_org_hours boolean;
begin
  select o.timezone into v_zone from public.organizations o where o.id = p_organization_id;
  v_zone := coalesce(v_zone, 'UTC');

  select exists (select 1 from public.operating_hours h where h.organization_id = p_organization_id)
    into v_has_org_hours;

  if v_has_org_hours then
    select coalesce(range_agg(tstzrange(
             (d.day + h.opens_at) at time zone v_zone,
             (d.day + h.closes_at) at time zone v_zone, '[)')), '{}'::tstzmultirange)
      into v_org
      from generate_series(
             ((lower(p_during) at time zone v_zone)::date - 1)::timestamp,
             ((upper(p_during) at time zone v_zone)::date + 1)::timestamp,
             interval '1 day') as d(day)
      join public.operating_hours h
        on h.organization_id = p_organization_id
       and h.day_of_week = extract(isodow from d.day)::int;
  else
    -- Said nothing is read as always open, as everywhere else.
    v_org := tstzmultirange(p_during);
  end if;

  select exists (
    select 1 from public.resource_working_schedules s
     where s.organization_id = p_organization_id and s.resource_id = p_resource_id
  ) into v_custom;

  v_open := v_org;

  if v_custom then
    select coalesce(range_agg(tstzrange(
             (d.day + h.opens_at) at time zone v_zone,
             (d.day + h.closes_at) at time zone v_zone, '[)')), '{}'::tstzmultirange)
      into v_own
      from generate_series(
             ((lower(p_during) at time zone v_zone)::date - 1)::timestamp,
             ((upper(p_during) at time zone v_zone)::date + 1)::timestamp,
             interval '1 day') as d(day)
      join public.resource_working_hours h
        on h.organization_id = p_organization_id
       and h.resource_id = p_resource_id
       and h.day_of_week = extract(isodow from d.day)::int;

    v_open := v_open * v_own;
  end if;

  select v_open - coalesce(range_agg(tstzrange(e.starts_at, e.ends_at, '[)')), '{}'::tstzmultirange)
    into v_open
    from public.resource_availability_exceptions e
   where e.organization_id = p_organization_id
     and e.resource_id = p_resource_id
     and tstzrange(e.starts_at, e.ends_at, '[)') && p_during;

  return v_open * tstzmultirange(p_during);
end;
$fn$;

revoke all on function app.resource_open_windows(uuid, uuid, tstzrange) from public;

-- Why a window does not fit, or null if it does. The two answers an operator can act on: the
-- resource is not working then, or it has said it is unavailable then. A resource that inherits is
-- held only to its exceptions (see the header).
create function app.resource_window_problem(
  p_organization_id uuid,
  p_resource_id     uuid,
  p_window          tstzrange
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_custom boolean;
begin
  if exists (
    select 1 from public.resource_availability_exceptions e
     where e.organization_id = p_organization_id
       and e.resource_id = p_resource_id
       and tstzrange(e.starts_at, e.ends_at, '[)') && p_window
  ) then
    return 'unavailable';
  end if;

  select exists (
    select 1 from public.resource_working_schedules s
     where s.organization_id = p_organization_id and s.resource_id = p_resource_id
  ) into v_custom;

  if v_custom
     and not (tstzmultirange(p_window) <@ app.resource_open_windows(p_organization_id, p_resource_id, p_window)) then
    return 'outside_hours';
  end if;

  return null;
end;
$fn$;

revoke all on function app.resource_window_problem(uuid, uuid, tstzrange) from public;

-- The refusal, worded for a person: which resource, and what about it. GD013 is distinct from the
-- exclusion violation's 23P01 because the two mean different things to somebody choosing a time.
create function app.assert_resource_working(
  p_organization_id uuid,
  p_resource_id     uuid,
  p_window          tstzrange
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_problem text := app.resource_window_problem(p_organization_id, p_resource_id, p_window);
  v_name    text;
  v_zone    text;
  v_from    timestamptz;
  v_to      timestamptz;
begin
  if v_problem is null then
    return;
  end if;

  select r.name into v_name from public.resources r
   where r.organization_id = p_organization_id and r.id = p_resource_id;
  select coalesce(o.timezone, 'UTC') into v_zone from public.organizations o where o.id = p_organization_id;

  if v_problem = 'unavailable' then
    select e.starts_at, e.ends_at into v_from, v_to
      from public.resource_availability_exceptions e
     where e.organization_id = p_organization_id
       and e.resource_id = p_resource_id
       and tstzrange(e.starts_at, e.ends_at, '[)') && p_window
     order by e.starts_at
     limit 1;

    raise exception '% is unavailable from % to %', v_name,
      to_char(v_from at time zone v_zone, 'YYYY-MM-DD HH24:MI'),
      to_char(v_to at time zone v_zone, 'YYYY-MM-DD HH24:MI')
      using errcode = 'GD013';
  end if;

  raise exception '% is not working at that time', v_name
    using errcode = 'GD013';
end;
$fn$;

revoke all on function app.assert_resource_working(uuid, uuid, tstzrange) from public;

-- ---------------------------------------------------------------------------
-- Enforcement: where an appointment meets a resource
-- ---------------------------------------------------------------------------

-- A resource newly on an appointment. Covers `schedule_work_item`, `set_work_item_resources`,
-- `create_work_item`, `create_booking` and a direct insert alike, because they all end here -- and
-- it runs in the same transaction as the assignment's exclusion constraint, so "working?" and
-- "not already committed?" are asked of one consistent database. Judged on the appointment
-- (`scheduled_during`), not on `occupies`: a buffer is not working time.
create function app.check_assignment_working()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_window   tstzrange;
  v_released boolean;
begin
  if new.occupies is null then
    return new;
  end if;

  select w.scheduled_during, w.status_releases_resource
    into v_window, v_released
    from public.work_items w
   where w.organization_id = new.organization_id
     and w.id = new.work_item_id;

  if v_window is not null and not coalesce(v_released, false) then
    perform app.assert_resource_working(new.organization_id, new.resource_id, v_window);
  end if;

  return new;
end;
$fn$;

revoke all on function app.check_assignment_working() from public;

-- After the occupancy projection has settled `new.occupies`, so a released or unscheduled job
-- (occupies null) is never asked.
create trigger work_item_resource_assignments_working_hours
  after insert on public.work_item_resource_assignments
  for each row execute function app.check_assignment_working();

-- The appointment itself moving. Only a change of window is judged: a status change or a buffer
-- change on work that already sits outside somebody's hours is the historical case, not a new
-- commitment, and refusing it would trap the job where it is.
create function app.check_rescheduled_working()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_assignment record;
begin
  if new.scheduled_during is null or new.status_releases_resource then
    return null;
  end if;

  for v_assignment in
    select a.resource_id
      from public.work_item_resource_assignments a
     where a.organization_id = new.organization_id
       and a.work_item_id = new.id
  loop
    perform app.assert_resource_working(new.organization_id, v_assignment.resource_id, new.scheduled_during);
  end loop;

  return null;
end;
$fn$;

revoke all on function app.check_rescheduled_working() from public;

create trigger work_items_rescheduled_working_hours
  after update on public.work_items
  for each row
  when (old.scheduled_during is distinct from new.scheduled_during)
  execute function app.check_rescheduled_working();

-- ---------------------------------------------------------------------------
-- Reads that cross the tenant/booking-visitor line
-- ---------------------------------------------------------------------------

-- When each resource is open in a range -- ids and instants only. Definer so a booking visitor can
-- ask (the same shape as `resource_commitments`); scoped inside, so it answers for the caller's own
-- business or the one the visitor is bound to and nobody else's. The reason a resource is closed is
-- not in it: exceptions' words stay with the people who wrote them.
create function public.resource_open_windows(
  p_organization_id uuid,
  p_from            timestamptz,
  p_to              timestamptz
)
returns table (resource_id uuid, during tstzrange)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  -- Out of scope reads as nothing, the way a policy would -- not as an error, so a screen asking
  -- about a business it cannot see gets an empty answer like every other read. `coalesce`: a
  -- signed-in member has no external binding, so the second test is null, and
  -- `not (false or null)` is null, which an `if` reads as false.
  if p_organization_id is null
     or not coalesce(
       p_organization_id in (select app.current_tenant_ids())
       or p_organization_id = app.current_external_tenant(),
       false
     ) then
    return;
  end if;

  if p_to <= p_from then
    raise exception 'a range must end after it starts'
      using errcode = '22023';
  end if;

  return query
  select r.id, w.during
    from public.resources r
    cross join lateral unnest(
      app.resource_open_windows(r.organization_id, r.id, tstzrange(p_from, p_to, '[)'))
    ) as w(during)
   where r.organization_id = p_organization_id;
end;
$fn$;

revoke all on function public.resource_open_windows(uuid, timestamptz, timestamptz) from public;
grant execute on function public.resource_open_windows(uuid, timestamptz, timestamptz) to authenticated;

-- Scheduled work that sits outside the hours or over an exception of a resource it is on. Derived
-- on every read, never stored: it is a fact about the present configuration and the present diary,
-- and it clears itself when either is mended. Members only.
create function public.resource_availability_conflicts(
  p_organization_id uuid,
  p_from            timestamptz,
  p_to              timestamptz
)
returns table (work_item_id uuid, resource_id uuid, problem text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select w.id, a.resource_id, app.resource_window_problem(w.organization_id, a.resource_id, w.scheduled_during)
    from public.work_items w
    join public.work_item_resource_assignments a
      on a.organization_id = w.organization_id
     and a.work_item_id = w.id
   where w.organization_id = p_organization_id
     and p_organization_id in (select app.current_tenant_ids())
     and w.scheduled_during is not null
     and not w.status_releases_resource
     and w.scheduled_during && tstzrange(p_from, p_to, '[)')
     and app.resource_window_problem(w.organization_id, a.resource_id, w.scheduled_during) is not null;
$fn$;

revoke all on function public.resource_availability_conflicts(uuid, timestamptz, timestamptz) from public;
grant execute on function public.resource_availability_conflicts(uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Writing
-- ---------------------------------------------------------------------------

-- Replaces the whole weekly pattern in one transaction -- the editor is a form of seven days, and
-- "save" is one act. Capability `resource.update`, the same authority that changes a resource.
-- `p_hours` is an array of { day_of_week, opens_at, closes_at }; an empty array is a resource that
-- never works, which is different from `use_organization_hours`.
create function public.set_resource_working_hours(p_resource_id uuid, p_hours jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
  v_entry jsonb;
begin
  if v_actor is null then
    raise exception 'set_resource_working_hours requires an authenticated caller'
      using errcode = '42501';
  end if;

  select r.organization_id into v_org from public.resources r where r.id = p_resource_id;

  if v_org is null
     or v_org not in (select app.current_tenant_ids())
     or not app.has_capability(v_org, 'resource.update') then
    raise exception 'no such resource, or you may not change it'
      using errcode = '42501';
  end if;

  if p_hours is null or jsonb_typeof(p_hours) <> 'array' then
    raise exception 'working hours must be a list of days'
      using errcode = '22023';
  end if;

  insert into public.resource_working_schedules (organization_id, resource_id, created_by)
  values (v_org, p_resource_id, v_actor)
  on conflict (organization_id, resource_id) do nothing;

  delete from public.resource_working_hours h
   where h.organization_id = v_org and h.resource_id = p_resource_id;

  for v_entry in select * from jsonb_array_elements(p_hours) loop
    insert into public.resource_working_hours
      (organization_id, resource_id, day_of_week, opens_at, closes_at, created_by)
    values (
      v_org, p_resource_id,
      (v_entry ->> 'day_of_week')::smallint,
      (v_entry ->> 'opens_at')::time,
      (v_entry ->> 'closes_at')::time,
      v_actor
    );
  end loop;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'resource', p_resource_id, 'resource.working_hours_changed',
     jsonb_build_object('mode', 'custom', 'hours', p_hours));
end;
$fn$;

revoke all on function public.set_resource_working_hours(uuid, jsonb) from public;
grant execute on function public.set_resource_working_hours(uuid, jsonb) to authenticated;

-- Back to inheriting. The hours go with the schedule row (cascade).
create function public.use_organization_hours(p_resource_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
begin
  if v_actor is null then
    raise exception 'use_organization_hours requires an authenticated caller'
      using errcode = '42501';
  end if;

  select r.organization_id into v_org from public.resources r where r.id = p_resource_id;

  if v_org is null
     or v_org not in (select app.current_tenant_ids())
     or not app.has_capability(v_org, 'resource.update') then
    raise exception 'no such resource, or you may not change it'
      using errcode = '42501';
  end if;

  delete from public.resource_working_schedules s
   where s.organization_id = v_org and s.resource_id = p_resource_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'resource', p_resource_id, 'resource.working_hours_changed',
     jsonb_build_object('mode', 'inherit'));
end;
$fn$;

revoke all on function public.use_organization_hours(uuid) from public;
grant execute on function public.use_organization_hours(uuid) to authenticated;

create function public.create_resource_availability_exception(
  p_resource_id uuid,
  p_starts_at   timestamptz,
  p_ends_at     timestamptz,
  p_reason      text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'create_resource_availability_exception requires an authenticated caller'
      using errcode = '42501';
  end if;

  select r.organization_id into v_org from public.resources r where r.id = p_resource_id;

  if v_org is null
     or v_org not in (select app.current_tenant_ids())
     or not app.has_capability(v_org, 'resource.update') then
    raise exception 'no such resource, or you may not change it'
      using errcode = '42501';
  end if;

  insert into public.resource_availability_exceptions
    (organization_id, resource_id, starts_at, ends_at, reason, created_by)
  values (v_org, p_resource_id, p_starts_at, p_ends_at, nullif(btrim(p_reason), ''), v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'resource', p_resource_id, 'resource.availability_exception_created',
     jsonb_build_object('exception_id', v_id, 'starts_at', p_starts_at, 'ends_at', p_ends_at,
                        'reason', nullif(btrim(p_reason), '')));

  return v_id;
end;
$fn$;

revoke all on function public.create_resource_availability_exception(uuid, timestamptz, timestamptz, text) from public;
grant execute on function public.create_resource_availability_exception(uuid, timestamptz, timestamptz, text) to authenticated;

create function public.update_resource_availability_exception(
  p_id        uuid,
  p_starts_at timestamptz,
  p_ends_at   timestamptz,
  p_reason    text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor    uuid := (select auth.uid());
  v_org      uuid;
  v_resource uuid;
begin
  if v_actor is null then
    raise exception 'update_resource_availability_exception requires an authenticated caller'
      using errcode = '42501';
  end if;

  select e.organization_id, e.resource_id into v_org, v_resource
    from public.resource_availability_exceptions e where e.id = p_id;

  if v_org is null
     or v_org not in (select app.current_tenant_ids())
     or not app.has_capability(v_org, 'resource.update') then
    raise exception 'no such exception, or you may not change it'
      using errcode = '42501';
  end if;

  update public.resource_availability_exceptions
     set starts_at = p_starts_at, ends_at = p_ends_at, reason = nullif(btrim(p_reason), '')
   where id = p_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'resource', v_resource, 'resource.availability_exception_changed',
     jsonb_build_object('exception_id', p_id, 'starts_at', p_starts_at, 'ends_at', p_ends_at,
                        'reason', nullif(btrim(p_reason), '')));
end;
$fn$;

revoke all on function public.update_resource_availability_exception(uuid, timestamptz, timestamptz, text) from public;
grant execute on function public.update_resource_availability_exception(uuid, timestamptz, timestamptz, text) to authenticated;

-- Deleted, not archived: an exception is configuration, and the event keeps what it said.
create function public.delete_resource_availability_exception(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor    uuid := (select auth.uid());
  v_org      uuid;
  v_resource uuid;
begin
  if v_actor is null then
    raise exception 'delete_resource_availability_exception requires an authenticated caller'
      using errcode = '42501';
  end if;

  select e.organization_id, e.resource_id into v_org, v_resource
    from public.resource_availability_exceptions e where e.id = p_id;

  if v_org is null
     or v_org not in (select app.current_tenant_ids())
     or not app.has_capability(v_org, 'resource.update') then
    raise exception 'no such exception, or you may not change it'
      using errcode = '42501';
  end if;

  delete from public.resource_availability_exceptions where id = p_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'resource', v_resource, 'resource.availability_exception_removed',
     jsonb_build_object('exception_id', p_id));
end;
$fn$;

revoke all on function public.delete_resource_availability_exception(uuid) from public;
grant execute on function public.delete_resource_availability_exception(uuid) to authenticated;
