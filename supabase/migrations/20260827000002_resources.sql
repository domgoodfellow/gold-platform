-- Resource: the thing a Work Item consumes for a window of time.
--
-- "Scheduling and dispatch both operate on Resources; this is what keeps them one engine
-- rather than two" (domain-model.md). Nothing schedules yet, so what lands here is the
-- record of what a business has to schedule *with* -- technicians, vans, machines -- and
-- nothing else.
--
-- Two absences are deliberate and will look like omissions, so they are recorded here.
--
--   * There is no `kind` column. The domain model says a resource is "a person, vehicle, or
--     piece of equipment", and that is a description of what the word covers, not a demand
--     for an enum. No code branches on it: a person and a van are both something a work item
--     occupies for a window. A tenant that wants to group its resources has field
--     definitions for exactly that (D7). When scheduling genuinely needs to treat a person
--     differently from a machine -- shifts, working hours, fatigue -- that is the change that
--     adds the column, with the code that reads it.
--
--   * There is no `active` flag. Retiring a resource matters only once something can be
--     scheduled against it, because the point of the flag is to keep history while removing
--     it from future availability. Availability does not exist. A column nothing reads is a
--     column that will be maintained, migrated, and eventually misinterpreted.
--
-- There is also no unique index on name, and that is not an oversight either: two employees
-- called John Smith is ordinary, and a business with two vans both labelled "Van 1" has a
-- data entry problem that a constraint would turn into an unexplained 23505.

create table public.resources (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  name            text        not null check (length(btrim(name)) between 1 and 200),
  custom          jsonb       not null default '{}'::jsonb
                              check (jsonb_typeof(custom) = 'object'),
  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id)
);

comment on table public.resources is
  'A person, vehicle or piece of equipment a work item occupies for a window. See domain-model.md.';

create index resources_org_created_at_idx
  on public.resources (organization_id, created_at desc);

-- The target of the composite foreign key that `work_items` will need in order to satisfy
-- I18. Written now because the constraint it supports is one migration away and adding a
-- unique constraint to a populated table is the expensive direction.
alter table public.resources
  add constraint resources_org_id_unique unique (organization_id, id);

alter table public.resources enable row level security;
alter table public.resources force row level security;

create policy resources_select on public.resources
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy resources_insert on public.resources
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'resource.create')
  );

-- No update or delete policy: neither has a caller in this change.

grant select, insert on public.resources to authenticated;

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
    'resource.create'
  ]::text[]);

-- Same reasoning as location.create: whoever records the work records what it is done with.
update public.roles
   set capabilities = capabilities || array['resource.create']::text[]
 where 'customer.create' = any (capabilities)
   and not ('resource.create' = any (capabilities));

-- ---------------------------------------------------------------------------
-- Custom fields on resources
-- ---------------------------------------------------------------------------

-- The third entity type, and still one function. This is what taking the entity type as a
-- trigger argument bought: registration costs two statements rather than a copied validator.
alter table public.field_definitions drop constraint field_definitions_entity_type_check;

alter table public.field_definitions
  add constraint field_definitions_entity_type_check
  check (entity_type in ('customer', 'location', 'resource'));

create trigger resources_custom_conforms
  before insert or update of custom, organization_id on public.resources
  for each row execute function app.check_custom_fields('resource');

-- ---------------------------------------------------------------------------
-- Creation as one transaction
-- ---------------------------------------------------------------------------

create function public.create_resource(
  p_organization_id uuid,
  p_name            text,
  p_custom          jsonb
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

  insert into public.resources (organization_id, name, custom, created_by)
  values (p_organization_id, p_name, coalesce(p_custom, '{}'::jsonb), v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'resource', v_id, 'resource.created',
     jsonb_build_object('name', p_name));

  return v_id;
end;
$fn$;

revoke all on function public.create_resource(uuid, text, jsonb) from public;
grant execute on function public.create_resource(uuid, text, jsonb) to authenticated;
