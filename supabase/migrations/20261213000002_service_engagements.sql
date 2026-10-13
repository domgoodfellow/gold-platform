create table public.service_engagements (
  organization_id uuid not null references public.organizations(id),
  id uuid not null default gen_random_uuid(),
  customer_id uuid not null,
  relationship_id uuid,
  tenant_organization_id uuid,
  name text not null check(length(btrim(name)) between 1 and 200),
  service_kind text not null check(service_kind in ('website','ai','automation','integration','implementation','managed_operations')),
  status text not null default 'planned' check(status in ('planned','active','completed','cancelled')),
  opportunity_id uuid,
  proposal_id uuid,
  accepted_terms jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  primary key(organization_id,id),
  unique(organization_id,id,tenant_organization_id),
  foreign key(organization_id,customer_id) references public.customers(organization_id,id),
  foreign key(organization_id,customer_id,relationship_id,tenant_organization_id)
    references public.client_tenant_relationships(organization_id,customer_id,id,tenant_organization_id),
  foreign key(organization_id,customer_id,opportunity_id) references public.opportunities(organization_id,customer_id,id),
  foreign key(organization_id,proposal_id) references public.customer_commercial_proposals(organization_id,id),
  check((relationship_id is null) = (tenant_organization_id is null)),
  check((proposal_id is null) = (accepted_terms is null)),
  check((status='completed') = (completed_at is not null)),
  check((status='cancelled') = (ended_at is not null))
);
create index engagement_customer on public.service_engagements(organization_id,customer_id,created_at);
create index engagement_relationship on public.service_engagements(organization_id,relationship_id);
alter table public.service_engagements enable row level security;
alter table public.service_engagements force row level security;
revoke all on public.service_engagements from public,anon,authenticated;
grant select on public.service_engagements to authenticated;
create policy engagement_read on public.service_engagements for select to authenticated
using(organization_id in(select app.current_tenant_ids()));

create table public.engagement_deliverables (
  organization_id uuid not null,
  id uuid not null default gen_random_uuid(),
  engagement_id uuid not null,
  tenant_organization_id uuid not null,
  site_id uuid,
  form_id uuid,
  ai_deployment_id uuid,
  automation_rule_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  primary key(organization_id,id),
  foreign key(organization_id,engagement_id,tenant_organization_id) references public.service_engagements(organization_id,id,tenant_organization_id),
  foreign key(tenant_organization_id,site_id) references public.public_sites(organization_id,id),
  foreign key(tenant_organization_id,form_id) references public.forms(organization_id,id),
  foreign key(tenant_organization_id,ai_deployment_id) references public.ai_assistant_deployments(organization_id,id),
  foreign key(tenant_organization_id,automation_rule_id) references public.automation_rules(organization_id,id),
  check(num_nonnulls(site_id,form_id,ai_deployment_id,automation_rule_id)=1)
);
create index deliverable_engagement on public.engagement_deliverables(organization_id,engagement_id);
create index deliverable_target_site on public.engagement_deliverables(tenant_organization_id,site_id) where site_id is not null;
create index deliverable_target_form on public.engagement_deliverables(tenant_organization_id,form_id) where form_id is not null;
create index deliverable_target_ai on public.engagement_deliverables(tenant_organization_id,ai_deployment_id) where ai_deployment_id is not null;
create index deliverable_target_automation on public.engagement_deliverables(tenant_organization_id,automation_rule_id) where automation_rule_id is not null;
create unique index deliverable_site on public.engagement_deliverables(organization_id,engagement_id,site_id) where site_id is not null;
create unique index deliverable_form on public.engagement_deliverables(organization_id,engagement_id,form_id) where form_id is not null;
create unique index deliverable_ai on public.engagement_deliverables(organization_id,engagement_id,ai_deployment_id) where ai_deployment_id is not null;
create unique index deliverable_automation on public.engagement_deliverables(organization_id,engagement_id,automation_rule_id) where automation_rule_id is not null;
alter table public.engagement_deliverables enable row level security;
alter table public.engagement_deliverables force row level security;
revoke all on public.engagement_deliverables from public,anon,authenticated;
grant select on public.engagement_deliverables to authenticated;
create policy deliverable_read on public.engagement_deliverables for select to authenticated
using(organization_id in(select app.current_tenant_ids()));

