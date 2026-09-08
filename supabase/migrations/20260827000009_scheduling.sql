-- The window, the exclusion constraint, and the tenant's clock. I7 and I9.
--
-- This is the half of M2 that roadmap.md refuses to accept in any other form:
--
--   "`I7` is a database exclusion constraint. An application-level overlap check is not this
--    milestone."
--
-- And it is the specific failure constraints.md quotes from a real prior repository:
--
--   "`tire-app-template` has an exclusion constraint that coalesces a null technician to the
--    zero UUID, so every unassigned booking in the database shares one exclusion key. Add a
--    second tenant and their unassigned 9am job blocks yours, as a bare `23P01` with no
--    obvious cause."
--
-- Two details below are the whole answer to that, and neither is decoration.
--
--   * The constraint is PARTIAL: `where (resource_id is not null and scheduled_during is not
--     null)`. Unassigned or untimed work does not enter the index at all, so there is no key
--     to collide on and nothing to coalesce. A job with a window and no technician yet, and a
--     job assigned to someone with no time yet, are both ordinary and both outside the
--     constraint -- correctly, because neither can double-book anything.
--   * organization_id LEADS it (I2), so two tenants booking the same instant on identically
--     named resources never meet.
--
-- The window is ONE column, not two timestamps. A gist exclusion needs a range anyway, and a
-- pair of columns is a pair that can be stored the wrong way round. It is half-open by
-- constraint -- `[start, end)` -- which is what makes a job ending at 10:00 not collide with
-- one starting at 10:00. Written as two columns with an application-side comparison, that is
-- an off-by-one nobody finds until a technician is double-booked at a shift boundary.

-- Needed for `organization_id with =` and `resource_id with =` in a gist index: core gist
-- knows ranges and geometry, not equality on a uuid. `extensions` is where Supabase puts
-- these and is already on the default search_path.
create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- The tenant's clock (I9)
-- ---------------------------------------------------------------------------

-- I9 has two halves: the instant is absolute, and it is *rendered* in the tenant's zone.
-- `timestamptz` settles the first by construction. This column settles the second, and it
-- lives on the organization because a business has one clock its staff think in -- not one
-- per user, which would make two people disagree about when a job is.
create function app.is_iana_timezone(p_name text)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select exists (
    select 1 from pg_catalog.pg_timezone_names z where z.name = p_name
  );
$fn$;

comment on function app.is_iana_timezone(text) is
  'True for a zone name Postgres recognises. Used by a CHECK, because a CHECK cannot hold a subquery.';

alter table public.organizations
  add column timezone text not null default 'UTC'
  constraint organizations_timezone_known check (app.is_iana_timezone(timezone));

comment on column public.organizations.timezone is
  'IANA zone this business thinks in. Applied at render; never stored into an instant (I9).';

-- ---------------------------------------------------------------------------
-- The window
-- ---------------------------------------------------------------------------

alter table public.work_items
  add column scheduled_during tstzrange;

comment on column public.work_items.scheduled_during is
  'When this work occupies its resource. Half-open [start, end). Null means not yet scheduled.';

-- Bounded, non-empty, and half-open. Without the last clause `[9,10]` and `[10,11]` overlap
-- at exactly 10:00 and the constraint below would refuse two jobs that are genuinely
-- back to back; without the first, an unbounded range would block a resource forever.
alter table public.work_items
  add constraint work_items_window_is_bounded_half_open
  check (
    scheduled_during is null
    or (
      lower(scheduled_during) is not null
      and upper(scheduled_during) is not null
      and not isempty(scheduled_during)
      and lower_inc(scheduled_during)
      and not upper_inc(scheduled_during)
    )
  );

-- I7. The milestone.
alter table public.work_items
  add constraint work_items_resource_not_double_booked
  exclude using gist (
    organization_id  with =,
    resource_id      with =,
    scheduled_during with &&
  ) where (resource_id is not null and scheduled_during is not null);

comment on constraint work_items_resource_not_double_booked on public.work_items is
  'I7. Two work items can never occupy the same resource and window. Partial so that unassigned or untimed work shares no key.';

-- The calendar's query: one tenant's scheduled work, in time order. Not the exclusion index,
-- which answers overlap rather than range scans.
create index work_items_org_scheduled_idx
  on public.work_items (organization_id, lower(scheduled_during))
  where scheduled_during is not null;

-- ---------------------------------------------------------------------------
-- The new capability, and why the update policy could not simply gain a clause
-- ---------------------------------------------------------------------------

alter table public.roles drop constraint roles_capabilities_known;

alter table public.roles
  add constraint roles_capabilities_known
  check (capabilities <@ array[
    'customer.create',
    'role.manage',
    'field.manage',
    'location.create',
    'resource.create',
    'work_item.create',
    'asset.create',
    'document.create',
    'work_item.transition',
    'work_item.schedule'
  ]::text[]);

-- Scheduling is a dispatcher's act and transitioning is the doer's; a business that wants one
-- person to do both says so by putting both on one role. Backfilled onto whoever could
-- already move work, which is the closest existing answer to "runs the board".
update public.roles
   set capabilities = capabilities || array['work_item.schedule']::text[]
 where 'work_item.transition' = any (capabilities)
   and not ('work_item.schedule' = any (capabilities));

-- The policy now admits either capability, and that is as fine-grained as a policy can be.
-- An RLS policy sees the OLD row in USING or the NEW row in WITH CHECK and never both at
-- once, so no policy can express "you may change the status but not the resource". The
-- trigger below expresses it, because a trigger is the one place both rows exist.
--
-- Splitting authorization across a policy and a trigger is worth stating plainly rather than
-- discovering: the policy is the coarse gate (are you in this tenant, and do you hold any
-- reason to be writing here), the trigger is the per-column refinement. Both are in the
-- database, which is what I12 and I16 actually require -- neither is application code.
drop policy work_items_update on public.work_items;

