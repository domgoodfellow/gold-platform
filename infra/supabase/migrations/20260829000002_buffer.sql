-- Time a resource is not free after a job, and it is configuration.
--
-- `constraints.md` names this explicitly in the never-hardcode list: "Never hardcode
-- terminology, statuses, service types, prices, business hours, **buffers**, or currency."
-- This is that buffer, and the whole design follows from taking that literally.
--
-- **Why a business has one is not the platform's business.** A mobile service needs to drive
-- to the next address; a clinic needs the room cleaned; a hire yard inspects the machine
-- before it goes out again. Those are the same fact about a schedule -- the resource is not
-- available the instant the work ends -- and naming the column after any one of them would
-- bake one business's reason into every business's schema. It is `buffer_minutes`.
--
-- **Zero by default, and no seeded value.** Operating hours took the same position for the
-- same reason: a business that has configured nothing is treated as having said nothing, and
-- inventing a fifteen-minute gap on its behalf is a claim it never made.

alter table public.organizations
  add column buffer_minutes integer not null default 0
    constraint organizations_buffer_not_negative check (buffer_minutes >= 0)
    -- A day. Not a business rule -- an upper bound that keeps a typo from padding a range by
    -- a decade and making the resource permanently unbookable.
    constraint organizations_buffer_bounded check (buffer_minutes <= 1440);

comment on column public.organizations.buffer_minutes is
  'Minutes a resource stays occupied after work ends. Travel, cleaning, inspection -- the reason is the tenant''s. Zero means the business has said nothing.';

-- ---------------------------------------------------------------------------
-- What a job actually occupies
-- ---------------------------------------------------------------------------

-- **The buffer is a hard constraint, not a preference, and that decides everything below.**
--
-- The cheap version pads the availability calculation and leaves the exclusion constraint
-- alone. That breaks I5 in the direction nobody notices: `freeWindows` would refuse to offer
-- a slot the database would happily accept, so the two answers disagree and the constraint
-- stops being the re-assertion I6 relies on. For a business whose van cannot teleport, "you
-- may not book these ten minutes apart" is a fact about the world rather than advice.
--
-- So the buffer lands on the row, and the constraint moves onto it. Two ranges, because they
-- answer two different questions and merging them would destroy one:
--
--   * `scheduled_during` is **what the customer is told** -- the appointment. Unchanged.
--   * `occupies` is **what the resource cannot be double-booked across**. Never rendered.
--
-- The same IMMUTABLE problem as 20260829000001: a constraint predicate cannot read the
-- organization's buffer, so the value is maintained onto the row. This is the second use of
-- that idiom and it is worth naming as one.
alter table public.work_items
  add column occupies tstzrange;

comment on column public.work_items.occupies is
  'scheduled_during plus this organization''s buffer. What the exclusion constraint compares; never shown to anyone. Maintained by app.sync_work_item_occupies and app.propagate_buffer.';

create function app.work_item_occupies(p_window tstzrange, p_buffer integer)
returns tstzrange
language sql
immutable
set search_path = ''
as $fn$
  -- Trailing only. A buffer at both ends would charge the gap between two jobs twice, so an
  -- hour of travel would demand two hours between them. The gap belongs *after* the work.
  select case
    when p_window is null then null
    else tstzrange(
      lower(p_window),
      upper(p_window) + make_interval(mins => p_buffer),
      '[)'
    )
  end;
$fn$;

comment on function app.work_item_occupies(tstzrange, integer) is
  'The window a resource is unavailable for. Half-open like the appointment, so back-to-back work with a zero buffer still does not collide.';

update public.work_items w
   set occupies = app.work_item_occupies(w.scheduled_during, o.buffer_minutes)
  from public.organizations o
 where o.id = w.organization_id;

-- Direction one: the job is scheduled, moved, or unscheduled.
create function app.sync_work_item_occupies()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_buffer integer;
begin
  -- coalesce for the same reason as the status mirror: under RLS this lookup can find
  -- nothing, and writing NULL would raise a constraint error that hides the real one.
  select coalesce(
           (select o.buffer_minutes from public.organizations o where o.id = new.organization_id),
           0
         )
    into v_buffer;

  new.occupies := app.work_item_occupies(new.scheduled_during, v_buffer);
  return new;
