-- Roles as per-tenant data, and capabilities as the thing authorization actually checks.
--
-- Until now `memberships.role` was a bare string nothing read, so I12 meant only "is there
-- an actor". This migration makes it mean "may this actor", and puts the check in RLS rather
-- than only in the domain layer -- a capability enforced solely in TypeScript is a capability
-- an unattended RPC call ignores.
--
-- The split that matters:
--   * WHICH capabilities exist is platform vocabulary. Each one names an operation the code
--     actually performs, so adding one is a migration, deliberately. A capability with no
--     code behind it is a lie the UI tells an operator.
--   * WHICH role holds which capability, and what that role is CALLED, is tenant data (D6).
--     A Postgres enum here would mean a deploy every time a customer renames "Owner".

-- ---------------------------------------------------------------------------
-- roles
-- ---------------------------------------------------------------------------

create table public.roles (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  name            text        not null check (length(btrim(name)) between 1 and 64),
  capabilities    text[]      not null default '{}',
  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),

  -- `<@` is "contained by". Unknown capability strings are rejected rather than stored and
  -- silently ignored, which is the failure mode where an operator believes a role grants
  -- something it does not.
  constraint roles_capabilities_known
    check (capabilities <@ array['customer.create', 'role.manage']::text[])
);

-- I2: tenant id leads.
create unique index roles_org_name_unique
  on public.roles (organization_id, lower(name));

-- Not redundant with the primary key: it is the target of the composite foreign key below,
-- which is what makes "a membership's role belongs to the same organization" a database
-- guarantee rather than something every caller has to remember to check. Leads with
-- organization_id, as I2 requires.
alter table public.roles
  add constraint roles_org_id_unique unique (organization_id, id);

-- ---------------------------------------------------------------------------
-- memberships.role text -> memberships.role_id
-- ---------------------------------------------------------------------------

-- One role row per distinct role name already in use, owned by whoever created the
-- organization. Existing rows were all creators, so they get every capability.
insert into public.roles (organization_id, name, capabilities, created_by)
select distinct m.organization_id,
       m.role,
       array['customer.create', 'role.manage']::text[],
       o.created_by
  from public.memberships m
  join public.organizations o on o.id = m.organization_id;

alter table public.memberships add column role_id uuid;

update public.memberships m
   set role_id = r.id
  from public.roles r
 where r.organization_id = m.organization_id
   and r.name = m.role;

alter table public.memberships alter column role_id set not null;

-- The composite reference, not a plain one to roles(id): it makes it impossible to point a
-- membership at another tenant's role, without any caller checking for it.
alter table public.memberships
  add constraint memberships_role_same_org
  foreign key (organization_id, role_id)
  references public.roles (organization_id, id);

alter table public.memberships drop column role;

-- ---------------------------------------------------------------------------
-- The capability question
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER for the same reason as app.current_tenant_ids(): policies on memberships
-- and roles cannot select from those tables without recursing. This is the only place that
-- answers "may the caller do this here".
create function app.has_capability(p_organization_id uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
      from public.memberships m
      join public.roles r on r.id = m.role_id
     where m.user_id = (select auth.uid())
       and m.organization_id = p_organization_id
       and p_capability = any (r.capabilities)
  );
$fn$;

revoke all on function app.has_capability(uuid, text) from public;
grant execute on function app.has_capability(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.roles enable row level security;
alter table public.roles force row level security;

-- Any member may see the roles of their own organization: you cannot reason about who can
-- do what without seeing the list. Creating one needs the capability.
create policy roles_select on public.roles
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy roles_insert on public.roles
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'role.manage')
  );

-- Reassigning a member's role is the other half of managing roles.
create policy memberships_update on public.memberships
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'role.manage')
  )
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'role.manage')
  );

-- Creating a customer now requires the capability, not merely membership. The previous
-- policy is replaced rather than amended so the whole rule reads in one place.
drop policy customers_insert on public.customers;

create policy customers_insert on public.customers
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'customer.create')
  );

grant select, insert on public.roles to authenticated;
grant update (role_id) on public.memberships to authenticated;

-- ---------------------------------------------------------------------------
-- create_organization, now bootstrapping a role
-- ---------------------------------------------------------------------------

drop function public.create_organization(text, text);

-- The capability list is passed in rather than written here, for the same reason the role
-- name always was: what the founding role is called and what it may do are the domain
-- layer's decisions, and eventually the tenant's.
create function public.create_organization(
  p_name         text,
  p_role         text,
  p_capabilities text[]
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

  insert into public.organizations (name, created_by)
  values (p_name, v_actor)
  returning id into v_org;

  insert into public.roles (organization_id, name, capabilities, created_by)
  values (v_org, p_role, p_capabilities, v_actor)
  returning id into v_role;

  insert into public.memberships (organization_id, user_id, role_id, created_by)
  values (v_org, v_actor, v_role, v_actor);

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'organization', v_org, 'organization.created',
     jsonb_build_object('name', p_name, 'role', p_role));

  return v_org;
end;
$fn$;

revoke all on function public.create_organization(text, text, text[]) from public;
grant execute on function public.create_organization(text, text, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Managing roles
-- ---------------------------------------------------------------------------

-- SECURITY INVOKER: the caller is already a member, so roles_insert decides whether this is
-- allowed. Transaction boundary only, so a role cannot appear without the event recording
-- who created it.
create function public.create_role(
  p_organization_id uuid,
  p_name            text,
  p_capabilities    text[]
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
  insert into public.roles (organization_id, name, capabilities, created_by)
  values (p_organization_id, p_name, p_capabilities, v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'role', v_id, 'role.created',
     jsonb_build_object('name', p_name, 'capabilities', p_capabilities));

  return v_id;
end;
$fn$;

revoke all on function public.create_role(uuid, text, text[]) from public;
grant execute on function public.create_role(uuid, text, text[]) to authenticated;

create function public.assign_role(p_membership_id uuid, p_role_id uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
begin
  update public.memberships
     set role_id = p_role_id
   where id = p_membership_id
  returning organization_id into v_org;

  -- Null means the row was invisible or the update was refused. Both are the same answer to
  -- the caller, deliberately: distinguishing them would say whether the membership exists.
  if v_org is null then
    raise exception 'no such membership, or you may not change it'
      using errcode = '42501';
  end if;

  -- An invariant, not a workflow: an organization always retains someone who can manage
  -- roles. It spans rows, so no single-row constraint can see it; it lives here because
  -- this is the only statement that can break it, and raising rolls the whole thing back.
  if not exists (
    select 1
      from public.memberships m
      join public.roles r on r.id = m.role_id
     where m.organization_id = v_org
       and 'role.manage' = any (r.capabilities)
  ) then
    raise exception 'that would leave the organization with nobody who can manage roles'
      using errcode = '23514';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'membership', p_membership_id, 'membership.role_assigned',
     jsonb_build_object('role_id', p_role_id));
end;
$fn$;

revoke all on function public.assign_role(uuid, uuid) from public;
grant execute on function public.assign_role(uuid, uuid) to authenticated;
