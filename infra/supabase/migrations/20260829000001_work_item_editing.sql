-- Editing a work item, and making cancellation mean something.
--
-- Two things that arrived together because scoping the first found the second.
--
-- `updateWorkItem` did not exist: a job typed wrong today was wrong permanently, and no
-- business that has gone live tolerates that. That half is unremarkable -- a capability, a
-- column grant, and the per-column authorization split 20260827000009 already established.
--
-- The second half is the one worth reading. `roadmap.md` says cancelling "is a status the
-- tenant configures and a transition into it, needing no new code". That was wrong, and the
-- reason is `work_items_resource_not_double_booked`: its partial predicate is
-- `resource_id is not null and scheduled_during is not null`, which knows nothing about
-- status. So a tenant could configure "Cancelled", move a job into it, and the van stayed
-- booked for a job nobody was doing. On a business whose primary scheduling constraint is
-- travel, that is the afternoon gone.
--
-- The available workaround made it worse rather than better: unschedule, then transition.
-- Those are two capabilities -- `work_item.schedule` and `work_item.transition` -- so a
-- dispatcher who could cancel but not schedule would cancel the job and leave the slot held,
-- with nothing anywhere reporting that they had.

-- ---------------------------------------------------------------------------
-- A status can release the resource its work item holds
-- ---------------------------------------------------------------------------

-- 20260827000003 recorded "Deliberately no `is_terminal`. Nothing closes a work item yet, and
-- the flag's only purpose is to tell 'still open' from 'finished' for reporting and
-- automation that do not exist." That reasoning stands and this is not that flag.
--
-- `is_terminal` would have been the platform deciding what a status *means*. This asks the
-- tenant a question only the tenant can answer, in the vocabulary they already own: does work
-- in this status still hold the van. "Cancelled" and "No show" free it; "Awaiting parts" does
-- not, because the vehicle is still on the lift. D6 is intact -- the platform still has no
-- opinion about any status, it merely stores the tenant's.
--
-- Default false, which is the answer that changes nothing: every status that exists today
-- goes on holding its resource exactly as it did before this migration.
alter table public.work_item_statuses
  add column releases_resource boolean not null default false;

comment on column public.work_item_statuses.releases_resource is
  'Tenant''s answer to "does work in this status still occupy its resource". Feeds the exclusion constraint through work_items.status_releases_resource. Not is_terminal: the platform still does not know what any status means.';

-- ---------------------------------------------------------------------------
-- The same answer, carried onto the work item
-- ---------------------------------------------------------------------------

-- This column is the awkward part of the migration and the comment is the point of it.
--
-- An exclusion constraint's WHERE predicate must be IMMUTABLE, and "look up this row's
-- status and read a flag off it" is STABLE at best -- Postgres refuses it outright. The only
-- way for the constraint to know about status is for the answer to be *on the row*, so it is,
-- maintained by the two triggers below and writable by nobody else.
--
-- **It is a cache, not a snapshot, and the distinction is I8's.** Everything else this
-- platform copies onto a row -- a priced line's amount, a checklist step's label, a cost's
-- currency -- is snapshotted precisely so that changing configuration cannot reach backwards
-- into work already committed. This is the opposite on purpose: a tenant who marks "Cancelled"
-- as releasing means it about the jobs already sitting in it, and a snapshot would free the
-- next cancellation while leaving today's van booked. I8 protects amounts and terms somebody
-- agreed to. Whether a status holds a resource is not one of those; it is a live question
-- about a live constraint, and the tenant's current answer is the only correct one.
alter table public.work_items
  add column status_releases_resource boolean not null default false;

comment on column public.work_items.status_releases_resource is
  'Maintained mirror of this row status'' releases_resource. Exists because an exclusion constraint predicate must be IMMUTABLE and cannot join. Written only by app.sync_work_item_status_release and app.propagate_status_release; never granted.';

-- Backfill before the constraint is rebuilt, so the two never disagree even for the length of
-- this transaction. Every existing status is `false`, so this updates nothing today -- it is
-- here because a migration that is only correct on an empty table is not correct.
update public.work_items w
   set status_releases_resource = s.releases_resource
  from public.work_item_statuses s
 where s.id = w.status_id
   and w.status_releases_resource is distinct from s.releases_resource;

-- ---------------------------------------------------------------------------
-- Keeping the mirror true
-- ---------------------------------------------------------------------------

-- Direction one: a work item moves to a different status. BEFORE, so the value is right in
-- the same row version the exclusion constraint is about to judge.
--
-- SECURITY INVOKER (the default): this writes to NEW, not to a table, so there is no
-- privilege to escalate and the caller's own rights are the correct ones.
create function app.sync_work_item_status_release()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  -- `coalesce`, and it is load-bearing rather than defensive. This trigger runs as the
  -- caller, so RLS hides another tenant's status and the lookup finds nothing -- at which
  -- point a bare assignment would write NULL and the NOT NULL constraint would raise 23502,
  -- masking the 23503 that I18's composite reference is about to raise for the real reason.
  -- Defaulting to false lets the foreign key refuse the row and say why.
  select coalesce(
           (select s.releases_resource
              from public.work_item_statuses s
             where s.id = new.status_id),
           false
         )
    into new.status_releases_resource;

  return new;
