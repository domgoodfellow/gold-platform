-- A work item can have many resources: the assignment relationship, and the guarantee that moves to it.
--
-- **Expand and backfill.** `20261116000002` switches every reader and writer and removes
-- `work_items.resource_id`; this file only adds the new model beside the old one and copies the
-- old answers across, so a failure here leaves nothing half-switched.
--
-- **Who owns what.** The work item still owns *when* — `scheduled_during`, and `occupies`, the
-- window plus the tenant's buffer, mirrored by two triggers that already know about releasing
-- statuses. An assignment owns *who takes part*. Nothing here gives a resource a window of its own:
-- every assigned resource is committed for the work item's one occupied window.
--
-- **`work_item_resource_assignments.occupies` is enforcement state and not a second schedule.** A
-- Postgres exclusion constraint cannot see another table, and the guarantee that no resource is
-- double-booked has to stay a constraint — a check before an insert races identically (I6). So the
-- parent's occupied window is projected onto each assignment row by two triggers, and the
-- constraint sits on the projection. Nothing but those triggers writes it: it is in no column
-- grant, no function takes it, and the application never computes it. It is the work item's own
-- `occupies`, or null when the work item is unscheduled or in a status the tenant says releases
-- its resources — exactly the predicate the old constraint wrote.

-- ---------------------------------------------------------------------------
-- The relationship
-- ---------------------------------------------------------------------------

create table public.work_item_resource_assignments (
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  work_item_id    uuid        not null,
  resource_id     uuid        not null,
  -- The parent's `occupies` while the work item consumes capacity, otherwise null. Derived; see above.
  occupies        tstzrange,
  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),
  -- Tenant-leading, and a resource taking part twice in one job is one fact (I2).
  primary key (organization_id, work_item_id, resource_id),
  -- Both ends in this organization by construction (I18). No cascade from a resource: nothing
  -- hard-deletes one, and the history of who did a job should refuse to vanish by accident.
  constraint work_item_resource_assignments_work_item_same_org
    foreign key (organization_id, work_item_id)
    references public.work_items (organization_id, id) on delete cascade,
  constraint work_item_resource_assignments_resource_same_org
    foreign key (organization_id, resource_id)
    references public.resources (organization_id, id)
);

comment on table public.work_item_resource_assignments is
  'Which resources take part in a work item. The only answer to that question. `occupies` is database-maintained enforcement state derived from the work item, never a schedule of its own.';

-- I7, at assignment level: no resource is occupied twice over the same instant. Tenant-leading (I2),
-- half-open because `occupies` is, and partial so unscheduled or released work shares no key.
alter table public.work_item_resource_assignments
  add constraint work_item_resource_assignments_resource_not_double_booked
  exclude using gist (
    organization_id with =,
    resource_id     with =,
    occupies        with &&
  ) where (occupies is not null);

comment on constraint work_item_resource_assignments_resource_not_double_booked
  on public.work_item_resource_assignments is
  'I7. Two work items can never occupy the same resource and window. Partial on a derived occupies, so unscheduled and released work shares no key.';

-- "What is this resource doing", and "who is on this job".
create index work_item_resource_assignments_by_resource
  on public.work_item_resource_assignments (organization_id, resource_id);

alter table public.work_item_resource_assignments enable row level security;
alter table public.work_item_resource_assignments force row level security;

-- ---------------------------------------------------------------------------
-- Authority
-- ---------------------------------------------------------------------------

-- Putting somebody on a job at the moment it is raised was always the creator's act (`resource_id`
-- was in the insert grant), while changing it later was scheduling's. A transaction-local setting
-- that only `create_work_item` sets keeps both: the creator may assign what they just created, and
-- nobody else may touch an existing job's resources without `work_item.schedule`. Same shape as
-- `app.acting_automation()`: PostgREST issues no SET, so a client cannot write it.
create function app.creating_work_item()
returns uuid
language sql
stable
set search_path = ''
as $fn$
  select nullif(current_setting('app.creating_work_item', true), '')::uuid;
$fn$;

revoke all on function app.creating_work_item() from public;
grant execute on function app.creating_work_item() to authenticated;