create policy work_items_update on public.work_items
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and (
      app.has_capability(organization_id, 'work_item.transition')
      or app.has_capability(organization_id, 'work_item.schedule')
    )
  )
  with check (
    organization_id in (select app.current_tenant_ids())
    and (
      app.has_capability(organization_id, 'work_item.transition')
      or app.has_capability(organization_id, 'work_item.schedule')
    )
  );

grant update (resource_id, scheduled_during) on public.work_items to authenticated;

create function app.check_work_item_update_capability()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.status_id is distinct from old.status_id
     and not app.has_capability(new.organization_id, 'work_item.transition') then
    raise exception 'you may not move work item % between statuses', new.id
      using errcode = '42501';
  end if;

  if (new.resource_id is distinct from old.resource_id
      or new.scheduled_during is distinct from old.scheduled_during)
     and not app.has_capability(new.organization_id, 'work_item.schedule') then
    raise exception 'you may not schedule work item %', new.id
      using errcode = '42501';
  end if;

  return new;
end;
$fn$;

comment on function app.check_work_item_update_capability() is
  'Per-column half of the work_items update authorization. A policy cannot see OLD and NEW together; this can.';

-- Fires before work_items_transition_configured, alphabetically, which is the order wanted:
-- authorization, then validity.
create trigger work_items_capability_for_changed_columns
  before update on public.work_items
  for each row execute function app.check_work_item_update_capability();

-- ---------------------------------------------------------------------------
-- Scheduling as one transaction
-- ---------------------------------------------------------------------------

create function public.schedule_work_item(
  p_work_item_id uuid,
  p_resource_id  uuid,
  p_starts_at    timestamptz,
  p_ends_at      timestamptz
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
    raise exception 'schedule_work_item requires an authenticated caller'
      using errcode = '42501';
  end if;

  if p_starts_at is null or p_ends_at is null then
    raise exception 'a scheduled window needs both a start and an end'
      using errcode = '23514';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'a scheduled window must end after it starts'
      using errcode = '23514';
  end if;

  -- Half-open, always, and built here rather than by the caller so that no caller can
  -- choose otherwise. `[)` is what makes back-to-back work not collide.
  --
  -- p_resource_id may be null: work scheduled for Tuesday with nobody assigned yet is
  -- ordinary, and falls outside the exclusion constraint exactly as it should, because it
  -- cannot double-book anyone.
  update public.work_items
     set resource_id      = p_resource_id,
         scheduled_during = tstzrange(p_starts_at, p_ends_at, '[)')
   where id = p_work_item_id
  returning organization_id into v_org;

  -- A row refused by an UPDATE policy is invisible to the statement rather than an error, so
  -- without this the function would report success and write an event for work that was
  -- never scheduled. Same shape as assign_role and change_work_item_status.
  if v_org is null then
    raise exception 'no such work item, or you may not schedule it'
      using errcode = '42501';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'work_item', p_work_item_id, 'work_item.scheduled',
     jsonb_build_object(
       'resource_id', p_resource_id,
       'starts_at', p_starts_at,
       'ends_at', p_ends_at
     ));
end;
$fn$;

revoke all on function public.schedule_work_item(uuid, uuid, timestamptz, timestamptz) from public;
grant execute on function public.schedule_work_item(uuid, uuid, timestamptz, timestamptz) to authenticated;

-- A separate function rather than schedule_work_item(id, null, null, null). Clearing a
-- schedule is a different act with a different timeline entry, and a single function whose
-- meaning flips on whether its arguments are null is a function with two undocumented modes.
create function public.unschedule_work_item(p_work_item_id uuid)
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
    raise exception 'unschedule_work_item requires an authenticated caller'
      using errcode = '42501';
  end if;

  update public.work_items
     set resource_id      = null,
         scheduled_during = null
   where id = p_work_item_id
  returning organization_id into v_org;

  if v_org is null then
    raise exception 'no such work item, or you may not schedule it'
      using errcode = '42501';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'work_item', p_work_item_id, 'work_item.unscheduled', '{}'::jsonb);
end;
$fn$;

revoke all on function public.unschedule_work_item(uuid) from public;
grant execute on function public.unschedule_work_item(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- create_organization gains the clock
-- ---------------------------------------------------------------------------

-- The founder picks the zone their business thinks in, at the one moment the platform is
-- already asking them what the business is. There is deliberately no edit path yet: changing
-- it needs a settings screen and a capability of its own, and both wait for a caller -- the
-- same answer D19 gave for a membership's display name.
drop function public.create_organization(text, text, text[], text);

create function public.create_organization(
  p_name         text,
  p_role         text,
  p_capabilities text[],
  p_display_name text,
  p_timezone     text
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
  v_role  uuid;
begin
  if v_actor is null then
    raise exception 'create_organization requires an authenticated caller'
      using errcode = '42501';
  end if;

  insert into public.organizations (name, timezone, created_by)
  values (p_name, coalesce(p_timezone, 'UTC'), v_actor)
  returning id into v_org;

  insert into public.roles (organization_id, name, capabilities, created_by)
  values (v_org, p_role, p_capabilities, v_actor)
  returning id into v_role;

  insert into public.memberships
    (organization_id, user_id, role_id, display_name, created_by)
  values (v_org, v_actor, v_role, p_display_name, v_actor);

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'organization', v_org, 'organization.created',
     jsonb_build_object('name', p_name, 'role', p_role, 'timezone', p_timezone));

  return v_org;
end;
$fn$;

revoke all on function public.create_organization(text, text, text[], text, text) from public;
grant execute on function public.create_organization(text, text, text[], text, text) to authenticated;
