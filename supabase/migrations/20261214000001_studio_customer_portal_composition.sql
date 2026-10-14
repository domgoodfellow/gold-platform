-- Studio owns composition; Portal identity and source-domain authorization are unchanged.
create function app.valid_portal_content(p_content jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare v_module jsonb;
begin
  if p_content is null or jsonb_typeof(p_content) <> 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(p_content)) <> 3 or
     jsonb_typeof(p_content->'title') is distinct from 'string' or
     length(btrim(p_content->>'title')) < 1 or length(p_content->>'title') > 100 or
     jsonb_typeof(p_content->'introduction') is distinct from 'string' or
     length(p_content->>'introduction') > 1000 or
     jsonb_typeof(p_content->'modules') is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_content->'modules') not between 1 and 4 then return false; end if;
  for v_module in select value from jsonb_array_elements(p_content->'modules') loop
    if jsonb_typeof(v_module) <> 'string' or v_module #>> '{}' not in ('work','invoices','forms','services') then return false; end if;
  end loop;
  return (select count(*) = count(distinct value) from jsonb_array_elements(p_content->'modules'));
end $$;
revoke all on function app.valid_portal_content(jsonb) from public,anon;

create table public.portal_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  draft_content jsonb not null check(app.valid_portal_content(draft_content)),
  draft_version integer not null default 1 check(draft_version > 0),
  published_revision_id uuid,
  revision_number integer not null default 0 check(revision_number >= 0),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  unique(organization_id), unique(organization_id,id)
);
create table public.portal_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  portal_id uuid not null,
  number integer not null check(number > 0),
  content jsonb not null check(app.valid_portal_content(content)),
  published_at timestamptz not null default now(),
  published_by uuid not null references auth.users(id),
  foreign key(organization_id,portal_id) references public.portal_definitions(organization_id,id),
  unique(organization_id,id), unique(organization_id,portal_id,number)
);
alter table public.portal_definitions add foreign key(organization_id,published_revision_id)
  references public.portal_revisions(organization_id,id);
alter table public.portal_definitions enable row level security;
alter table public.portal_definitions force row level security;
alter table public.portal_revisions enable row level security;
alter table public.portal_revisions force row level security;
revoke all on public.portal_definitions,public.portal_revisions from public,anon,authenticated;
grant select on public.portal_definitions,public.portal_revisions to authenticated;
create policy portal_definition_operator_read on public.portal_definitions for select to authenticated
  using(organization_id in(select app.current_tenant_ids()) and app.has_capability(organization_id,'organization.manage'));
create policy portal_revision_operator_read on public.portal_revisions for select to authenticated
  using(organization_id in(select app.current_tenant_ids()) and app.has_capability(organization_id,'organization.manage'));

create function public.save_portal_draft(p_organization_id uuid,p_expected_version integer,p_content jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_portal public.portal_definitions;
begin
  if auth.uid() is null or not app.has_capability(p_organization_id,'organization.manage') then
    raise exception 'Organization management required' using errcode='42501'; end if;
  if not app.valid_portal_content(p_content) then raise exception 'Invalid portal composition' using errcode='22023'; end if;
  -- Lock a stable parent even on first creation. Two creators cannot both see no draft.
  perform 1 from public.organizations where id=p_organization_id for update;
  select * into v_portal from public.portal_definitions where organization_id=p_organization_id for update;
  if not found then
    if p_expected_version is distinct from 0 then raise exception 'Portal changed. Reload before saving.' using errcode='PT409'; end if;
    insert into public.portal_definitions(organization_id,draft_content,created_by,updated_by)
      values(p_organization_id,p_content,auth.uid(),auth.uid()) returning * into v_portal;
  else
    if p_expected_version is distinct from v_portal.draft_version then raise exception 'Portal changed. Reload before saving.' using errcode='PT409'; end if;
    update public.portal_definitions set draft_content=p_content,draft_version=draft_version+1,updated_at=now(),updated_by=auth.uid()
      where organization_id=p_organization_id returning * into v_portal;
  end if;
  insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload)
    values(p_organization_id,auth.uid(),'portal',v_portal.id,'portal.draft_saved',jsonb_build_object('version',v_portal.draft_version));
  return v_portal.id;
