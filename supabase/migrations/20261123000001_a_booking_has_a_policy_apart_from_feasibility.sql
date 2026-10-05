-- Booking policy: when a customer may book, and until when they may change their mind.
--
-- **Policy is not feasibility.** Feasibility (I85) answers whether the resources a kind of work needs
-- can perform it at an interval. Policy answers whether a *customer* is permitted to book that
-- interval at all — too soon, too far ahead, on the same day, off the cadence the business offers —
-- and, once booked, whether they may still reschedule or cancel on their own. Neither reads the
-- other's tables. Staff scheduling is bound by feasibility and capability, never by this.
--
-- **Owned by the Work Type.** There is no organization-level booking configuration to inherit from,
-- and inventing one now would be an inheritance chain with one link. Every value lives beside the
-- booking status and duration it qualifies (`work_item_types`), so "bookable" and "how it is
-- bookable" are one row.
--
-- **Cadence is its own column**, independent of the duration: a 90-minute job may start every 30.
-- Existing bookable types are backfilled `cadence = duration`, which is exactly what booking did
-- before this existed. Cadence anchors to the organization's local midnight: with a 30-minute
-- cadence the starts are :00 and :30 of the local clock whenever the visitor looked.
--
-- **Two semantics, on purpose.** Notice is elapsed time (an instant: `now + notice`), so a DST change
-- never alters it. The horizon and "same day" are calendar facts in the organization's zone: the
-- horizon is *today's local date + N days*, inclusive, so thirty days is thirty days across a clock
-- change.
--
-- **Enforced where it is committed.** `create_booking` and the two customer-change functions below
-- reassert everything through `app.booking_policy_refusal` / `app.booking_change_refusal`; the page's
-- slot list is advisory. A closed vocabulary of reasons comes back as the exception message (GD017).

-- ---------------------------------------------------------------------------
-- The columns
-- ---------------------------------------------------------------------------

alter table public.work_item_types
  add column booking_cadence_minutes          integer,
  add column booking_minimum_notice_minutes   integer not null default 0,
  add column booking_horizon_days             integer not null default 365,
  add column booking_allow_same_day           boolean not null default true,
  -- Null means the customer may change it until it starts. Never "unset": the form says so.
  add column booking_reschedule_cutoff_minutes integer,
  add column booking_cancel_cutoff_minutes     integer,
  -- Which of this type's statuses a customer's cancellation moves the booking to. The platform does
  -- not know what any status means (D6), so the business names it; null means customers cannot cancel.
  add column booking_cancellation_status_id    uuid;

update public.work_item_types
   set booking_cadence_minutes = booking_duration_minutes
 where booking_status_id is not null;

alter table public.work_item_types
  add constraint work_item_types_cadence_when_bookable
    check (booking_status_id is null or booking_cadence_minutes is not null),
  add constraint work_item_types_booking_policy_ranges
    check (
      (booking_cadence_minutes is null or booking_cadence_minutes between 5 and 1440)
      and booking_minimum_notice_minutes between 0 and 129600
      and booking_horizon_days between 1 and 730
      and (booking_reschedule_cutoff_minutes is null or booking_reschedule_cutoff_minutes between 0 and 129600)
      and (booking_cancel_cutoff_minutes is null or booking_cancel_cutoff_minutes between 0 and 129600)
    ),
  -- I20's shape again: the cancellation status is one of *this type's* statuses.
  add constraint work_item_types_booking_cancellation_status_same_type
    foreign key (organization_id, id, booking_cancellation_status_id)
    references public.work_item_statuses (organization_id, type_id, id);

comment on column public.work_item_types.booking_cadence_minutes is
  'Booking cadence: how far apart the start times a customer is offered are, aligned to the organization''s local midnight. Independent of booking_duration_minutes.';
comment on column public.work_item_types.booking_minimum_notice_minutes is
  'Minimum notice: elapsed minutes between now and a customer-booked start. An instant, never a calendar fact.';
comment on column public.work_item_types.booking_horizon_days is
  'Booking horizon: a customer may book through the end of the organization''s local date today + N. Calendar days in the organization''s zone.';