end;
$fn$;

comment on function app.sync_work_item_status_release() is
  'Mirrors the status'' releases_resource onto the work item, so the exclusion constraint can read it as a plain column.';

create trigger work_items_mirror_status_release
  before insert or update of status_id on public.work_items
  for each row execute function app.sync_work_item_status_release();

-- Direction two: the tenant changes their mind about a status, and every job sitting in it
-- has to follow.
--
-- SECURITY DEFINER, and this one genuinely needs it. The caller holds `field.manage` -- they
-- are configuring the board -- and that capability deliberately grants nothing on
-- `work_items`. Asking them to also hold `work_item.schedule` in order to rename a column
-- would merge two capabilities the platform has kept apart on purpose. The privilege is
-- narrow to the point of being uninteresting: one column, on rows of the organization that
-- owns the status being changed, and the value is not the caller's to choose.
create function app.propagate_status_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.work_items
     set status_releases_resource = new.releases_resource
   where status_id = new.id
     and organization_id = new.organization_id
     and status_releases_resource is distinct from new.releases_resource;

  return null;
end;
$fn$;

comment on function app.propagate_status_release() is
  'Pushes a status'' changed releases_resource onto every work item in it. SECURITY DEFINER because configuring the board is field.manage, which owns nothing on work_items.';

-- `when` rather than a body check: the whole cost of this trigger should fall on the one
-- statement a year that actually flips the flag, not on every rename and reorder.
create trigger work_item_statuses_propagate_release
  after update of releases_resource on public.work_item_statuses
  for each row when (old.releases_resource is distinct from new.releases_resource)
  execute function app.propagate_status_release();

-- ---------------------------------------------------------------------------
-- I7, rebuilt to know about it
-- ---------------------------------------------------------------------------

-- The predicate gains one clause and nothing else changes: `organization_id` still leads it
-- (I2), it is still partial so that unassigned or untimed work shares no key rather than
-- being coalesced to a zero uuid, and the window is still the half-open range that lets
-- back-to-back work not collide.
--
-- Dropping and re-adding rebuilds the gist index, which is why this is the last thing the
-- migration does to the table.
alter table public.work_items
  drop constraint work_items_resource_not_double_booked;

alter table public.work_items
  add constraint work_items_resource_not_double_booked
  exclude using gist (
    organization_id  with =,
    resource_id      with =,
    scheduled_during with &&
  ) where (
    resource_id is not null
    and scheduled_during is not null
    and not status_releases_resource
  );

comment on constraint work_items_resource_not_double_booked on public.work_items is
  'I7. Two work items never occupy one resource and window -- unless the tenant has said this status releases it, which is what makes cancelling free the van.';

-- ---------------------------------------------------------------------------
-- Configuring it: the status edit path gains the question
-- ---------------------------------------------------------------------------

-- `create_work_item_status` is deliberately untouched. A status is born holding its resource,
-- which is the answer that surprises nobody, and the tenant says otherwise on the edit screen
-- that already exists. Adding a third argument to the creation path would have rewritten
-- every call site in the suite to say `false`.
grant update (name, position, releases_resource) on public.work_item_statuses to authenticated;

drop function public.update_work_item_status(uuid, text, integer);

create function public.update_work_item_status(
  p_id                uuid,
  p_name              text,
  p_position          integer,
  p_releases_resource boolean
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
    raise exception 'update_work_item_status requires an authenticated caller'
      using errcode = '42501';
  end if;

  update public.work_item_statuses
     set name              = p_name,
         position          = p_position,
         releases_resource = p_releases_resource
   where id = p_id
  returning organization_id into v_org;

  if v_org is null then
    raise exception 'no such status, or you may not change it'
      using errcode = '42501';
  end if;

  -- Renaming a column does not move any work: a work item references a status by id, so
  -- every job sitting in "Booked" is sitting in the same row after it becomes "Scheduled".
  -- That is what D6 buys -- the tenant's word is data, and changing it is not a migration.
  --
  -- Turning `releases_resource` off, however, can fail right here with 23P01, and correctly:
  -- the tenant has just asserted that two overlapping jobs both hold the same van. The
  -- exclusion constraint refuses in the trigger's UPDATE rather than letting the board become
  -- something the scheduler cannot represent.
  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'work_item_status', p_id, 'work_item_status.updated',
     jsonb_build_object(
       'name', p_name,
       'position', p_position,
       'releases_resource', p_releases_resource
     ));
