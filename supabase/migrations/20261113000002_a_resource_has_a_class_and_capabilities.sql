-- A resource says what kind of thing it is, and what it can do.
--
-- **Two different facts, and the scheduling engine needs both.** A resource's *class* is
-- platform vocabulary — person, vehicle, equipment, facility, other — a small closed set that
-- means the same for a clinic and a garage. Its *capabilities* are the business's own words for
-- what it can satisfy ("Tire service", "Mobile service") and are therefore rows a business owns,
-- not constants. Neither is engine-critical data to be left in `resources.custom`, which the
-- engine cannot read with any guarantee.
--
-- **Nothing here changes scheduling.** `work_items.resource_id`, the exclusion constraint,
-- availability and booking are untouched: no work type declares a requirement yet, so nothing
-- reads these columns to decide eligibility. This is the Resource half of that later question.
--
-- **The backfill is the one deterministic fact the schema already holds.** A resource that
-- represents a Membership represents a person. Every other existing resource becomes `other`,
-- because the only other evidence is its name, and reading "van" or "room" out of a name is a
-- guess dressed as a migration. `other` is therefore a compatibility value for rows that existed
-- before the question could be asked; it is not a default — the column has none, so a new
-- resource must say.

-- ---------------------------------------------------------------------------
-- Resource class
-- ---------------------------------------------------------------------------

alter table public.resources
  add column resource_class text;

update public.resources
   set resource_class = case when membership_id is not null then 'person' else 'other' end;

alter table public.resources
  alter column resource_class set not null;

alter table public.resources
  add constraint resources_class_known
  check (resource_class in ('person', 'vehicle', 'equipment', 'facility', 'other'));

-- A Membership is a person's relationship with the business; it cannot stand for a van. Written
-- as a check so a raw update is refused the same as the domain layer is.
alter table public.resources
  add constraint resources_member_is_person
  check (membership_id is null or resource_class = 'person');

comment on column public.resources.resource_class is
  'person | vehicle | equipment | facility | other. Platform vocabulary, no default: a new resource states it. A Membership-linked resource is always a person.';

-- Insert is table-wide and held through `resources_insert` (resource.create), so the new column is
-- inherited there on purpose. Update is by column: only class is added, and the change goes through
-- the narrow door below.
grant update (resource_class) on public.resources to authenticated;

-- ---------------------------------------------------------------------------
-- Capability vocabulary — the business's own words
-- ---------------------------------------------------------------------------

create table public.resource_capabilities (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  name            text        not null check (length(btrim(name)) between 1 and 64),
  -- Archived, never deleted: a later work requirement will point at this identity, and removing
  -- the row would erase what that requirement meant. An archived capability stays on the
  -- resources that hold it and can no longer be given to another.
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),
  constraint resource_capabilities_org_id_unique unique (organization_id, id)
);

-- Case-insensitive, tenant-leading (I2): "Tire Service" and "Tire service" are one capability, the
-- same convention work types and statuses already use.
create unique index resource_capabilities_org_name_unique
  on public.resource_capabilities (organization_id, lower(btrim(name)));

comment on table public.resource_capabilities is
  'What a business says a resource can do, in its own words. Identity is the id; the name may be changed without touching any assignment.';

alter table public.resource_capabilities enable row level security;
alter table public.resource_capabilities force row level security;

create policy resource_capabilities_select on public.resource_capabilities
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- Vocabulary is configuration, so it is `field.manage`'s, exactly as work types are.
create policy resource_capabilities_insert on public.resource_capabilities
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'field.manage')
  );

create policy resource_capabilities_update on public.resource_capabilities
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'field.manage')
  )
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'field.manage')
  );

-- No delete policy and no delete grant. Name and archive are the whole of what changes.
grant select on public.resource_capabilities to authenticated;
grant insert (id, organization_id, name, created_by) on public.resource_capabilities to authenticated;
grant update (name, archived_at) on public.resource_capabilities to authenticated;

-- ---------------------------------------------------------------------------
-- Which resource can do what
-- ---------------------------------------------------------------------------

