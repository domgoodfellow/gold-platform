-- Tenancy kernel: organizations, memberships, events, and the one tenant resolution function.
--
-- Why this migration is shaped this way (see docs/constraints.md D4, and I1-I3, I11):
--   * `organizations` IS the tenant, so it carries no `tenant_id` -- its `id` is the tenant
--     id. Every OTHER table here carries `organization_id` and is RLS-keyed to it.
--   * Tenant identity resolves through exactly ONE function, `app.current_tenant_ids()`. It
--     returns a SET, never a single id. That is what makes Standard and Private deployments
--     the same code: a Private deployment is a database where the set happens to have one
--     element, not a different code path.
--   * Nothing here reads a tenant id supplied by the application. RLS is the boundary; an
--     application-layer filter is only an optimisation.

create schema if not exists app;
grant usage on schema app to authenticated;

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------

create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null check (length(btrim(name)) between 1 and 200),
  created_at  timestamptz not null default now(),
  -- I11: consequential writes are attributable. An organization cannot exist without a
  -- record of who brought it into existence.
  created_by  uuid        not null references auth.users (id)
);

comment on table public.organizations is
  'The tenant. Its id is the tenant id; a Private deployment is this table with one row.';

-- ---------------------------------------------------------------------------
-- memberships
-- ---------------------------------------------------------------------------

create table public.memberships (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  user_id         uuid        not null references auth.users (id) on delete cascade,
  -- Roles are per-tenant DATA, not an enum (D6). A Postgres enum means a migration and a
  -- deploy every time a customer renames a role. This column stores the tenant's own word;
  -- what that word is allowed to do is the domain layer's business, not the type system's.
  role            text        not null check (length(btrim(role)) between 1 and 64),
  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id)
);

-- I2: the unique index LEADS with the tenant id. Written (organization_id, user_id) and
-- never (user_id, organization_id). The ordering is the entire point of the rule, and
-- getting it backwards is the specific thing that broke in a prior repo.
create unique index memberships_org_user_unique
  on public.memberships (organization_id, user_id);

-- ---------------------------------------------------------------------------
-- events  (append-only)
-- ---------------------------------------------------------------------------

-- Ships in the first slice that writes state, because it cannot be backfilled. One table
-- serves the customer timeline, automation triggers, reporting, and AI context.
create table public.events (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  actor_id        uuid        not null references auth.users (id),
  entity_type     text        not null,
  entity_id       uuid        not null,
  action          text        not null,
  payload         jsonb       not null default '{}'::jsonb,
  occurred_at     timestamptz not null default now()
);

-- I2 again: tenant id leads every index on a tenant-owned table.
create index events_org_occurred_at_idx
  on public.events (organization_id, occurred_at desc);
create index events_org_entity_idx
  on public.events (organization_id, entity_type, entity_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- The one tenant resolution function (I3)
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER on purpose: an RLS policy on `memberships` that itself selects from
-- `memberships` recurses. This function is the designated break in that cycle, and it is the
-- ONLY place that answers "which tenants is the caller in". search_path is pinned empty and
-- every name is fully qualified, so nothing here can be shadowed by a caller's search_path.
create function app.current_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select m.organization_id
  from public.memberships m
  where m.user_id = (select auth.uid());
$fn$;

revoke all on function app.current_tenant_ids() from public;
grant execute on function app.current_tenant_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- RLS (I1)
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.memberships   enable row level security;
alter table public.events        enable row level security;

-- FORCE so that the table owner is not silently exempt.
alter table public.organizations force row level security;
alter table public.memberships   force row level security;
alter table public.events        force row level security;

-- Read: membership, and nothing else. There is deliberately no "or created_by = auth.uid()"
-- escape hatch. That would be a second authorization path, and it would outlive a transfer
-- of ownership. Bootstrapping is handled by public.create_organization() instead.
create policy organizations_select on public.organizations
  for select to authenticated
  using (id in (select app.current_tenant_ids()));

create policy memberships_select on public.memberships
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy events_select on public.events
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- Append-only: an insert policy and no update or delete policy. RLS default-denies whatever
-- has no policy, so history cannot be rewritten through the API at all.
create policy events_insert on public.events
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and actor_id = (select auth.uid())
  );

-- No insert, update, or delete policy on organizations or memberships. The only write that
-- exists today goes through the function below. Writes that do not exist yet get a policy in
-- the slice that needs one, never in anticipation.

-- ---------------------------------------------------------------------------
-- Bootstrap
-- ---------------------------------------------------------------------------

-- The chicken and egg: you cannot be a member of an organization that does not exist, and
-- RLS will not let you insert into one you are not a member of. This function is the narrow
-- privileged operation that resolves it, and it is a TRANSACTION BOUNDARY rather than a
-- workflow -- three inserts and one guard, no branching, no decision of its own. The role
-- string is passed in rather than chosen here, because what the creator is called is the
-- domain layer's decision and eventually the tenant's.
--
-- It lives in `public` rather than `app` because PostgREST only exposes `public`, and this
-- is the API. `app` holds what only the policies call, and stays unreachable from a client.
create function public.create_organization(p_name text, p_role text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
begin
  if v_actor is null then
    raise exception 'create_organization requires an authenticated caller'
      using errcode = '42501';
  end if;

  insert into public.organizations (name, created_by)
  values (p_name, v_actor)
  returning id into v_org;

  insert into public.memberships (organization_id, user_id, role, created_by)
  values (v_org, v_actor, p_role, v_actor);

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'organization', v_org, 'organization.created',
     jsonb_build_object('name', p_name, 'role', p_role));

  return v_org;
end;
$fn$;

revoke all on function public.create_organization(text, text) from public;
grant execute on function public.create_organization(text, text) to authenticated;

grant select on public.organizations, public.memberships, public.events to authenticated;
grant insert on public.events to authenticated;
