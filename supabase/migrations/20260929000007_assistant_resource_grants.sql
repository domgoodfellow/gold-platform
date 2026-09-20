-- Connected is not permitted. A connection says a business has authorized an outside app; it does
-- not say GOLD's assistant may read anything inside it. This table is the second, separate
-- decision: a person with integration.manage names each *resource* the assistant may read.
--
-- **Absence is the default.** A connection with no row here is invisible to the assistant, and a
-- new resource discovered by a re-sync is invisible until somebody grants it. A grant on the
-- connection as a whole would make "connected" mean "everything, including what a sync finds
-- tomorrow"; a grant per resource cannot.
--
-- Read is the only access there is, so there is no access column: a write grant arrives with the
-- first tool that writes, and asks the person again. The grantee is GOLD's one assistant; a
-- second kind of agent adds a column when it exists.
--
-- No assistant tool consumes this yet. What exists is the enforcement point they must call —
-- `public.assistant_may_read_resource` — so the first one cannot skip the question.

create table public.assistant_resource_grants (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  resource_id     uuid        not null,
  granted_by      uuid        not null references auth.users (id),
  created_at      timestamptz not null default now(),

  -- Leading with the tenant (I2). One grant per resource: a second would be a second answer.
  unique (organization_id, resource_id),
  foreign key (organization_id, resource_id)
    references public.integration_resources (organization_id, id) on delete cascade
);

comment on table public.assistant_resource_grants is
  'Resources GOLD''s assistant may read. A connection alone grants nothing; absence is the default, and a resource a later sync discovers starts ungranted.';

alter table public.assistant_resource_grants enable row level security;
alter table public.assistant_resource_grants force  row level security;

create policy assistant_resource_grants_select on public.assistant_resource_grants
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy assistant_resource_grants_insert on public.assistant_resource_grants
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and granted_by = (select auth.uid())
    and app.has_capability(organization_id, 'integration.manage')
  );

create policy assistant_resource_grants_delete on public.assistant_resource_grants
  for delete to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'integration.manage'));

-- No update: a grant is either there or not. Column-level insert, so a later column is never
-- writable by a caller by accident (the table-wide-grant rule).
grant select, delete on public.assistant_resource_grants to authenticated;
grant insert (organization_id, resource_id, granted_by) on public.assistant_resource_grants to authenticated;

-- The one question an assistant tool asks before it touches an outside app. A grant is honoured
-- only while the resource and its connection are both live, so disconnecting or disabling ends
-- the assistant's reach without anybody having to delete a row.
create function public.assistant_may_read_resource(p_organization_id uuid, p_resource_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
      from public.assistant_resource_grants g
      join public.integration_resources r on r.organization_id = g.organization_id and r.id = g.resource_id
      join public.integration_connections c on c.organization_id = r.organization_id and c.id = r.connection_id
     where g.organization_id = p_organization_id
       and g.resource_id = p_resource_id
       and r.status = 'active'
       and c.status = 'active'
  );
$$;

comment on function public.assistant_may_read_resource(uuid, uuid) is
  'Whether the assistant may read one resource: granted, and both the resource and its connection are active. Runs under the caller''s rights, so it answers only for a tenant the caller belongs to.';

revoke all on function public.assistant_may_read_resource(uuid, uuid) from public, anon;
grant execute on function public.assistant_may_read_resource(uuid, uuid) to authenticated;