comment on column public.work_item_types.booking_reschedule_cutoff_minutes is
  'A customer may reschedule until this many minutes before the booking starts; null means until it starts. Never binds staff.';
comment on column public.work_item_types.booking_cancel_cutoff_minutes is
  'A customer may cancel until this many minutes before the booking starts; null means until it starts. Never binds staff.';

-- Withdrawing a type keeps its policy; publishing again must not lose it. But the column grant
-- discipline holds: every column the business may change is named.
grant update (
  booking_cadence_minutes, booking_minimum_notice_minutes, booking_horizon_days,
  booking_allow_same_day, booking_reschedule_cutoff_minutes, booking_cancel_cutoff_minutes,
  booking_cancellation_status_id
) on public.work_item_types to authenticated;

-- A cancellation moves a booking to a status that gives its resources back. Held by a trigger so every
-- writer meets it; re-checked at cancel time because the status can be edited afterwards.
create function app.check_booking_cancellation_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.booking_cancellation_status_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.booking_cancellation_status_id is not distinct from old.booking_cancellation_status_id then
    return new;
  end if;
  if not exists (
    select 1 from public.work_item_statuses s
     where s.organization_id = new.organization_id and s.type_id = new.id
       and s.id = new.booking_cancellation_status_id and s.releases_resource) then
    raise exception 'a cancelled booking must move to a status that releases its resources' using errcode = 'GD018';
  end if;
  return new;
end;
$fn$;
revoke all on function app.check_booking_cancellation_status() from public, anon, authenticated;

create trigger work_item_types_booking_cancellation_status
  before insert or update of booking_cancellation_status_id on public.work_item_types
  for each row execute function app.check_booking_cancellation_status();

-- Publishing sets the cadence from the duration when none has been chosen: the compatible default.
create or replace function public.set_type_bookable(
  p_id               uuid,
  p_status_id        uuid,
  p_duration_minutes integer,
  p_price_item_id    uuid
)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
begin
  if v_actor is null then
    raise exception 'set_type_bookable requires an authenticated caller'
      using errcode = '42501';
  end if;

  update public.work_item_types
     set booking_status_id        = p_status_id,
         booking_duration_minutes = p_duration_minutes,
         booking_price_item_id    = p_price_item_id,
         booking_cadence_minutes  = case when p_status_id is null then booking_cadence_minutes
                                         else coalesce(booking_cadence_minutes, p_duration_minutes) end,
         booking_intake_form_id   = case when p_status_id is null then null else booking_intake_form_id end
   where id = p_id
  returning organization_id into v_org;

  if v_org is null then
    raise exception 'no such work item type, or you may not change it'
      using errcode = '42501';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'work_item_type', p_id, 'work_item_type.booking_configured',
     jsonb_build_object(
       'booking_status_id', p_status_id,
       'booking_duration_minutes', p_duration_minutes,
       'booking_price_item_id', p_price_item_id
     ));
end;
$fn$;

create function public.set_type_booking_policy(
  p_type_id                 uuid,
  p_cadence_minutes         integer,
  p_minimum_notice_minutes  integer,
  p_horizon_days            integer,
  p_allow_same_day          boolean,
  p_reschedule_cutoff_minutes integer,
  p_cancel_cutoff_minutes   integer,
  p_cancellation_status_id  uuid
)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
begin
  if v_actor is null then
    raise exception 'set_type_booking_policy requires an authenticated caller' using errcode = '42501';
  end if;

  update public.work_item_types
     set booking_cadence_minutes = p_cadence_minutes,
         booking_minimum_notice_minutes = p_minimum_notice_minutes,
         booking_horizon_days = p_horizon_days,
         booking_allow_same_day = p_allow_same_day,
         booking_reschedule_cutoff_minutes = p_reschedule_cutoff_minutes,
         booking_cancel_cutoff_minutes = p_cancel_cutoff_minutes,
         booking_cancellation_status_id = p_cancellation_status_id
   where id = p_type_id and booking_status_id is not null
  returning organization_id into v_org;

  if v_org is null then
    raise exception 'no such bookable work item type, or you may not change it' using errcode = '42501';
  end if;

  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (v_org, v_actor, 'work_item_type', p_type_id, 'work_item_type.booking_policy_configured',
          jsonb_build_object(
            'cadence_minutes', p_cadence_minutes, 'minimum_notice_minutes', p_minimum_notice_minutes,
            'horizon_days', p_horizon_days, 'allow_same_day', p_allow_same_day,
            'reschedule_cutoff_minutes', p_reschedule_cutoff_minutes,
            'cancel_cutoff_minutes', p_cancel_cutoff_minutes,
            'cancellation_status_id', p_cancellation_status_id));
