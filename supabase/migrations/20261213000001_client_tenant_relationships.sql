create table public.client_tenant_relationships (
  organization_id uuid not null references public.organizations(id),
  id uuid not null default gen_random_uuid(),
  customer_id uuid not null,
  tenant_organization_id uuid not null references public.organizations(id),
  status text not null default 'active' check(status in ('active','ended')),
  origin text not null check(origin in ('proposal_handoff','existing_tenant_link')),
  originating_handoff_id uuid,
  authority_basis text not null check(length(btrim(authority_basis)) between 1 and 500),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  ended_at timestamptz,
  ended_by uuid references auth.users(id),
  primary key(organization_id,id),
  unique(organization_id,customer_id,id,tenant_organization_id),
  foreign key(organization_id,customer_id) references public.customers(organization_id,id),
  foreign key(organization_id,originating_handoff_id) references public.customer_proposal_handoffs(organization_id,id),
  check(organization_id <> tenant_organization_id),
  check((origin='proposal_handoff') = (originating_handoff_id is not null)),
  check((status='active' and ended_at is null and ended_by is null) or
        (status='ended' and ended_at is not null and ended_by is not null))
);
create unique index client_tenant_active on public.client_tenant_relationships(organization_id,customer_id,tenant_organization_id) where status='active';
create unique index client_tenant_handoff on public.client_tenant_relationships(organization_id,originating_handoff_id) where originating_handoff_id is not null;
create index client_tenant_target on public.client_tenant_relationships(tenant_organization_id,organization_id);
alter table public.client_tenant_relationships enable row level security;
alter table public.client_tenant_relationships force row level security;
revoke all on public.client_tenant_relationships from public,anon,authenticated;
grant select on public.client_tenant_relationships to authenticated;
create policy client_tenant_read on public.client_tenant_relationships for select to authenticated
using(organization_id in (select app.current_tenant_ids()));

create function app.record_handoff_relationship() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.client_tenant_relationships(organization_id,id,customer_id,tenant_organization_id,origin,originating_handoff_id,authority_basis,created_at,created_by)
  values(new.organization_id,new.id,new.customer_id,new.created_organization_id,'proposal_handoff',new.id,'Accepted proposal provisioning',new.created_at,new.created_by);
  return new;
end $$;
revoke all on function app.record_handoff_relationship() from public,anon,authenticated;
create trigger handoff_client_tenant_relationship after insert on public.customer_proposal_handoffs
for each row execute function app.record_handoff_relationship();

-- Only authoritative handoffs establish legacy links. Conflicts fail instead of being guessed away.
create function app.backfill_handoff_relationships() returns void
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.customer_proposal_handoffs h
    join public.client_tenant_relationships r on r.organization_id=h.organization_id and r.originating_handoff_id=h.id
    where (r.customer_id,r.tenant_organization_id) is distinct from (h.customer_id,h.created_organization_id)) then
    raise exception 'Conflicting handoff relationship provenance' using errcode='23514';
  end if;
  insert into public.client_tenant_relationships(organization_id,id,customer_id,tenant_organization_id,origin,originating_handoff_id,authority_basis,created_at,created_by)
  select h.organization_id,h.id,h.customer_id,h.created_organization_id,'proposal_handoff',h.id,'Accepted proposal provisioning',h.created_at,h.created_by
  from public.customer_proposal_handoffs h
  where not exists(select 1 from public.client_tenant_relationships r where r.organization_id=h.organization_id and r.originating_handoff_id=h.id)
  order by h.organization_id,h.created_at,h.id;
end $$;
revoke all on function app.backfill_handoff_relationships() from public,anon,authenticated;
select app.backfill_handoff_relationships();

