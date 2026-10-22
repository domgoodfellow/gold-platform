-- A work type declares whether work of its kind occupies a time, and bookable implies it.
--
-- **Two different facts, and until now only one of them could be written down.** A type is
-- *publicly bookable* when the business has said which status a booking arrives in and how long
-- one takes (`booking_status_id`, `booking_duration_minutes`). Whether work of that kind is
-- *scheduled at all* had no column: Schedule, Resources and Locations were shown to every
-- business, and a type's bookability was the only scheduling-shaped thing it said. A private
-- service visit and an implementation project are scheduled and not bookable; a sales
-- opportunity is neither. This column is the first fact, and the implication runs one way only:
--
--     bookable  =>  schedulable        never        schedulable  =>  bookable
--
-- **Existing rows are scheduling-capable.** Every type that exists was created when scheduling
-- was available to everybody, so they are backfilled `true` rather than reinterpreted as a
-- business that does not schedule. The default that makes the backfill deployable is dropped in
-- the same migration: it is a migration device, not an answer. A new type must say, so the
-- platform never answers *does this business schedule* on somebody's behalf.
--
-- **What "scheduled" means to the database** is `work_items.scheduled_during is not null`. A
-- resource named with no window occupies nothing (the exclusion constraint is partial on both),
-- so assignment alone is not scheduling and neither guard below looks at it.

alter table public.work_item_types
  add column schedulable boolean not null default true;

alter table public.work_item_types
  alter column schedulable drop default;

comment on column public.work_item_types.schedulable is
  'Whether work of this type may occupy a scheduled time. Declared by the business, never inferred from bookings, resources or row counts. Implied by public bookability, never the other way round.';

-- ---------------------------------------------------------------------------
-- bookable => schedulable, in the table
-- ---------------------------------------------------------------------------

-- A separate, named check rather than a clause on `work_item_types_bookable_is_complete`: that one
-- says the booking pair is whole, this one says what the pair requires, and a refusal naming the
-- second is the only way the domain can give the right sentence for a `23514`.
alter table public.work_item_types
  add constraint work_item_types_bookable_is_schedulable
  check (
    schedulable
    or (booking_status_id is null and booking_duration_minutes is null)
  );

-- Insert is a table-wide grant held by `field.manage` through the insert policy, so the new
-- column is inherited there on purpose: creating a type is exactly when it must be stated.
-- Update is by column, and this one is added deliberately.
grant update (schedulable) on public.work_item_types to authenticated;

-- ---------------------------------------------------------------------------
-- Work cannot be scheduled into a type that does not schedule
-- ---------------------------------------------------------------------------

-- Security definer, and the reason is the lock. `for share` on the type row is what serialises
-- this against `app.check_type_has_no_scheduled_work` below: whoever arrives second waits for the
-- first and then sees its result, so a type cannot be switched off in the same instant a job is
-- put in its diary. Row locks run through the update policy, which a dispatcher holding
-- `work_item.schedule` and not `field.manage` does not satisfy; run as the caller, that dispatcher
-- would be told the type does not schedule when it does. `create_booking` is already definer.
create function app.check_work_item_type_is_schedulable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.scheduled_during is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.scheduled_during is not distinct from old.scheduled_during
     and new.type_id is not distinct from old.type_id then
    return new;
  end if;

  perform 1
     from public.work_item_types t
    where t.organization_id = new.organization_id
      and t.id = new.type_id
      and t.schedulable
      for share;

  if not found then
    raise exception 'work item % is of a type that does not use the schedule', new.id
      using errcode = 'GD005';
  end if;

  return new;
end;
$fn$;

revoke all on function app.check_work_item_type_is_schedulable() from public;

comment on function app.check_work_item_type_is_schedulable() is
  'A work item can hold a scheduled window only if its type is declared schedulable. The row lock serialises it against switching the type off.';

create trigger work_items_type_is_schedulable
  before insert or update of scheduled_during, type_id on public.work_items
  for each row execute function app.check_work_item_type_is_schedulable();

-- ---------------------------------------------------------------------------
-- A type cannot stop scheduling while work of its kind is in the diary
-- ---------------------------------------------------------------------------

-- Refused rather than cascaded: unscheduling is `work_item.schedule`'s act and leaves its own
-- event, and doing it here would free a customer's appointment as a side effect of a settings
-- change nobody read the consequences of. The business unschedules the work and then turns it off.
create function app.check_type_has_no_scheduled_work()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if old.schedulable and not new.schedulable and exists (
    select 1
      from public.work_items w
     where w.organization_id = old.organization_id
       and w.type_id = old.id
       and w.scheduled_during is not null
  ) then
    raise exception 'work type % still has scheduled work', old.id
      using errcode = 'GD006';
  end if;

  return new;
end;
$fn$;

revoke all on function app.check_type_has_no_scheduled_work() from public;

comment on function app.check_type_has_no_scheduled_work() is
  'Switching scheduling off is refused while any work item of the type holds a scheduled window. Runs as owner so row-level read scope can never make a stranded appointment invisible to it.';

create trigger work_item_types_no_scheduled_work_when_unscheduled
  before update of schedulable on public.work_item_types
  for each row execute function app.check_type_has_no_scheduled_work();

-- ---------------------------------------------------------------------------
-- Creating a type states the answer; changing it is one narrow door
-- ---------------------------------------------------------------------------

-- Dropped and recreated: the argument list changes, and `create or replace` would leave the
-- two-argument version behind as a second, callable overload that answers nothing.
drop function public.create_work_item_type(uuid, text);

create function public.create_work_item_type(
  p_organization_id uuid,
  p_name            text,
  p_schedulable     boolean
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'create_work_item_type requires an authenticated caller'
      using errcode = '42501';
  end if;

  if p_schedulable is null then
    raise exception 'a work type must say whether it is scheduled'
      using errcode = '23502';
  end if;

  insert into public.work_item_types (organization_id, name, schedulable, created_by)
  values (p_organization_id, p_name, p_schedulable, v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'work_item_type', v_id, 'work_item_type.created',
     jsonb_build_object('name', p_name, 'schedulable', p_schedulable));

  return v_id;
end;
$fn$;

revoke all on function public.create_work_item_type(uuid, text, boolean) from public;
grant execute on function public.create_work_item_type(uuid, text, boolean) to authenticated;

-- SECURITY INVOKER, `rename_work_item_type`'s shape: the update policy (`field.manage`), the
-- column grant and the two triggers above decide, and this adds the transaction and the event.
create function public.set_work_item_type_schedulable(p_id uuid, p_schedulable boolean)
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
    raise exception 'set_work_item_type_schedulable requires an authenticated caller'
      using errcode = '42501';
  end if;

  if p_schedulable is null then
    raise exception 'a work type must say whether it is scheduled'
      using errcode = '23502';
  end if;

  update public.work_item_types
     set schedulable = p_schedulable
   where id = p_id
  returning organization_id into v_org;

  if v_org is null then
    raise exception 'no such work item type, or you may not change it'
      using errcode = '42501';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'work_item_type', p_id, 'work_item_type.scheduling_configured',
     jsonb_build_object('schedulable', p_schedulable));
end;
$fn$;

revoke all on function public.set_work_item_type_schedulable(uuid, boolean) from public;
grant execute on function public.set_work_item_type_schedulable(uuid, boolean) to authenticated;