end;
$fn$;
revoke all on function public.set_type_booking_policy(uuid, integer, integer, integer, boolean, integer, integer, uuid) from public;
grant execute on function public.set_type_booking_policy(uuid, integer, integer, integer, boolean, integer, integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Policy evaluation: the one place the database answers "may a customer book this start?"
-- ---------------------------------------------------------------------------

-- Returns the first reason a start is refused, or null. `p_now` is a parameter so the boundaries can
-- be proved exactly; every caller passes `now()`. No role may execute it: the definer functions that
-- need it are owned by the same role.
create function app.booking_policy_refusal(
  p_organization_id uuid,
  p_type_id         uuid,
  p_starts_at       timestamptz,
  p_now             timestamptz default now()
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_type  public.work_item_types;
  v_zone  text;
  v_today date;
  v_day   date;
  v_midnight timestamptz;
begin
  select * into v_type from public.work_item_types
   where organization_id = p_organization_id and id = p_type_id;
  select timezone into v_zone from public.organizations where id = p_organization_id;
  if v_type.id is null or v_zone is null then return 'self_service_not_offered'; end if;

  v_today := (p_now at time zone v_zone)::date;
  v_day := (p_starts_at at time zone v_zone)::date;
  v_midnight := v_day::timestamp at time zone v_zone;

  -- Aligned to the start's own local midnight, whole minutes only.
  if mod(extract(epoch from (p_starts_at - v_midnight))::numeric, v_type.booking_cadence_minutes * 60) <> 0 then
    return 'invalid_booking_cadence';
  end if;
  -- Elapsed time, inclusive: a start exactly `now + notice` is allowed.
  if p_starts_at < p_now + make_interval(mins => v_type.booking_minimum_notice_minutes) then
    return 'minimum_notice_not_met';
  end if;
  if not v_type.booking_allow_same_day and v_day = v_today then
    return 'same_day_booking_not_allowed';
  end if;
  -- Calendar arithmetic on the organization's local date, so a clock change cannot shorten or
  -- lengthen the horizon.
  if v_day > v_today + v_type.booking_horizon_days then
    return 'outside_booking_horizon';
  end if;
  return null;
end;
$fn$;
revoke all on function app.booking_policy_refusal(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Whether a customer may still change a booking of theirs, and why not. `cancel` additionally needs a
-- cancellation status the business named and a transition to it from where the booking is now (I13:
-- a customer's cancellation is an ordinary move along the business's own board).
create function app.booking_change_refusal(
  p_organization_id uuid,
  p_work_item_id    uuid,
  p_action          text,
  p_now             timestamptz default now()
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_item   public.work_items;
  v_type   public.work_item_types;
  v_start  timestamptz;
  v_cutoff integer;
begin
  select * into v_item from public.work_items where organization_id = p_organization_id and id = p_work_item_id;
  if v_item.id is null then return 'booking_not_found'; end if;
  select * into v_type from public.work_item_types where organization_id = p_organization_id and id = v_item.type_id;

  if v_type.booking_status_id is null then return 'self_service_not_offered'; end if;
  if v_item.scheduled_during is null then return 'booking_not_scheduled'; end if;
  if v_item.status_releases_resource then return 'booking_not_active'; end if;

  v_start := lower(v_item.scheduled_during);
  if p_now >= v_start then return 'booking_already_started'; end if;

  if p_action = 'reschedule' then
    v_cutoff := v_type.booking_reschedule_cutoff_minutes;
    if v_cutoff is not null and p_now > v_start - make_interval(mins => v_cutoff) then
      return 'reschedule_cutoff_passed';
    end if;
  elsif p_action = 'cancel' then
    if v_type.booking_cancellation_status_id is null or not exists (
         select 1 from public.work_item_transitions t
          where t.organization_id = p_organization_id and t.type_id = v_item.type_id
            and t.from_status_id = v_item.status_id and t.to_status_id = v_type.booking_cancellation_status_id) then
      return 'self_service_not_offered';
    end if;
    v_cutoff := v_type.booking_cancel_cutoff_minutes;
    if v_cutoff is not null and p_now > v_start - make_interval(mins => v_cutoff) then
      return 'cancellation_cutoff_passed';
    end if;
  else
    raise exception 'unknown booking change %', p_action using errcode = '22023';
  end if;
  return null;
end;
$fn$;
revoke all on function app.booking_change_refusal(uuid, uuid, text, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The certificate, extracted: one definition of "these resources fill what this work needs"
-- ---------------------------------------------------------------------------

-- A second caller (reschedule) arrived, so the checks `create_booking` held inline are extracted
-- here and called twice, never copied.
create function app.validate_booking_allocations(
  p_organization_id uuid,
  p_type_id         uuid,
  p_allocations     jsonb
)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_entry     jsonb;
  v_resource  uuid;
  v_req       uuid;
  v_resources uuid[] := '{}';
begin
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'a booking names the resources it takes' using errcode = 'GD014';
  end if;

  for v_entry in select * from jsonb_array_elements(p_allocations) loop
    v_resource := nullif(v_entry ->> 'resource_id', '')::uuid;
    v_req := nullif(v_entry ->> 'requirement_id', '')::uuid;

    if v_resource is null or v_resource = any (v_resources) then
      raise exception 'a booking cannot use the same resource twice' using errcode = 'GD014';
    end if;
    v_resources := array_append(v_resources, v_resource);

    if v_req is null then
      if not exists (select 1 from public.resources r where r.organization_id = p_organization_id and r.id = v_resource) then
        raise exception 'that resource cannot do this work' using errcode = 'GD012';
      end if;
    elsif not exists (
      select 1 from public.work_item_type_resource_requirements q
       where q.organization_id = p_organization_id and q.type_id = p_type_id and q.id = v_req
    ) or not app.resource_is_eligible(p_organization_id, v_resource, v_req) then
      raise exception 'that resource cannot do this work' using errcode = 'GD012';
    end if;
  end loop;

  if exists (
    select 1 from public.work_item_type_resource_requirements q
     where q.organization_id = p_organization_id and q.type_id = p_type_id
  ) then
    if exists (
      select 1 from public.work_item_type_resource_requirements q
       where q.organization_id = p_organization_id and q.type_id = p_type_id
         and q.quantity <> (
           select count(*) from jsonb_array_elements(p_allocations) e
            where nullif(e ->> 'requirement_id', '')::uuid = q.id)
    ) or exists (
      select 1 from jsonb_array_elements(p_allocations) e where nullif(e ->> 'requirement_id', '') is null
    ) then
      raise exception 'those resources do not fill what this work needs' using errcode = 'GD014';
    end if;
  elsif jsonb_array_length(p_allocations) <> 1 then
    raise exception 'those resources do not fill what this work needs' using errcode = 'GD014';
  end if;

  return v_resources;
end;
$fn$;
revoke all on function app.validate_booking_allocations(uuid, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The booking, reasserting policy
-- ---------------------------------------------------------------------------

create or replace function public.create_booking(
  p_organization_id uuid,
  p_type_id         uuid,
  p_allocations     jsonb,
  p_starts_at       timestamptz,
  p_name            text,
  p_email           text,
  p_phone           text,
  p_intake_revision_id uuid default null,
  p_intake_answers  jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor     uuid := (select auth.uid());
  v_scope     uuid := app.current_external_tenant();
  v_type      public.work_item_types;
  v_email     text := nullif(btrim(p_email), '');
  v_customer  uuid;
  v_item      uuid;
  v_resources uuid[];
  v_intake_open boolean;
  v_refusal   text;
begin
  if v_actor is null then
    raise exception 'create_booking requires an authenticated caller'
      using errcode = '42501';
  end if;

  if v_scope is null or v_scope is distinct from p_organization_id then
    raise exception 'you are not booking with this business'
      using errcode = '42501';
  end if;

  perform app.assert_module_enabled(p_organization_id, 'booking');

  if exists (
    select 1 from public.work_items w
     where w.organization_id = p_organization_id and w.created_by = v_actor
  ) then
    raise exception 'this visitor has already booked'
      using errcode = 'GD001';
  end if;

  select * into v_type
    from public.work_item_types
   where id = p_type_id
     and organization_id = p_organization_id
     and booking_status_id is not null;

  if v_type.id is null then
    raise exception 'that is not something this business takes bookings for'
      using errcode = '42501';
  end if;

  -- Policy, before anything is looked up or written: the page's slot list was advisory.
  v_refusal := app.booking_policy_refusal(p_organization_id, p_type_id, p_starts_at);
  if v_refusal is not null then
    raise exception '%', v_refusal using errcode = 'GD017';
  end if;

  v_resources := app.validate_booking_allocations(p_organization_id, p_type_id, p_allocations);

  if v_email is not null then
    select c.id into v_customer
      from public.customers c
     where c.organization_id = p_organization_id
       and lower(c.email) = lower(v_email);
  end if;

  if v_customer is null then
    insert into public.customers (organization_id, name, email, phone, created_by)
    values (p_organization_id, p_name, v_email, nullif(btrim(p_phone), ''), v_actor)
    returning id into v_customer;
  end if;

  insert into public.work_items (
    organization_id, type_id, status_id, customer_id, title,
    scheduled_during, created_by
  )
  values (
    p_organization_id,
    p_type_id,
    v_type.booking_status_id,
    v_customer,
    v_type.name || ' — ' || p_name,
    tstzrange(p_starts_at, p_starts_at + make_interval(mins => v_type.booking_duration_minutes), '[)'),
    v_actor
  )
  returning id into v_item;

  insert into public.work_item_resource_assignments (organization_id, work_item_id, resource_id, created_by)
  select p_organization_id, v_item, rid, v_actor
    from unnest(v_resources) as rid;

  if v_type.booking_price_item_id is not null then
    perform public.add_work_item_priced_line(v_item, v_type.booking_price_item_id, 1);
  end if;

  v_intake_open := v_type.booking_intake_form_id is not null and exists (
    select 1 from public.forms f
     where f.organization_id = p_organization_id and f.id = v_type.booking_intake_form_id
       and f.archived_at is null and f.current_published_revision_id is not null);

  if v_intake_open then
    if p_intake_revision_id is null then
      raise exception 'this booking has changed since it was opened' using errcode = 'GD002';
    end if;
    perform app.record_form_submission(
      p_organization_id, v_type.booking_intake_form_id, p_intake_revision_id,
      coalesce(p_intake_answers, '{}'::jsonb), 'booking', v_actor, v_customer, v_item);
  elsif p_intake_revision_id is not null or p_intake_answers is not null then
    raise exception 'this booking has changed since it was opened' using errcode = 'GD002';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'work_item', v_item, 'work_item.booked',
     jsonb_build_object(
       'title', v_type.name,
       'customer_id', v_customer,
       'resource_ids', to_jsonb(v_resources),
       'starts_at', p_starts_at
     ));

  return v_item;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- A customer changing their own booking
-- ---------------------------------------------------------------------------

-- The per-column capability guard learns a fourth kind of writer: one of the two functions below,
-- acting for the visitor who made the booking, on that one work item. The marker is transaction-local
-- and names the item, so it cannot be claimed by a client (PostgREST issues no SET) and cannot
-- leak onto any other row.
create function app.acting_customer_change()
returns uuid
language sql
stable
set search_path = ''
as $fn$
  select nullif(current_setting('app.customer_change_work_item_id', true), '')::uuid;
$fn$;
revoke all on function app.acting_customer_change() from public;
grant execute on function app.acting_customer_change() to authenticated;

create or replace function app.check_work_item_update_capability()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if app.acting_automation() is not null then
    return new;
  end if;

  if app.acting_customer_change() is not distinct from new.id then
    return new;
  end if;

  if new.status_id is distinct from old.status_id
     and not app.has_capability(new.organization_id, 'work_item.transition') then
    raise exception 'you may not move work item % between statuses', new.id
      using errcode = '42501';
  end if;

  if new.scheduled_during is distinct from old.scheduled_during
     and not app.has_capability(new.organization_id, 'work_item.schedule') then
    raise exception 'you may not schedule work item %', new.id
      using errcode = '42501';
  end if;

  if (new.title is distinct from old.title
      or new.customer_id is distinct from old.customer_id
      or new.location_id is distinct from old.location_id
      or new.asset_id is distinct from old.asset_id
      or new.custom is distinct from old.custom)
     and not app.has_capability(new.organization_id, 'work_item.update') then
    raise exception 'you may not edit the details of work item %', new.id
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

-- What this visitor may do with one booking of theirs, for the confirmation page. Scoped inside:
-- the work item must be the caller's own, in the business they are bound to.
create function public.booking_change_options(p_work_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_scope uuid := app.current_external_tenant();
  v_actor uuid := (select auth.uid());
  v_reschedule text;
  v_cancel text;
begin
  if v_actor is null or v_scope is null or not exists (
    select 1 from public.work_items w
     where w.organization_id = v_scope and w.id = p_work_item_id and w.created_by = v_actor) then
    return null;
  end if;
  v_reschedule := app.booking_change_refusal(v_scope, p_work_item_id, 'reschedule');
  v_cancel := app.booking_change_refusal(v_scope, p_work_item_id, 'cancel');
  return jsonb_build_object(
    'canReschedule', v_reschedule is null, 'rescheduleRefusal', v_reschedule,
    'canCancel', v_cancel is null, 'cancelRefusal', v_cancel);
end;
$fn$;
revoke all on function public.booking_change_options(uuid) from public;
grant execute on function public.booking_change_options(uuid) to authenticated;

-- A visitor's own booking's resources and their occupied time, so a reschedule can ask what is free
-- *apart from itself*. Ids and ranges only, like `resource_commitments`.
create function public.booking_own_commitments(p_work_item_id uuid)
returns table (resource_id uuid, occupies tstzrange)
language sql
stable
security definer
set search_path = ''
as $fn$
  select a.resource_id, a.occupies
    from public.work_item_resource_assignments a
    join public.work_items w on w.organization_id = a.organization_id and w.id = a.work_item_id
   where w.id = p_work_item_id
     and w.organization_id = app.current_external_tenant()
     and w.created_by = (select auth.uid());
$fn$;
revoke all on function public.booking_own_commitments(uuid) from public;
grant execute on function public.booking_own_commitments(uuid) to authenticated;

create function public.customer_cancel_booking(p_work_item_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_scope uuid := app.current_external_tenant();
  v_item  public.work_items;
  v_to    uuid;
  v_refusal text;
begin
  if v_actor is null or v_scope is null then
    raise exception 'you are not booking with a business' using errcode = '42501';
  end if;
  select * into v_item from public.work_items
   where organization_id = v_scope and id = p_work_item_id and created_by = v_actor for update;
  if v_item.id is null then
    raise exception 'no such booking' using errcode = '42501';
  end if;
  perform app.assert_module_enabled(v_scope, 'booking');

  v_refusal := app.booking_change_refusal(v_scope, p_work_item_id, 'cancel');
  if v_refusal is not null then
    raise exception '%', v_refusal using errcode = 'GD017';
  end if;

  select booking_cancellation_status_id into v_to
    from public.work_item_types where organization_id = v_scope and id = v_item.type_id;
  if not exists (select 1 from public.work_item_statuses s
                  where s.organization_id = v_scope and s.id = v_to and s.releases_resource) then
    raise exception 'self_service_not_offered' using errcode = 'GD017';
  end if;

  -- The ordinary lifecycle: the update still meets `check_status_transition`, and the status's own
  -- `releases_resource` frees every resource. Nothing is deleted.
  perform set_config('app.customer_change_work_item_id', p_work_item_id::text, true);
  update public.work_items set status_id = v_to where organization_id = v_scope and id = p_work_item_id;
  perform set_config('app.customer_change_work_item_id', '', true);

  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (v_scope, v_actor, 'work_item', p_work_item_id, 'work_item.status_changed',
          jsonb_build_object('from_status_id', v_item.status_id, 'to_status_id', v_to, 'by', 'customer'));
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (v_scope, v_actor, 'work_item', p_work_item_id, 'work_item.cancelled_by_customer',
          jsonb_build_object('starts_at', lower(v_item.scheduled_during)));
end;
$fn$;
revoke all on function public.customer_cancel_booking(uuid) from public;
grant execute on function public.customer_cancel_booking(uuid) to authenticated;

create function public.customer_reschedule_booking(
  p_work_item_id uuid,
  p_allocations  jsonb,
  p_starts_at    timestamptz
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_scope uuid := app.current_external_tenant();
  v_item  public.work_items;
  v_resources uuid[];
  v_before uuid[];
  v_length interval;
  v_refusal text;
begin
  if v_actor is null or v_scope is null then
    raise exception 'you are not booking with a business' using errcode = '42501';
  end if;
  select * into v_item from public.work_items
   where organization_id = v_scope and id = p_work_item_id and created_by = v_actor for update;
  if v_item.id is null then
    raise exception 'no such booking' using errcode = '42501';
  end if;
  perform app.assert_module_enabled(v_scope, 'booking');

  -- The cutoff is judged against the booking being changed, never against where it is going.
  v_refusal := app.booking_change_refusal(v_scope, p_work_item_id, 'reschedule');
  if v_refusal is null then
    v_refusal := app.booking_policy_refusal(v_scope, v_item.type_id, p_starts_at);
  end if;
  if v_refusal is not null then
    raise exception '%', v_refusal using errcode = 'GD017';
  end if;

  v_resources := app.validate_booking_allocations(v_scope, v_item.type_id, p_allocations);
  v_length := upper(v_item.scheduled_during) - lower(v_item.scheduled_during);

  select coalesce(array_agg(a.resource_id order by a.resource_id), '{}') into v_before
    from public.work_item_resource_assignments a
   where a.organization_id = v_scope and a.work_item_id = p_work_item_id;

  -- One transaction, so a refusal anywhere restores the original window and assignments. Resources
  -- leaving the booking go first, so the ones staying are not tested against a time they will not hold
  -- alongside the ones being swapped; the window then moves and carries the stayers with it; the
  -- newcomers are inserted last. The exclusion constraint and the working-hours triggers decide.
  perform set_config('app.customer_change_work_item_id', p_work_item_id::text, true);
  delete from public.work_item_resource_assignments a
   where a.organization_id = v_scope and a.work_item_id = p_work_item_id
     and not (a.resource_id = any (v_resources));
  update public.work_items
     set scheduled_during = tstzrange(p_starts_at, p_starts_at + v_length, '[)')
   where organization_id = v_scope and id = p_work_item_id;
  perform set_config('app.customer_change_work_item_id', '', true);

  insert into public.work_item_resource_assignments (organization_id, work_item_id, resource_id, created_by)
  select v_scope, p_work_item_id, rid, v_actor
    from unnest(v_resources) as rid
   where not (rid = any (v_before));

  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (v_scope, v_actor, 'work_item', p_work_item_id, 'work_item.rescheduled_by_customer',
          jsonb_build_object(
            'from', lower(v_item.scheduled_during), 'starts_at', p_starts_at,
            'ends_at', p_starts_at + v_length,
            'resource_ids', to_jsonb(v_resources), 'previous_resource_ids', to_jsonb(v_before)));
end;
$fn$;
revoke all on function public.customer_reschedule_booking(uuid, jsonb, timestamptz) from public;
grant execute on function public.customer_reschedule_booking(uuid, jsonb, timestamptz) to authenticated;