create table public.engagement_work_items (
  organization_id uuid not null,
  engagement_id uuid not null,
  work_item_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  primary key(organization_id,engagement_id,work_item_id),
  foreign key(organization_id,engagement_id) references public.service_engagements(organization_id,id),
  foreign key(organization_id,work_item_id) references public.work_items(organization_id,id)
);
alter table public.engagement_work_items enable row level security;
create index engagement_work_target on public.engagement_work_items(organization_id,work_item_id);
alter table public.engagement_work_items force row level security;
revoke all on public.engagement_work_items from public,anon,authenticated;
grant select on public.engagement_work_items to authenticated;
create policy engagement_work_read on public.engagement_work_items for select to authenticated
using(organization_id in(select app.current_tenant_ids()));

create function public.create_service_engagement(p_organization_id uuid,p_customer_id uuid,p_name text,p_service_kind text,
  p_relationship_id uuid default null,p_opportunity_id uuid default null,p_proposal_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_tenant uuid; v_terms jsonb;
begin
  if auth.uid() is null or not app.has_capability(p_organization_id,'customer.update') or
    not exists(select 1 from public.customers where organization_id=p_organization_id and id=p_customer_id) then
    raise exception 'Customer management permission required' using errcode='42501';
  end if;
  if p_relationship_id is not null then
    select tenant_organization_id into v_tenant from public.client_tenant_relationships
    where organization_id=p_organization_id and customer_id=p_customer_id and id=p_relationship_id and status='active' for update;
    if not found then raise exception 'Active customer relationship required' using errcode='42501'; end if;
  end if;
  if p_opportunity_id is not null and not exists(select 1 from public.opportunities where organization_id=p_organization_id and customer_id=p_customer_id and id=p_opportunity_id) then
    raise exception 'Customer opportunity unavailable' using errcode='42501';
  end if;
  if p_proposal_id is not null then
    select jsonb_build_object('planId',p.plan_id,'planLabel',p.plan_label,'currency',p.currency,'billingInterval',p.billing_interval,
      'planPriceMinor',p.plan_price_minor,'addonPriceMinor',p.addon_price_minor,'discountMinor',p.discount_minor,'discountReason',p.discount_reason,
      'version',p.version,'acceptedAt',p.accepted_at,'configuration',p.accepted_configuration,
      'addons',(select coalesce(jsonb_agg(jsonb_build_object('addonPlanId',a.addon_plan_id,'label',a.label,'priceMinor',a.price_minor)),'[]')
        from public.customer_commercial_proposal_addons a where a.organization_id=p.organization_id and a.proposal_id=p.id))
    into v_terms from public.customer_commercial_proposals p
    where p.organization_id=p_organization_id and p.customer_id=p_customer_id and p.id=p_proposal_id and p.status='accepted';
    if not found then raise exception 'Accepted customer proposal required' using errcode='42501'; end if;
  end if;
  insert into public.service_engagements(organization_id,customer_id,relationship_id,tenant_organization_id,name,service_kind,opportunity_id,proposal_id,accepted_terms,created_by,updated_by)
  values(p_organization_id,p_customer_id,p_relationship_id,v_tenant,btrim(p_name),p_service_kind,p_opportunity_id,p_proposal_id,v_terms,auth.uid(),auth.uid()) returning id into v_id;
  insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload)
  values(p_organization_id,auth.uid(),'customer',p_customer_id,'service_engagement.created',jsonb_build_object('engagementId',v_id));
  return v_id;