end $$;
revoke all on function public.save_portal_draft(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_portal_draft(uuid,integer,jsonb) to authenticated;

create function public.publish_portal_draft(p_organization_id uuid,p_expected_version integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_portal public.portal_definitions; v_id uuid; v_content jsonb;
begin
  if auth.uid() is null or not app.has_capability(p_organization_id,'organization.manage') then
    raise exception 'Organization management required' using errcode='42501'; end if;
  if not app.module_enabled(p_organization_id,'portal') then raise exception 'Enable the customer portal before publishing' using errcode='22023'; end if;
  select * into v_portal from public.portal_definitions where organization_id=p_organization_id for update;
  if not found then raise exception 'Save a portal draft first' using errcode='22023'; end if;
  if p_expected_version is distinct from v_portal.draft_version then raise exception 'Portal changed. Reload before publishing.' using errcode='PT409'; end if;
  select content into v_content from public.portal_revisions where organization_id=p_organization_id and id=v_portal.published_revision_id;
  if v_content=v_portal.draft_content then return v_portal.published_revision_id; end if;
  insert into public.portal_revisions(organization_id,portal_id,number,content,published_by)
    values(p_organization_id,v_portal.id,v_portal.revision_number+1,v_portal.draft_content,auth.uid()) returning id into v_id;
  update public.portal_definitions set published_revision_id=v_id,revision_number=revision_number+1,
    draft_version=draft_version+1,updated_at=now(),updated_by=auth.uid() where organization_id=p_organization_id;
  insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload)
    values(p_organization_id,auth.uid(),'portal',v_portal.id,'portal.published',jsonb_build_object('revisionId',v_id,'number',v_portal.revision_number+1));
  return v_id;
end $$;
revoke all on function public.publish_portal_draft(uuid,integer) from public,anon,authenticated;
grant execute on function public.publish_portal_draft(uuid,integer) to authenticated;

create function public.unpublish_portal(p_organization_id uuid,p_expected_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare v_portal public.portal_definitions;
begin
  if auth.uid() is null or not app.has_capability(p_organization_id,'organization.manage') then
    raise exception 'Organization management required' using errcode='42501'; end if;
  select * into v_portal from public.portal_definitions where organization_id=p_organization_id for update;
  if not found or p_expected_version is distinct from v_portal.draft_version then raise exception 'Portal changed. Reload before unpublishing.' using errcode='PT409'; end if;
  if v_portal.published_revision_id is null then return; end if;
  update public.portal_definitions set published_revision_id=null,draft_version=draft_version+1,updated_at=now(),updated_by=auth.uid() where organization_id=p_organization_id;
  insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload)
    values(p_organization_id,auth.uid(),'portal',v_portal.id,'portal.unpublished',jsonb_build_object('revisionId',v_portal.published_revision_id));
end $$;
revoke all on function public.unpublish_portal(uuid,integer) from public,anon,authenticated;
grant execute on function public.unpublish_portal(uuid,integer) to authenticated;

-- No caller-supplied tenant/customer. Only a live Portal exchange can read the release.
-- Organizations without a definition keep the established Portal; a saved but unpublished
-- definition keeps that default until first publication. Explicit unpublishing never falls back.
create function public.portal_published_composition()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_context record; v_portal public.portal_definitions; v_content jsonb;
begin
  select * into v_context from public.portal_context();
  if not found then return null; end if;
  if not app.module_enabled(v_context.organization_id,'portal') then return null; end if;
  select * into v_portal from public.portal_definitions where organization_id=v_context.organization_id;
  if not found or v_portal.revision_number=0 then return jsonb_build_object('title','Customer portal','introduction','','modules',jsonb_build_array('work','forms','invoices')); end if;
  select content into v_content from public.portal_revisions where organization_id=v_context.organization_id and id=v_portal.published_revision_id;
  return v_content;
end $$;
revoke all on function public.portal_published_composition() from public,anon,authenticated;
grant execute on function public.portal_published_composition() to authenticated;

alter table public.service_engagements add column portal_visible boolean not null default false;
create function public.set_engagement_portal_visibility(p_organization_id uuid,p_engagement_id uuid,p_visible boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v_customer uuid;
begin
  if auth.uid() is null or not app.has_capability(p_organization_id,'customer.update') then
    raise exception 'Customer management required' using errcode='42501'; end if;
  update public.service_engagements set portal_visible=p_visible,updated_at=now(),updated_by=auth.uid()
    where organization_id=p_organization_id and id=p_engagement_id returning customer_id into v_customer;
  if not found then raise exception 'Engagement unavailable' using errcode='42501'; end if;
  insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload)
    values(p_organization_id,auth.uid(),'customer',v_customer,'service_engagement.portal_visibility_changed',jsonb_build_object('engagementId',p_engagement_id,'visible',p_visible));
end $$;
revoke all on function public.set_engagement_portal_visibility(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_engagement_portal_visibility(uuid,uuid,boolean) to authenticated;

create function public.portal_service_summaries()
returns table(id uuid,name text,service_kind text,status text) language sql stable security definer set search_path='' as $$
  select e.id,e.name,e.service_kind,e.status from public.portal_context() c
  join public.service_engagements e on e.organization_id=c.organization_id and e.customer_id=c.customer_id
  where e.portal_visible and coalesce(public.portal_published_composition()->'modules' ? 'services',false)
  order by e.created_at,e.id;
$$;
revoke all on function public.portal_service_summaries() from public,anon,authenticated;
grant execute on function public.portal_service_summaries() to authenticated;
comment on column public.service_engagements.portal_visible is 'Explicit customer-facing consent: only name, kind and lifecycle; never accepted terms, private Work or foreign tenant artifacts.';

-- Batch A's typed references now include a real, stable Studio Portal identity.
alter table public.engagement_deliverables add column portal_id uuid;
alter table public.engagement_deliverables add foreign key(tenant_organization_id,portal_id)
  references public.portal_definitions(organization_id,id);
alter table public.engagement_deliverables drop constraint engagement_deliverables_check;
alter table public.engagement_deliverables add check(num_nonnulls(site_id,form_id,ai_deployment_id,automation_rule_id,portal_id)=1);
create index deliverable_target_portal on public.engagement_deliverables(tenant_organization_id,portal_id) where portal_id is not null;
create unique index deliverable_portal on public.engagement_deliverables(organization_id,engagement_id,portal_id) where portal_id is not null;

create or replace function app.service_artifact_summaries(p_tenant uuid)
returns table(kind text,id uuid,label text,artifact_status text)
language sql stable security definer set search_path='' as $$
  select 'website',s.id,'Website',case when s.current_published_revision_id is null then 'Unpublished' else 'Published' end
  from public.public_sites s where s.organization_id=p_tenant and p_tenant in(select app.current_tenant_ids()) and app.has_capability(p_tenant,'organization.manage')
  union all
  select 'form',f.id,f.name,case when f.archived_at is not null then 'Archived' when f.current_published_revision_id is null then 'Unpublished' else 'Published' end
  from public.forms f where f.organization_id=p_tenant and p_tenant in(select app.current_tenant_ids()) and app.has_capability(p_tenant,'organization.manage')
  union all
  select 'ai_deployment',d.id,d.display_name,case when d.enabled then 'Enabled configuration · runtime not verified' else 'Disabled configuration' end
  from public.ai_assistant_deployments d where d.organization_id=p_tenant and p_tenant in(select app.current_tenant_ids()) and app.has_capability(p_tenant,'organization.manage')
  union all
  select 'automation',a.id,a.name,case when a.enabled then 'Enabled' else 'Disabled' end
  from public.automation_rules a where a.organization_id=p_tenant and p_tenant in(select app.current_tenant_ids()) and app.module_enabled(p_tenant,'automations')
  union all
  select 'portal',p.id,'Customer portal',case when p.published_revision_id is null then 'Unpublished' else 'Published' end
  from public.portal_definitions p where p.organization_id=p_tenant and p_tenant in(select app.current_tenant_ids()) and app.has_capability(p_tenant,'organization.manage');
$$;
revoke all on function app.service_artifact_summaries(uuid) from public,anon,authenticated;

create or replace function public.attach_engagement_deliverable(p_organization_id uuid,p_engagement_id uuid,p_kind text,p_artifact_id uuid)
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
  insert into public.engagement_deliverables(organization_id,engagement_id,tenant_organization_id,site_id,form_id,ai_deployment_id,automation_rule_id,portal_id,created_by)
  values(p_organization_id,p_engagement_id,v_engagement.tenant_organization_id,
    case when p_kind='website' then p_artifact_id end,case when p_kind='form' then p_artifact_id end,
    case when p_kind='ai_deployment' then p_artifact_id end,case when p_kind='automation' then p_artifact_id end,
    case when p_kind='portal' then p_artifact_id end,auth.uid()) returning id into v_id;
  insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload)
  values(p_organization_id,auth.uid(),'customer',v_engagement.customer_id,'service_engagement.deliverable_attached',jsonb_build_object('engagementId',p_engagement_id,'deliverableId',v_id,'kind',p_kind));
  return v_id;
end $$;

create or replace function public.engagement_deliverable_summaries(p_organization_id uuid,p_engagement_id uuid)
returns table(id uuid,kind text,artifact_id uuid,label text,artifact_status text,available boolean,tenant_organization_id uuid)
language sql stable security definer set search_path='' as $$
  select d.id,
    case when d.site_id is not null then 'website' when d.form_id is not null then 'form' when d.ai_deployment_id is not null then 'ai_deployment' when d.portal_id is not null then 'portal' else 'automation' end,
    coalesce(d.site_id,d.form_id,d.ai_deployment_id,d.automation_rule_id,d.portal_id),
    coalesce(a.label,'Restricted artifact'),coalesce(a.artifact_status,case when r.status='ended' then 'Relationship ended' else 'Tenant access required' end),a.id is not null,d.tenant_organization_id
  from public.engagement_deliverables d join public.service_engagements e on e.organization_id=d.organization_id and e.id=d.engagement_id
  join public.client_tenant_relationships r on r.organization_id=e.organization_id and r.id=e.relationship_id
  left join lateral (select x.* from app.service_artifact_summaries(d.tenant_organization_id) x
    where r.status='active' and x.id=coalesce(d.site_id,d.form_id,d.ai_deployment_id,d.automation_rule_id,d.portal_id)
      and x.kind=case when d.site_id is not null then 'website' when d.form_id is not null then 'form' when d.ai_deployment_id is not null then 'ai_deployment' when d.portal_id is not null then 'portal' else 'automation' end) a on true
  where d.organization_id=p_organization_id and d.engagement_id=p_engagement_id and p_organization_id in(select app.current_tenant_ids())
  order by d.created_at,d.id;
$$;