create table public.resource_capability_assignments (
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  resource_id     uuid        not null,
  capability_id   uuid        not null,
  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),
  -- Tenant-leading, and the same pair twice is the same fact (I2).
  primary key (organization_id, resource_id, capability_id),
  -- Both ends in this organization, by construction (I18).
  constraint resource_capability_assignments_resource_same_org
    foreign key (organization_id, resource_id)
    references public.resources (organization_id, id) on delete cascade,
  constraint resource_capability_assignments_capability_same_org
    foreign key (organization_id, capability_id)
    references public.resource_capabilities (organization_id, id)
);

-- "Which resources can do X": the direction a requirement will ask.
create index resource_capability_assignments_by_capability
  on public.resource_capability_assignments (organization_id, capability_id);

alter table public.resource_capability_assignments enable row level security;
alter table public.resource_capability_assignments force row level security;

create policy resource_capability_assignments_select on public.resource_capability_assignments
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- Giving a resource a capability is correcting the resource: either authority over it suffices.
create policy resource_capability_assignments_insert on public.resource_capability_assignments
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and (
      app.has_capability(organization_id, 'resource.update')
      or app.has_capability(organization_id, 'resource.create')
    )
  );

create policy resource_capability_assignments_delete on public.resource_capability_assignments
  for delete to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'resource.update')
  );

grant select, delete on public.resource_capability_assignments to authenticated;
grant insert (organization_id, resource_id, capability_id, created_by)
  on public.resource_capability_assignments to authenticated;

-- An archived capability is not given to anything new. A trigger rather than a policy because the
-- policy cannot see the capability's row without a subquery on every insert path.
create function app.check_capability_assignable()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if exists (
    select 1
      from public.resource_capabilities c
     where c.organization_id = new.organization_id
       and c.id = new.capability_id
       and c.archived_at is not null
  ) then
    raise exception 'capability % is archived', new.capability_id
      using errcode = 'GD007';
  end if;

  return new;
end;
$fn$;

revoke all on function app.check_capability_assignable() from public;

create trigger resource_capability_assignments_assignable
  before insert on public.resource_capability_assignments
  for each row execute function app.check_capability_assignable();

-- ---------------------------------------------------------------------------
-- Vocabulary doors
-- ---------------------------------------------------------------------------

create function public.create_resource_capability(p_organization_id uuid, p_name text)
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
    raise exception 'create_resource_capability requires an authenticated caller'
      using errcode = '42501';
  end if;

  insert into public.resource_capabilities (organization_id, name, created_by)
  values (p_organization_id, btrim(p_name), v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'resource_capability', v_id, 'resource_capability.created',
     jsonb_build_object('name', btrim(p_name)));

  return v_id;
end;
$fn$;

revoke all on function public.create_resource_capability(uuid, text) from public;
grant execute on function public.create_resource_capability(uuid, text) to authenticated;

create function public.rename_resource_capability(p_id uuid, p_name text)
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
    raise exception 'rename_resource_capability requires an authenticated caller'
      using errcode = '42501';
  end if;

  update public.resource_capabilities
     set name = btrim(p_name)
   where id = p_id
  returning organization_id into v_org;

  if v_org is null then
    raise exception 'no such capability, or you may not change it'
      using errcode = '42501';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'resource_capability', p_id, 'resource_capability.renamed',
     jsonb_build_object('name', btrim(p_name)));
end;
$fn$;

revoke all on function public.rename_resource_capability(uuid, text) from public;
grant execute on function public.rename_resource_capability(uuid, text) to authenticated;

create function public.set_resource_capability_archived(p_id uuid, p_archived boolean)
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
    raise exception 'set_resource_capability_archived requires an authenticated caller'
      using errcode = '42501';
  end if;

  update public.resource_capabilities
     set archived_at = case when p_archived then coalesce(archived_at, now()) else null end
   where id = p_id
  returning organization_id into v_org;

  if v_org is null then
    raise exception 'no such capability, or you may not change it'
      using errcode = '42501';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'resource_capability', p_id,
     case when p_archived then 'resource_capability.archived' else 'resource_capability.restored' end,
     '{}'::jsonb);
end;
$fn$;