end;
$fn$;

create trigger work_items_mirror_occupies
  before insert or update of scheduled_during, organization_id on public.work_items
  for each row execute function app.sync_work_item_occupies();

-- Direction two: the tenant changes the buffer, and every scheduled job follows.
--
-- SECURITY DEFINER for the reason the status propagation is: the caller holds
-- `organization.manage`, which owns nothing on `work_items`, and requiring
-- `work_item.schedule` as well in order to change a setting would merge two capabilities the
-- platform keeps apart.
create function app.propagate_buffer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.work_items
     set occupies = app.work_item_occupies(scheduled_during, new.buffer_minutes)
   where organization_id = new.id
     and scheduled_during is not null;

  return null;
end;
$fn$;

comment on function app.propagate_buffer() is
  'Recomputes every scheduled job''s occupied window when the tenant changes its buffer. Raises 23P01 if the wider windows would collide, which is the honest answer.';

create trigger organizations_propagate_buffer
  after update of buffer_minutes on public.organizations
  for each row when (old.buffer_minutes is distinct from new.buffer_minutes)
  execute function app.propagate_buffer();

-- ---------------------------------------------------------------------------
-- I7, moved onto the occupied window
-- ---------------------------------------------------------------------------

-- Everything that made this constraint right is unchanged: `organization_id` leads it (I2),
-- it is partial so unassigned or untimed work shares no key, and a released status still
-- frees the resource. The only difference is which range it compares -- and with a zero
-- buffer `occupies` *is* `scheduled_during`, so a business that has configured nothing sees
-- byte-identical behaviour.
alter table public.work_items
  drop constraint work_items_resource_not_double_booked;

alter table public.work_items
  add constraint work_items_resource_not_double_booked
  exclude using gist (
    organization_id with =,
    resource_id     with =,
    occupies        with &&
  ) where (
    resource_id is not null
    and occupies is not null
    and not status_releases_resource
  );

comment on constraint work_items_resource_not_double_booked on public.work_items is
  'I7. Compares the occupied window rather than the appointment, so a tenant''s buffer is enforced rather than merely displayed.';

-- The half-open check follows the appointment, not the occupied window: `occupies` is derived
-- and cannot be malformed if `scheduled_during` is not.

-- ---------------------------------------------------------------------------
-- Configuring it
-- ---------------------------------------------------------------------------

grant update (name, timezone, currency, buffer_minutes) on public.organizations to authenticated;

drop function public.update_organization(uuid, text, text, text);

create function public.update_organization(
  p_id             uuid,
  p_name           text,
  p_timezone       text,
  p_currency       text,
  p_buffer_minutes integer
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
    raise exception 'update_organization requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- Changing the currency does NOT reinterpret what past jobs cost: every amount carries the
  -- currency it was recorded in, snapshotted at insert (I8). Changing the timezone does not
  -- move any instant either -- an instant is absolute, and only its rendering changes (I9).
  --
  -- Changing the buffer *does* reach existing work, through the trigger above, and that is
  -- deliberate in the same way the status mirror is: a business that discovers it needs forty
  -- minutes between jobs means it about tomorrow's bookings, not only about the next one it
  -- takes. Widening far enough to overlap two committed jobs raises 23P01, which is the
  -- database refusing to hold a schedule the business cannot actually work.
  update public.organizations
     set name           = p_name,
         timezone       = p_timezone,
         currency       = p_currency,
         buffer_minutes = p_buffer_minutes
   where id = p_id
  returning id into v_org;

  if v_org is null then
    raise exception 'no such organization, or you may not change it'
      using errcode = '42501';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_id, v_actor, 'organization', p_id, 'organization.updated',
     jsonb_build_object(
       'name', p_name,
       'timezone', p_timezone,
       'currency', p_currency,
       'buffer_minutes', p_buffer_minutes
     ));
end;
$fn$;

revoke all on function public.update_organization(uuid, text, text, text, integer) from public;
grant execute on function public.update_organization(uuid, text, text, text, integer) to authenticated;
