-- Edit paths for the configuration a business chose once and can now change.
--
-- Three things shipped write-once because each needed an authorization model that had no
-- caller yet: an organization's name, timezone and currency, chosen at founding; a work item
-- type's name; and a status's name and board position. D19 set the precedent for deferring an
-- edit path -- "what remains missing is an edit path, which waits for a caller like everything
-- else" -- and the caller has arrived: a business that picked the wrong timezone at signup,
-- or typed its board column wrong, currently has no recourse short of a migration.
--
-- What is deliberately still not editable, and why each is different in kind:
--
--   * A checklist step's label. The column grant refuses it on purpose: changing what you
--     agreed to do after doing something else is the thing being prevented.
--   * A recorded cost or timesheet. History, not configuration. A correction is a new row.
--   * An event. Append-only, and the reason the timeline is worth anything.
--   * A transition. Removing one is not a rename, and a business that wants a different
--     lifecycle adds and removes wiring; there is no field on a transition to edit.

-- ---------------------------------------------------------------------------
-- The new capability
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
    'organization.manage'
  ]::text[]);

-- Distinct from field.manage on purpose. Naming a board column is configuring how this
-- business records work; changing the currency it trades in or the clock its staff read is
-- changing the business itself, and those are plausibly different people. Backfilled onto
-- whoever administers roles, which is the closest existing answer to "runs the company".
update public.roles
   set capabilities = capabilities || array['organization.manage']::text[]
 where 'role.manage' = any (capabilities)
   and not ('organization.manage' = any (capabilities));

-- ---------------------------------------------------------------------------
-- An organization's own settings
-- ---------------------------------------------------------------------------

-- The first update policy on organizations. Until now the table had none at all, so a tenant
-- was immutable from the moment it was founded.
create policy organizations_update on public.organizations
  for update to authenticated
  using (
    id in (select app.current_tenant_ids())
    and app.has_capability(id, 'organization.manage')
  )
  with check (
    id in (select app.current_tenant_ids())
    and app.has_capability(id, 'organization.manage')
  );

-- Only these three. `created_by` and `created_at` are the record of how this tenant came to
-- exist and are not settings; `id` is the tenant id itself, and a row that could change it
-- could walk into another tenant.
grant update (name, timezone, currency) on public.organizations to authenticated;

create function public.update_organization(
  p_id       uuid,
  p_name     text,
  p_timezone text,
  p_currency text
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
  -- currency it was recorded in, snapshotted at insert, precisely so this operation is safe
  -- (I8). Changing the timezone does not move any instant either -- an instant is absolute,
  -- and only its rendering changes, which is I9 working as intended.
  update public.organizations
     set name     = p_name,
         timezone = p_timezone,
         currency = p_currency
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
     jsonb_build_object('name', p_name, 'timezone', p_timezone, 'currency', p_currency));
end;
$fn$;

revoke all on function public.update_organization(uuid, text, text, text) from public;
grant execute on function public.update_organization(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Renaming a work item type
-- ---------------------------------------------------------------------------

create policy work_item_types_update on public.work_item_types
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'field.manage')
  )
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'field.manage')
  );

grant update (name) on public.work_item_types to authenticated;

create function public.rename_work_item_type(p_id uuid, p_name text)
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
    raise exception 'rename_work_item_type requires an authenticated caller'
      using errcode = '42501';
  end if;

  update public.work_item_types
     set name = p_name
   where id = p_id
  returning organization_id into v_org;

  if v_org is null then
    raise exception 'no such work item type, or you may not change it'
      using errcode = '42501';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'work_item_type', p_id, 'work_item_type.renamed',
     jsonb_build_object('name', p_name));
end;
$fn$;

revoke all on function public.rename_work_item_type(uuid, text) from public;
grant execute on function public.rename_work_item_type(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Renaming and reordering a status
-- ---------------------------------------------------------------------------

create policy work_item_statuses_update on public.work_item_statuses
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'field.manage')
  )
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'field.manage')
  );

-- Name and position only. `type_id` is not editable: moving a status to another type would
-- strand every work item sitting in it and every transition wired to it, and the constraint
-- that makes I20 true would refuse it anyway -- better to have no path than a path that fails
-- with a foreign key error nobody can read.
grant update (name, position) on public.work_item_statuses to authenticated;

create function public.update_work_item_status(
  p_id       uuid,
  p_name     text,
  p_position integer
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
     set name     = p_name,
         position = p_position
   where id = p_id
  returning organization_id into v_org;

  if v_org is null then
    raise exception 'no such status, or you may not change it'
      using errcode = '42501';
  end if;

  -- Renaming a column does not move any work: a work item references a status by id, so
  -- every job sitting in "Booked" is sitting in the same row after it becomes "Scheduled".
  -- That is what D6 buys -- the tenant's word is data, and changing it is not a migration.
  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'work_item_status', p_id, 'work_item_status.updated',
     jsonb_build_object('name', p_name, 'position', p_position));
end;
$fn$;

revoke all on function public.update_work_item_status(uuid, text, integer) from public;
grant execute on function public.update_work_item_status(uuid, text, integer) to authenticated;