revoke all on function public.set_resource_capability_archived(uuid, boolean) from public;
grant execute on function public.set_resource_capability_archived(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Resource doors: creation states the class; class and capabilities change one at a time
-- ---------------------------------------------------------------------------

-- Dropped and recreated, never replaced: the argument list changes, and a surviving four-argument
-- version would be a second, callable way to create a resource that says nothing about what it is.
drop function public.create_resource(uuid, text, jsonb, uuid);

create function public.create_resource(
  p_organization_id uuid,
  p_name            text,
  p_resource_class  text,
  p_custom          jsonb,
  p_membership_id   uuid  default null,
  p_capability_ids  uuid[] default null
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
    raise exception 'create_resource requires an authenticated caller'
      using errcode = '42501';
  end if;

  if p_resource_class is null then
    raise exception 'a resource must say what kind of resource it is'
      using errcode = '23502';
  end if;

  insert into public.resources
    (organization_id, name, resource_class, custom, membership_id, created_by)
  values
    (p_organization_id, p_name, p_resource_class, coalesce(p_custom, '{}'::jsonb), p_membership_id, v_actor)
  returning id into v_id;

  -- With the resource, in one transaction: a half-created resource with some of its capabilities is
  -- worse than none.
  insert into public.resource_capability_assignments
    (organization_id, resource_id, capability_id, created_by)
  select p_organization_id, v_id, capability_id, v_actor
    from (select distinct unnest(coalesce(p_capability_ids, '{}'::uuid[])) as capability_id) wanted;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'resource', v_id, 'resource.created',
     jsonb_build_object(
       'name', p_name,
       'resource_class', p_resource_class,
       'membership_id', p_membership_id,
       'capability_ids', coalesce(p_capability_ids, '{}'::uuid[])
     ));

  return v_id;
end;
$fn$;

revoke all on function public.create_resource(uuid, text, text, jsonb, uuid, uuid[]) from public;
grant execute on function public.create_resource(uuid, text, text, jsonb, uuid, uuid[]) to authenticated;

-- `resources_update` (resource.update), the column grant and `resources_member_is_person` decide.
create function public.set_resource_class(p_resource_id uuid, p_resource_class text)
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
    raise exception 'set_resource_class requires an authenticated caller'
      using errcode = '42501';
  end if;

  if p_resource_class is null then
    raise exception 'a resource must say what kind of resource it is'
      using errcode = '23502';
  end if;

  update public.resources
     set resource_class = p_resource_class
   where id = p_resource_id
  returning organization_id into v_org;

  if v_org is null then
    raise exception 'no such resource, or you may not change it'
      using errcode = '42501';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'resource', p_resource_id, 'resource.class_changed',
     jsonb_build_object('resource_class', p_resource_class));
end;
$fn$;

revoke all on function public.set_resource_class(uuid, text) from public;
grant execute on function public.set_resource_class(uuid, text) to authenticated;

create function public.assign_resource_capability(p_resource_id uuid, p_capability_id uuid)
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
    raise exception 'assign_resource_capability requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- The organization comes from the resource the caller can already see, never from an argument.
  select r.organization_id into v_org from public.resources r where r.id = p_resource_id;
  if v_org is null then
    raise exception 'no such resource, or you may not change it'
      using errcode = '42501';
  end if;

  insert into public.resource_capability_assignments
    (organization_id, resource_id, capability_id, created_by)
  values (v_org, p_resource_id, p_capability_id, v_actor);

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'resource', p_resource_id, 'resource.capability_assigned',
     jsonb_build_object('capability_id', p_capability_id));
end;
$fn$;

revoke all on function public.assign_resource_capability(uuid, uuid) from public;
grant execute on function public.assign_resource_capability(uuid, uuid) to authenticated;

create function public.remove_resource_capability(p_resource_id uuid, p_capability_id uuid)
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
    raise exception 'remove_resource_capability requires an authenticated caller'
      using errcode = '42501';
  end if;

  delete from public.resource_capability_assignments
   where resource_id = p_resource_id
     and capability_id = p_capability_id
  returning organization_id into v_org;

  -- A policy-refused or absent row deletes nothing and raises nothing; without this the event
  -- below would record a removal that never happened.
  if v_org is null then
    raise exception 'that resource does not have that capability, or you may not change it'
      using errcode = '42501';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'resource', p_resource_id, 'resource.capability_removed',
     jsonb_build_object('capability_id', p_capability_id));
end;
$fn$;

revoke all on function public.remove_resource_capability(uuid, uuid) from public;
grant execute on function public.remove_resource_capability(uuid, uuid) to authenticated;