end;
$fn$;

revoke all on function public.update_work_item_status(uuid, text, integer, boolean) from public;
grant execute on function public.update_work_item_status(uuid, text, integer, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- The other half: editing a work item's details
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
    'work_item.schedule',
    'work_item.record',
    'organization.manage',
    'price.manage',
    'work_item.price',
    'work_item.update'
  ]::text[]);

-- Backfilled onto whoever may create work, which is the closest existing answer to "types
-- jobs in". Someone trusted to write a job down is trusted to correct it; that is a weaker
-- claim than moving it along the board or committing a van to it, which is why this is not
-- backfilled onto those.
update public.roles
   set capabilities = capabilities || array['work_item.update']::text[]
 where 'work_item.create' = any (capabilities)
   and not ('work_item.update' = any (capabilities));

-- The policy is the coarse gate and gains one more reason to be writing here. Without this a
-- role holding only `work_item.update` would be refused by the policy before the trigger
-- below ever got the chance to decide which columns they may touch.
drop policy work_items_update on public.work_items;

create policy work_items_update on public.work_items
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and (
      app.has_capability(organization_id, 'work_item.transition')
      or app.has_capability(organization_id, 'work_item.schedule')
      or app.has_capability(organization_id, 'work_item.update')
    )
  )
  with check (
    organization_id in (select app.current_tenant_ids())
    and (
      app.has_capability(organization_id, 'work_item.transition')
      or app.has_capability(organization_id, 'work_item.schedule')
      or app.has_capability(organization_id, 'work_item.update')
    )
  );

-- What may be edited, and every omission is deliberate.
--
--   * `type_id` is absent. Changing a type strands the status the work item is in -- I20's
--     three-column reference would refuse it -- and there is no reading of "correct a typo"
--     that requires it. `create_work_item` derives the type from the status precisely so that
--     nobody is ever holding both; this keeps that true after creation.
--   * `status_id` is absent: that is `work_item.transition`, checked by the trigger below and
--     validated against the tenant's configured transitions by I13.
--   * `resource_id` and `scheduled_during` are absent: that is `work_item.schedule`.
--   * `status_releases_resource` is absent from every grant in this file. It is the platform's
--     mirror, not a fact anybody may assert.
grant update (title, customer_id, location_id, asset_id, custom) on public.work_items to authenticated;

create or replace function app.check_work_item_update_capability()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  -- **A referential action is not an edit, and this is the line that says so.**
  --
  -- Three of the columns below sit behind `on delete set null`: deleting a customer, a
  -- location or an asset makes the database null that reference on every work item pointing
  -- at it. That UPDATE reaches this trigger looking exactly like somebody editing a job, and
  -- without this guard deleting a customer would demand `work_item.update` from whoever did
  -- it -- authorization for one entity leaking onto another. `resource_id` had the same hole
  -- before this migration and nothing had exercised it.
  --
  -- `pg_trigger_depth()` is 1 when the caller wrote the statement themselves and 2 or more
  -- when a trigger did -- and the foreign key's referential action is a trigger. Deleting the
  -- customer is authorized as a customer deletion, which is where that decision belongs.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

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

  -- The third lane. `custom` is compared with `is distinct from` like the rest, so a form
  -- that submits an unchanged jsonb does not demand a capability the caller does not need --
  -- which matters because `work_items_custom_conforms` fires on the column appearing in the
  -- SET list rather than on its value changing.
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
$fn$;

create function public.update_work_item(
  p_id          uuid,
  p_title       text,
  p_customer_id uuid,
  p_location_id uuid,
  p_asset_id    uuid,
  p_custom      jsonb
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
    raise exception 'update_work_item requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- One statement, so the custom-field trigger, the per-column capability trigger and the
  -- four composite references all judge the same row version. Nulling a reference is a real
  -- edit -- a job wrongly attached to a customer must be detachable -- so these are passed
  -- straight through rather than coalesced to the old value.
  update public.work_items
     set title       = p_title,
         customer_id = p_customer_id,
         location_id = p_location_id,
         asset_id    = p_asset_id,
         custom      = p_custom
   where id = p_id
  returning organization_id into v_org;

  -- A policy-denied update affects zero rows and raises nothing, so without this the event
  -- below would record an edit that never happened. The same check `change_work_item_status`
  -- makes, for the same reason.
  if v_org is null then
    raise exception 'no such work item, or you may not change it'
      using errcode = '42501';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'work_item', p_id, 'work_item.updated',
     jsonb_build_object(
       'title', p_title,
       'customer_id', p_customer_id,
       'location_id', p_location_id,
       'asset_id', p_asset_id
     ));
end;
$fn$;

revoke all on function public.update_work_item(uuid, text, uuid, uuid, uuid, jsonb) from public;
grant execute on function public.update_work_item(uuid, text, uuid, uuid, uuid, jsonb) to authenticated;