create function public.link_existing_client_tenant(p_organization_id uuid,p_customer_id uuid,p_tenant_id uuid,p_authority_basis text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if auth.uid() is null or not app.has_capability(p_organization_id,'customer.update') or
    not exists(select 1 from public.customers where organization_id=p_organization_id and id=p_customer_id) then
    raise exception 'Customer management permission required' using errcode='42501';
  end if;
  -- The signed action approves both sides: staff authority alone cannot assert tenant consent.
  if not app.is_platform_staff() or not app.has_capability(p_tenant_id,'organization.manage') or
    not exists(select 1 from public.organizations where id=p_tenant_id) then
    raise exception 'Platform staff and receiving-tenant management authority required' using errcode='42501';
  end if;
  if p_authority_basis is null or length(btrim(p_authority_basis)) not between 10 and 460 then
    raise exception 'Record the verified basis for this association' using errcode='22023';
  end if;
  insert into public.client_tenant_relationships(organization_id,customer_id,tenant_organization_id,origin,authority_basis,created_by)
  values(p_organization_id,p_customer_id,p_tenant_id,'existing_tenant_link','Authenticated tenant-manager approval: ' || btrim(p_authority_basis),auth.uid()) returning id into v_id;
  insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload)
  values(p_organization_id,auth.uid(),'customer',p_customer_id,'client_tenant.linked',jsonb_build_object('relationshipId',v_id,'tenantId',p_tenant_id));
  return v_id;
end $$;
revoke all on function public.link_existing_client_tenant(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.link_existing_client_tenant(uuid,uuid,uuid,text) to authenticated;

create function public.existing_client_tenant_options(p_organization_id uuid,p_customer_id uuid,p_search text default '')
returns table(id uuid,name text) language sql stable security definer set search_path='' as $$
  select o.id,o.name from public.organizations o
  where o.id<>p_organization_id and o.id in(select app.current_tenant_ids())
    and app.is_platform_staff() and app.has_capability(p_organization_id,'customer.update')
    and app.has_capability(o.id,'organization.manage')
    and exists(select 1 from public.customers c where c.organization_id=p_organization_id and c.id=p_customer_id)
    and o.name ilike '%' || left(p_search,100) || '%'
  order by o.created_at desc,o.id limit 100;
$$;
revoke all on function public.existing_client_tenant_options(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.existing_client_tenant_options(uuid,uuid,text) to authenticated;

create function public.end_client_tenant_relationship(p_organization_id uuid,p_relationship_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_customer uuid;
begin
  if auth.uid() is null or not app.has_capability(p_organization_id,'customer.update') then
    raise exception 'Customer management permission required' using errcode='42501';
  end if;
  select customer_id into v_customer from public.client_tenant_relationships
  where organization_id=p_organization_id and id=p_relationship_id for update;
  if not found then raise exception 'Relationship unavailable' using errcode='42501'; end if;
  update public.client_tenant_relationships set status='ended',ended_at=now(),ended_by=auth.uid()
  where organization_id=p_organization_id and id=p_relationship_id and status='active';
  if found then
    insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload)
    values(p_organization_id,auth.uid(),'customer',v_customer,'client_tenant.ended',jsonb_build_object('relationshipId',p_relationship_id));
  end if;
end $$;
revoke all on function public.end_client_tenant_relationship(uuid,uuid) from public,anon,authenticated;
grant execute on function public.end_client_tenant_relationship(uuid,uuid) to authenticated;

-- Identity and lifecycle only, for known linked tenants; no private tenant content.
create function public.client_tenant_summaries(p_organization_id uuid,p_customer_id uuid)
returns table(id uuid,customer_id uuid,tenant_organization_id uuid,status text,origin text,created_at timestamptz,ended_at timestamptz,tenant_name text,operational_state text,may_open boolean)
language sql stable security definer set search_path='' as $$
  select r.id,r.customer_id,r.tenant_organization_id,r.status,r.origin,r.created_at,r.ended_at,o.name,o.operational_state,
    o.id in(select app.current_tenant_ids())
  from public.client_tenant_relationships r join public.organizations o on o.id=r.tenant_organization_id
  where r.organization_id=p_organization_id and r.customer_id=p_customer_id
    and p_organization_id in(select app.current_tenant_ids()) order by r.created_at,r.id;
$$;
revoke all on function public.client_tenant_summaries(uuid,uuid) from public,anon,authenticated;
grant execute on function public.client_tenant_summaries(uuid,uuid) to authenticated;