end $$;
revoke all on function public.create_service_engagement(uuid,uuid,text,text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_service_engagement(uuid,uuid,text,text,uuid,uuid,uuid) to authenticated;

create function public.bind_service_engagement_tenant(p_organization_id uuid,p_engagement_id uuid,p_relationship_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_engagement public.service_engagements; v_tenant uuid;
begin
  if auth.uid() is null or not app.has_capability(p_organization_id,'customer.update') then
    raise exception 'Customer management permission required' using errcode='42501'; end if;
  select * into v_engagement from public.service_engagements where organization_id=p_organization_id and id=p_engagement_id for update;
  if not found or v_engagement.status not in ('planned','active') or v_engagement.relationship_id is not null then
    raise exception 'An open engagement without a tenant is required' using errcode='42501'; end if;
  select tenant_organization_id into v_tenant from public.client_tenant_relationships
  where organization_id=p_organization_id and customer_id=v_engagement.customer_id and id=p_relationship_id and status='active' for update;
  if not found then raise exception 'Active customer relationship required' using errcode='42501'; end if;
  update public.service_engagements set relationship_id=p_relationship_id,tenant_organization_id=v_tenant,updated_at=now(),updated_by=auth.uid()
  where organization_id=p_organization_id and id=p_engagement_id;
  insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload)
  values(p_organization_id,auth.uid(),'customer',v_engagement.customer_id,'service_engagement.tenant_bound',jsonb_build_object('engagementId',p_engagement_id,'relationshipId',p_relationship_id));
end $$;
revoke all on function public.bind_service_engagement_tenant(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.bind_service_engagement_tenant(uuid,uuid,uuid) to authenticated;

create function public.transition_service_engagement(p_organization_id uuid,p_engagement_id uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $$
declare v_engagement public.service_engagements;
begin
  if auth.uid() is null or not app.has_capability(p_organization_id,'customer.update') then
    raise exception 'Customer management permission required' using errcode='42501'; end if;
  select * into v_engagement from public.service_engagements where organization_id=p_organization_id and id=p_engagement_id for update;
  if not found then raise exception 'Engagement unavailable' using errcode='42501'; end if;
  if v_engagement.status=p_status then return; end if;
  if v_engagement.status in ('completed','cancelled') or p_status not in ('active','completed','cancelled') or p_status is null then
    raise exception 'Invalid engagement transition' using errcode='22023'; end if;
  update public.service_engagements set status=p_status,updated_at=now(),updated_by=auth.uid(),
    started_at=case when p_status='active' then coalesce(started_at,now()) else started_at end,
    completed_at=case when p_status='completed' then now() end,ended_at=case when p_status='cancelled' then now() end
  where organization_id=p_organization_id and id=p_engagement_id;
  insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload)
  values(p_organization_id,auth.uid(),'customer',v_engagement.customer_id,'service_engagement.status_changed',jsonb_build_object('engagementId',p_engagement_id,'from',v_engagement.status,'to',p_status));
end $$;
revoke all on function public.transition_service_engagement(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.transition_service_engagement(uuid,uuid,text) to authenticated;

-- The service relationship never authorizes artifact reads. Membership and the owning
-- domain's permissions are checked afresh, including for platform staff.
create function app.service_artifact_summaries(p_tenant uuid)
returns table(kind text,id uuid,label text,artifact_status text)
language sql stable security definer set search_path='' as $$
  select 'website',s.id,'Website',case when s.current_published_revision_id is null then 'Unpublished' else 'Published' end
  from public.public_sites s where s.organization_id=p_tenant and p_tenant in(select app.current_tenant_ids()) and app.has_capability(p_tenant,'organization.manage')
  union all
  select 'form',f.id,f.name,case when f.archived_at is not null then 'Archived' when f.current_published_revision_id is null then 'Unpublished' else 'Published' end
  from public.forms f where f.organization_id=p_tenant and p_tenant in(select app.current_tenant_ids()) and app.has_capability(p_tenant,'organization.manage')
  union all
  select 'ai_deployment',d.id,d.display_name,
    case when d.enabled then 'Enabled configuration · runtime not verified' else 'Disabled configuration' end
  from public.ai_assistant_deployments d where d.organization_id=p_tenant and p_tenant in(select app.current_tenant_ids()) and app.has_capability(p_tenant,'organization.manage')
  union all
  select 'automation',a.id,a.name,case when a.enabled then 'Enabled' else 'Disabled' end
  from public.automation_rules a where a.organization_id=p_tenant and p_tenant in(select app.current_tenant_ids()) and app.module_enabled(p_tenant,'automations');
$$;
revoke all on function app.service_artifact_summaries(uuid) from public,anon,authenticated;

create function public.service_deliverable_options(p_organization_id uuid,p_engagement_id uuid,p_search text default '')
returns table(kind text,id uuid,label text,artifact_status text)
language sql stable security definer set search_path='' as $$
  select a.* from public.service_engagements e
  join public.client_tenant_relationships r on r.organization_id=e.organization_id and r.id=e.relationship_id and r.status='active'
  cross join lateral app.service_artifact_summaries(e.tenant_organization_id) a
  where e.organization_id=p_organization_id and e.id=p_engagement_id and e.status in ('planned','active')
    and app.has_capability(p_organization_id,'customer.update') and a.label ilike '%' || left(p_search,100) || '%'
  order by a.kind,a.label,a.id limit 100;
$$;
revoke all on function public.service_deliverable_options(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.service_deliverable_options(uuid,uuid,text) to authenticated;

create function public.attach_engagement_deliverable(p_organization_id uuid,p_engagement_id uuid,p_kind text,p_artifact_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_engagement public.service_engagements; v_id uuid;
begin
  if auth.uid() is null or not app.has_capability(p_organization_id,'customer.update') then
    raise exception 'Customer management permission required' using errcode='42501'; end if;
  select * into v_engagement from public.service_engagements where organization_id=p_organization_id and id=p_engagement_id for update;
  if not found or v_engagement.status not in ('planned','active') then raise exception 'Open engagement required' using errcode='42501'; end if;
  perform 1 from public.client_tenant_relationships where organization_id=p_organization_id and id=v_engagement.relationship_id and status='active' for update;
  if not found then raise exception 'Active customer relationship required' using errcode='42501'; end if;
  if not exists(select 1 from app.service_artifact_summaries(v_engagement.tenant_organization_id) where kind=p_kind and id=p_artifact_id) then
    raise exception 'Authorized tenant artifact unavailable' using errcode='42501'; end if;
  insert into public.engagement_deliverables(organization_id,engagement_id,tenant_organization_id,site_id,form_id,ai_deployment_id,automation_rule_id,created_by)
  values(p_organization_id,p_engagement_id,v_engagement.tenant_organization_id,
    case when p_kind='website' then p_artifact_id end,case when p_kind='form' then p_artifact_id end,
    case when p_kind='ai_deployment' then p_artifact_id end,case when p_kind='automation' then p_artifact_id end,auth.uid()) returning id into v_id;
  insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload)
  values(p_organization_id,auth.uid(),'customer',v_engagement.customer_id,'service_engagement.deliverable_attached',jsonb_build_object('engagementId',p_engagement_id,'deliverableId',v_id,'kind',p_kind));
  return v_id;
end $$;
revoke all on function public.attach_engagement_deliverable(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.attach_engagement_deliverable(uuid,uuid,text,uuid) to authenticated;

create function public.engagement_deliverable_summaries(p_organization_id uuid,p_engagement_id uuid)
returns table(id uuid,kind text,artifact_id uuid,label text,artifact_status text,available boolean,tenant_organization_id uuid)
language sql stable security definer set search_path='' as $$
  select d.id,
    case when d.site_id is not null then 'website' when d.form_id is not null then 'form' when d.ai_deployment_id is not null then 'ai_deployment' else 'automation' end,
    coalesce(d.site_id,d.form_id,d.ai_deployment_id,d.automation_rule_id),
    coalesce(a.label,'Restricted artifact'),coalesce(a.artifact_status,case when r.status='ended' then 'Relationship ended' else 'Tenant access required' end),a.id is not null,d.tenant_organization_id
  from public.engagement_deliverables d join public.service_engagements e on e.organization_id=d.organization_id and e.id=d.engagement_id
  join public.client_tenant_relationships r on r.organization_id=e.organization_id and r.id=e.relationship_id
  left join lateral (select x.* from app.service_artifact_summaries(d.tenant_organization_id) x
    where r.status='active' and x.id=coalesce(d.site_id,d.form_id,d.ai_deployment_id,d.automation_rule_id)
      and x.kind=case when d.site_id is not null then 'website' when d.form_id is not null then 'form' when d.ai_deployment_id is not null then 'ai_deployment' else 'automation' end) a on true
  where d.organization_id=p_organization_id and d.engagement_id=p_engagement_id and p_organization_id in(select app.current_tenant_ids())
  order by d.created_at,d.id;
$$;
revoke all on function public.engagement_deliverable_summaries(uuid,uuid) from public,anon,authenticated;
grant execute on function public.engagement_deliverable_summaries(uuid,uuid) to authenticated;

create function public.attach_engagement_work(p_organization_id uuid,p_engagement_id uuid,p_work_item_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_customer uuid;
begin
  if auth.uid() is null or not app.has_capability(p_organization_id,'customer.update') then
    raise exception 'Customer management permission required' using errcode='42501'; end if;
  select customer_id into v_customer from public.service_engagements where organization_id=p_organization_id and id=p_engagement_id and status in ('planned','active') for update;
  if not found or not exists(select 1 from public.work_items where organization_id=p_organization_id and customer_id=v_customer and id=p_work_item_id) then
    raise exception 'Customer Work Item unavailable' using errcode='42501'; end if;
  insert into public.engagement_work_items(organization_id,engagement_id,work_item_id,created_by)
  values(p_organization_id,p_engagement_id,p_work_item_id,auth.uid());
  insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload)
  values(p_organization_id,auth.uid(),'customer',v_customer,'service_engagement.work_attached',jsonb_build_object('engagementId',p_engagement_id,'workItemId',p_work_item_id));
end $$;
revoke all on function public.attach_engagement_work(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.attach_engagement_work(uuid,uuid,uuid) to authenticated;