create policy work_item_resource_assignments_select on public.work_item_resource_assignments
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy work_item_resource_assignments_insert on public.work_item_resource_assignments
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and (
      app.has_capability(organization_id, 'work_item.schedule')
      or work_item_id = app.creating_work_item()
    )
  );

create policy work_item_resource_assignments_delete on public.work_item_resource_assignments
  for delete to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'work_item.schedule')
  );

-- No update: an assignment is made or unmade. No `occupies` in any grant.
grant select, delete on public.work_item_resource_assignments to authenticated;
grant insert (organization_id, work_item_id, resource_id, created_by)
  on public.work_item_resource_assignments to authenticated;

-- ---------------------------------------------------------------------------
-- The projection: parent occupancy onto each assignment
-- ---------------------------------------------------------------------------

-- Security definer because the lock below runs through the update policy, which somebody holding
-- `work_item.schedule` and not `work_item.update` does not satisfy, and because a visitor booking
-- (`create_booking`) is the owner already. `for share` on the work item is what closes the race
-- between this and `app.sync_assignment_occupies`: an assignment inserted while the parent is
-- being rescheduled waits for it and then reads the new window, and a reschedule that arrives
-- while an assignment is being inserted waits for that and then sees its row. Without the lock
-- either could slip past the other and leave a scheduled job holding nothing.
create function app.set_assignment_occupies()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_window   tstzrange;
  v_released boolean;
begin
  select w.occupies, w.status_releases_resource
    into v_window, v_released
    from public.work_items w
   where w.organization_id = new.organization_id
     and w.id = new.work_item_id
     for share;

  new.occupies := case when v_window is not null and not coalesce(v_released, false) then v_window end;
  return new;
end;
$fn$;

revoke all on function app.set_assignment_occupies() from public;

create trigger work_item_resource_assignments_project_occupies
  before insert on public.work_item_resource_assignments
  for each row execute function app.set_assignment_occupies();

-- The other direction: when the parent's window or its release state changes, every assignment
-- follows in the same statement. A conflict is raised here, from the UPDATE below, and so rolls
-- back the parent's change with it — reschedule, buffer change and status change are all refused
-- as a whole rather than half applied.
create function app.sync_assignment_occupies()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.work_item_resource_assignments a
     set occupies = case when new.occupies is not null and not new.status_releases_resource then new.occupies end
   where a.organization_id = new.organization_id
     and a.work_item_id = new.id;

  return null;
end;
$fn$;

revoke all on function app.sync_assignment_occupies() from public;

-- After, so the BEFORE triggers that derive `occupies` and `status_releases_resource` have settled.
create trigger work_items_sync_assignment_occupies
  after update on public.work_items
  for each row
  when (
    old.occupies is distinct from new.occupies
    or old.status_releases_resource is distinct from new.status_releases_resource
  )
  execute function app.sync_assignment_occupies();

-- ---------------------------------------------------------------------------
-- Backfill: every old answer becomes one assignment
-- ---------------------------------------------------------------------------

-- One statement, and the only place it is written. `occupies` repeats the old constraint's own
-- predicate so the new constraint starts from exactly the state the old one already held. A job
-- with no resource gets no row — nothing is invented.
insert into public.work_item_resource_assignments
  (organization_id, work_item_id, resource_id, occupies, created_at, created_by)
select w.organization_id,
       w.id,
       w.resource_id,
       case when w.occupies is not null and not w.status_releases_resource then w.occupies end,
       w.created_at,
       w.created_by
  from public.work_items w
 where w.resource_id is not null;

-- Agreement, checked before anything is switched: the migration fails rather than carry on with a
-- copy that does not match.
do $$
declare
  v_old bigint;
  v_new bigint;
begin
  select count(*) into v_old from public.work_items where resource_id is not null;
  select count(*) into v_new from public.work_item_resource_assignments;

  if v_old <> v_new then
    raise exception 'assignment backfill disagrees with work_items.resource_id: % old, % new', v_old, v_new;
  end if;

  if exists (
    select 1
      from public.work_items w
      left join public.work_item_resource_assignments a
        on a.organization_id = w.organization_id
       and a.work_item_id = w.id
       and a.resource_id = w.resource_id
     where w.resource_id is not null
       and a.resource_id is null
  ) then
    raise exception 'assignment backfill is missing a resource that work_items.resource_id names';
  end if;
end
$$;
