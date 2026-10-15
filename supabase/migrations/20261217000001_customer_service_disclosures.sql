alter table public.service_engagements add unique(organization_id,customer_id,id);
alter table public.engagement_deliverables add unique(organization_id,engagement_id,id);

create function app.valid_service_disclosure(v jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare d jsonb; ids text[]:='{}';
begin
 if not app.portal_keys(v,array['title','serviceKind','summary','status','deliverables'])
  or not coalesce(app.portal_text(v->'title',200),false)
  or not coalesce(app.portal_text(v->'summary',3000),false)
  or not coalesce(app.portal_text(v->'status',200),false)
  or jsonb_typeof(v->'serviceKind') is distinct from 'string'
  or v->>'serviceKind' not in('website','ai','automation','integration','implementation','managed_operations')
  or jsonb_typeof(v->'deliverables') is distinct from 'array' then return false; end if;
 if jsonb_array_length(v->'deliverables')>20 then return false; end if;
 for d in select value from jsonb_array_elements(v->'deliverables') loop
  if not app.portal_keys(d,array['deliverableId','title','summary','status','shareLink'])
   or jsonb_typeof(d->'deliverableId') is distinct from 'string'
   or not coalesce(d->>'deliverableId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false)
   or d->>'deliverableId'=any(ids)
   or not coalesce(app.portal_text(d->'title',200),false)
   or not coalesce(app.portal_text(d->'summary',1000,true),false)
   or not coalesce(app.portal_text(d->'status',200),false)
   or jsonb_typeof(d->'shareLink') is distinct from 'boolean' then return false; end if;
  ids:=array_append(ids,d->>'deliverableId');
 end loop;
 return true;
end $$;
revoke all on function app.valid_service_disclosure(jsonb) from public,anon,authenticated;

create table public.service_disclosures (
 organization_id uuid not null,
 id uuid not null default gen_random_uuid(),
 customer_id uuid not null,
 engagement_id uuid not null,
 draft_content jsonb not null check(app.valid_service_disclosure(draft_content)),
 version integer not null default 1 check(version>0),
 published_revision_id uuid,
 revision_number integer not null default 0 check(revision_number>=0),
 created_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now(),
 updated_by uuid not null references auth.users(id),
 primary key(organization_id,id),
 unique(organization_id,engagement_id),
 unique(organization_id,customer_id,engagement_id,id),
 foreign key(organization_id,customer_id,engagement_id) references public.service_engagements(organization_id,customer_id,id)
);
create table public.service_disclosure_revisions (
 organization_id uuid not null,
 id uuid not null default gen_random_uuid(),
 customer_id uuid not null,
 engagement_id uuid not null,
 disclosure_id uuid not null,
 number integer not null check(number>0),
 content jsonb not null check(app.valid_service_disclosure(content)),
 engagement_status text not null check(engagement_status in('planned','active','completed','cancelled')),
 published_at timestamptz not null default now(),
 published_by uuid not null references auth.users(id),
 primary key(organization_id,id),
 unique(organization_id,disclosure_id,number),
 unique(organization_id,disclosure_id,id),
 unique(organization_id,engagement_id,id),
 foreign key(organization_id,customer_id,engagement_id,disclosure_id) references public.service_disclosures(organization_id,customer_id,engagement_id,id)
);
alter table public.service_disclosures add foreign key(organization_id,id,published_revision_id)
 references public.service_disclosure_revisions(organization_id,disclosure_id,id);
create table public.service_disclosure_deliverables (
 organization_id uuid not null,
 revision_id uuid not null,
 engagement_id uuid not null,
 deliverable_id uuid not null,
 position integer not null check(position between 0 and 19),
 kind text not null check(kind in('website','form','ai_deployment','automation','portal')),
 title text not null check(length(btrim(title)) between 1 and 200),
 summary text not null check(length(summary)<=1000),
 status text not null check(length(btrim(status)) between 1 and 200),
 url text check(url is null or (length(url)<=2048 and url ~ '^https://[a-z0-9][a-z0-9.-]+(/|$)' and url !~ '[@?#]' and url !~ '[[:space:]]')),
 primary key(organization_id,revision_id,deliverable_id),
 unique(organization_id,revision_id,position),
 foreign key(organization_id,engagement_id,revision_id) references public.service_disclosure_revisions(organization_id,engagement_id,id),
 foreign key(organization_id,engagement_id,deliverable_id) references public.engagement_deliverables(organization_id,engagement_id,id)
);
create index service_disclosure_customer on public.service_disclosures(organization_id,customer_id,updated_at);
create index service_disclosure_revision_owner on public.service_disclosure_revisions(organization_id,customer_id,engagement_id,disclosure_id);
create index service_disclosure_deliverable_reference on public.service_disclosure_deliverables(organization_id,engagement_id,deliverable_id);
alter table public.service_disclosures enable row level security;
alter table public.service_disclosures force row level security;
alter table public.service_disclosure_revisions enable row level security;
alter table public.service_disclosure_revisions force row level security;
alter table public.service_disclosure_deliverables enable row level security;
alter table public.service_disclosure_deliverables force row level security;
revoke all on public.service_disclosures,public.service_disclosure_revisions,public.service_disclosure_deliverables from public,anon,authenticated;
grant select on public.service_disclosures,public.service_disclosure_revisions,public.service_disclosure_deliverables to authenticated;
create policy disclosure_read on public.service_disclosures for select to authenticated using(organization_id in(select app.current_tenant_ids()));
create policy disclosure_revision_read on public.service_disclosure_revisions for select to authenticated using(organization_id in(select app.current_tenant_ids()));
create policy disclosure_deliverable_read on public.service_disclosure_deliverables for select to authenticated using(organization_id in(select app.current_tenant_ids()));

create function app.preserve_service_disclosure_revision() returns trigger language plpgsql set search_path='' as $$
begin
 raise exception 'Approved service history is immutable' using errcode='42501';
end $$;
revoke all on function app.preserve_service_disclosure_revision() from public,anon,authenticated;
create trigger preserve_service_disclosure_revision before update or delete on public.service_disclosure_revisions for each row execute function app.preserve_service_disclosure_revision();
create trigger preserve_service_disclosure_deliverable before update or delete on public.service_disclosure_deliverables for each row execute function app.preserve_service_disclosure_revision();

-- Only existing public destinations are eligible; callers never supply URLs or credentials.
create function app.service_deliverable_url(d public.engagement_deliverables) returns text
language plpgsql stable security definer set search_path='' as $$
declare host text; key text;
begin
 if d.site_id is not null and not exists(select 1 from public.public_sites where organization_id=d.tenant_organization_id and id=d.site_id and current_published_revision_id is not null) then return null; end if;
 if d.form_id is not null then
  select slug into key from public.forms where organization_id=d.tenant_organization_id and id=d.form_id and current_published_revision_id is not null and archived_at is null;
  if key is null or key !~ '^[a-z0-9][a-z0-9-]*$' then return null; end if;
 end if;
 if d.portal_id is not null and app.portal_live_content(d.tenant_organization_id) is null then return null; end if;
 if d.site_id is null and d.form_id is null and d.portal_id is null then return null; end if;
 select hostname::text into host from public.organization_domains
 where organization_id=d.tenant_organization_id and surface=case when d.portal_id is not null then 'portal' else 'website' end
  and verification_state='verified' and configuration_state='satisfied' and ssl_state='issued' and released_at is null
 order by is_primary desc,created_at,id limit 1;
 if host is null or host !~ '^[a-z0-9][a-z0-9.-]+$' then return null; end if;
 return 'https://'||host||case when d.form_id is not null then '/forms/'||key when d.portal_id is not null then '/portal' else '/' end;
end $$;
revoke all on function app.service_deliverable_url(public.engagement_deliverables) from public,anon,authenticated;

create function app.validate_disclosure_deliverables(org uuid,eng public.service_engagements,content jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare item jsonb; d public.engagement_deliverables; v_kind text; v_artifact uuid;
begin
 if jsonb_array_length(content->'deliverables')=0 then return; end if;
 perform 1 from public.client_tenant_relationships where organization_id=org and id=eng.relationship_id and customer_id=eng.customer_id and status='active' for update;
 if not found then raise exception 'Active customer relationship required for deliverables' using errcode='42501'; end if;
 for item in select value from jsonb_array_elements(content->'deliverables') loop
  select * into d from public.engagement_deliverables where organization_id=org and engagement_id=eng.id and id=(item->>'deliverableId')::uuid;
  if not found then raise exception 'Engagement deliverable unavailable' using errcode='42501'; end if;
  v_kind:=case when d.site_id is not null then 'website' when d.form_id is not null then 'form' when d.ai_deployment_id is not null then 'ai_deployment' when d.portal_id is not null then 'portal' else 'automation' end;
  v_artifact:=coalesce(d.site_id,d.form_id,d.ai_deployment_id,d.automation_rule_id,d.portal_id);
  if not exists(select 1 from app.service_artifact_summaries(d.tenant_organization_id) a where a.kind=v_kind and a.id=v_artifact) then
   raise exception 'Independent tenant artifact authority required' using errcode='42501'; end if;
  if (item->>'shareLink')::boolean and app.service_deliverable_url(d) is null then raise exception 'No approved public destination is available' using errcode='22023'; end if;
 end loop;
end $$;
revoke all on function app.validate_disclosure_deliverables(uuid,public.service_engagements,jsonb) from public,anon,authenticated;

create function public.save_service_disclosure(p_organization_id uuid,p_customer_id uuid,p_engagement_id uuid,p_expected_version integer,p_content jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare eng public.service_engagements; d public.service_disclosures; result uuid;
begin
 if auth.uid() is null or not app.has_capability(p_organization_id,'customer.update') then raise exception 'Customer management permission required' using errcode='42501'; end if;
 select * into eng from public.service_engagements where organization_id=p_organization_id and customer_id=p_customer_id and id=p_engagement_id for update;
 if not found then raise exception 'Customer engagement unavailable' using errcode='42501'; end if;
 if not app.valid_service_disclosure(p_content) then raise exception 'Invalid customer update' using errcode='22023'; end if;
 select * into d from public.service_disclosures where organization_id=p_organization_id and engagement_id=p_engagement_id for update;
 if p_expected_version is distinct from coalesce(d.version,0) then raise exception 'Customer update changed. Reload before saving.' using errcode='PT409'; end if;
 perform app.validate_disclosure_deliverables(p_organization_id,eng,p_content);
 if d.id is null then
  insert into public.service_disclosures(organization_id,customer_id,engagement_id,draft_content,created_by,updated_by)
   values(p_organization_id,p_customer_id,p_engagement_id,p_content,auth.uid(),auth.uid()) returning id into result;
 else
  update public.service_disclosures set draft_content=p_content,version=version+1,updated_at=now(),updated_by=auth.uid() where organization_id=p_organization_id and id=d.id returning id into result;
 end if;
 insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload) values(p_organization_id,auth.uid(),'customer',p_customer_id,'service_disclosure.saved',jsonb_build_object('disclosureId',result));
 return result;
end $$;

create function public.publish_service_disclosure(p_organization_id uuid,p_customer_id uuid,p_engagement_id uuid,p_expected_version integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare eng public.service_engagements; disclosure public.service_disclosures; item jsonb; d public.engagement_deliverables; revision uuid:=gen_random_uuid(); position integer:=0;
begin
 if auth.uid() is null or not app.has_capability(p_organization_id,'customer.update') then raise exception 'Customer management permission required' using errcode='42501'; end if;
 select * into eng from public.service_engagements where organization_id=p_organization_id and customer_id=p_customer_id and id=p_engagement_id for update;
 if not found then raise exception 'Customer engagement unavailable' using errcode='42501'; end if;
 select * into disclosure from public.service_disclosures where organization_id=p_organization_id and engagement_id=p_engagement_id for update;
 if not found or p_expected_version is distinct from disclosure.version then raise exception 'Customer update changed. Reload before publishing.' using errcode='PT409'; end if;
 perform app.validate_disclosure_deliverables(p_organization_id,eng,disclosure.draft_content);
 insert into public.service_disclosure_revisions(organization_id,id,customer_id,engagement_id,disclosure_id,number,content,engagement_status,published_by)
 values(p_organization_id,revision,p_customer_id,p_engagement_id,disclosure.id,disclosure.revision_number+1,disclosure.draft_content,eng.status,auth.uid());
 for item in select value from jsonb_array_elements(disclosure.draft_content->'deliverables') loop
  select * into d from public.engagement_deliverables where organization_id=p_organization_id and engagement_id=p_engagement_id and id=(item->>'deliverableId')::uuid;
  insert into public.service_disclosure_deliverables(organization_id,revision_id,engagement_id,deliverable_id,position,kind,title,summary,status,url)
  values(p_organization_id,revision,p_engagement_id,d.id,position,case when d.site_id is not null then 'website' when d.form_id is not null then 'form' when d.ai_deployment_id is not null then 'ai_deployment' when d.portal_id is not null then 'portal' else 'automation' end,item->>'title',item->>'summary',item->>'status',case when (item->>'shareLink')::boolean then app.service_deliverable_url(d) end);
  position:=position+1;
 end loop;
 update public.service_disclosures set published_revision_id=revision,revision_number=revision_number+1,version=version+1,updated_at=now(),updated_by=auth.uid() where organization_id=p_organization_id and id=disclosure.id;
 insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload) values(p_organization_id,auth.uid(),'customer',p_customer_id,'service_disclosure.published',jsonb_build_object('disclosureId',disclosure.id,'revisionId',revision));
 return revision;
end $$;

create function public.withdraw_service_disclosure(p_organization_id uuid,p_customer_id uuid,p_engagement_id uuid,p_expected_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare d public.service_disclosures;
begin
 if auth.uid() is null or not app.has_capability(p_organization_id,'customer.update') then raise exception 'Customer management permission required' using errcode='42501'; end if;
 select * into d from public.service_disclosures where organization_id=p_organization_id and customer_id=p_customer_id and engagement_id=p_engagement_id for update;
 if not found or p_expected_version is distinct from d.version then raise exception 'Customer update changed. Reload before withdrawal.' using errcode='PT409'; end if;
 update public.service_disclosures set published_revision_id=null,version=version+1,updated_at=now(),updated_by=auth.uid() where organization_id=p_organization_id and id=d.id;
 insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload) values(p_organization_id,auth.uid(),'customer',p_customer_id,'service_disclosure.withdrawn',jsonb_build_object('disclosureId',d.id,'revisionId',d.published_revision_id));
end $$;
revoke all on function public.save_service_disclosure(uuid,uuid,uuid,integer,jsonb),public.publish_service_disclosure(uuid,uuid,uuid,integer),public.withdraw_service_disclosure(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.save_service_disclosure(uuid,uuid,uuid,integer,jsonb),public.publish_service_disclosure(uuid,uuid,uuid,integer),public.withdraw_service_disclosure(uuid,uuid,uuid,integer) to authenticated;

create or replace function app.portal_exposed(org uuid,kind text,payments boolean default false) returns boolean language plpgsql stable security definer set search_path='' as $$
declare content jsonb:=app.portal_live_content(org); legacy boolean;
begin
 if content is null or kind not in('work','invoices','forms','services') then return false; end if;
 select not exists(select 1 from public.portal_definitions where organization_id=org and revision_number>0) into legacy;
 if not app.portal_feature_available(org,case when kind in('forms','services') then 'portal_auth' else 'portal_history' end,legacy) then return false; end if;
 return exists(select 1 from jsonb_array_elements(content->'pages') p cross join lateral jsonb_array_elements(p->'modules') m where m->>'kind'=kind and (not payments or m->'config'->'payments'='true'::jsonb) and exists(select 1 from jsonb_array_elements(content->'navigation') n where n->>'pageId'=p->>'id'));
end $$;
revoke all on function app.portal_exposed(uuid,text,boolean) from public,anon,authenticated;

create function public.portal_service_disclosures(p_disclosure_id uuid default null,p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare org uuid; customer uuid; result jsonb;
begin
 select organization_id,customer_id into org,customer from public.portal_context();
 if org is null or not app.portal_exposed(org,'services') then raise exception 'Services are not available in this Portal' using errcode='42501'; end if;
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid service record limit' using errcode='22023'; end if;
 select coalesce(jsonb_agg(record order by published_at desc,id),'[]'::jsonb) into result from (
  select s.id,r.published_at,jsonb_build_object('id',s.id,'title',r.content->'title','serviceKind',r.content->'serviceKind','summary',r.content->'summary','status',r.content->'status','publishedAt',r.published_at,
   'deliverables',coalesce((select jsonb_agg(jsonb_build_object('kind',d.kind,'title',d.title,'summary',d.summary,'status',d.status,'url',
    case when d.url is not null and exists(select 1 from app.resolve_hostname(split_part(split_part(d.url,'://',2),'/',1)) h where h.organization_id=e.tenant_organization_id) then d.url end) order by d.position)
    from public.service_disclosure_deliverables d where d.organization_id=org and d.revision_id=r.id
    and exists(select 1 from public.client_tenant_relationships rel where rel.organization_id=org and rel.id=e.relationship_id and rel.status='active')),'[]'::jsonb)) record
  from public.service_disclosures s join public.service_disclosure_revisions r on r.organization_id=s.organization_id and r.disclosure_id=s.id and r.id=s.published_revision_id
  join public.service_engagements e on e.organization_id=s.organization_id and e.customer_id=s.customer_id and e.id=s.engagement_id
  where s.organization_id=org and s.customer_id=customer and (p_disclosure_id is null or s.id=p_disclosure_id)
  order by r.published_at desc,s.id limit p_limit
 ) records;
 if p_disclosure_id is not null and jsonb_array_length(result)=0 then raise exception 'Service update unavailable' using errcode='42501'; end if;
 return result;
end $$;
revoke all on function public.portal_service_disclosures(uuid,integer) from public,anon,authenticated;
grant execute on function public.portal_service_disclosures(uuid,integer) to authenticated;

create or replace function public.portal_module_availability(p_organization_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare org uuid; legacy boolean; internal boolean:=false;
begin
 if p_organization_id is null then select organization_id into org from public.portal_context();
 elsif app.has_capability(p_organization_id,'organization.manage') then org:=p_organization_id; internal:=true; end if;
 if org is null then raise exception 'Portal unavailable' using errcode='42501'; end if;
 select not exists(select 1 from public.portal_definitions where organization_id=org and revision_number>0) into legacy;
 return jsonb_build_object('defaultExperience',legacy,'work',app.portal_feature_available(org,'portal_history',legacy),'invoices',app.portal_feature_available(org,'portal_history',legacy),'forms',app.portal_feature_available(org,'portal_auth',legacy),
 'services',app.module_enabled(org,'portal') and app.portal_feature_available(org,'portal_auth',legacy) and (internal or (app.portal_exposed(org,'services') and exists(select 1 from public.service_disclosures s cross join public.portal_context() c where s.organization_id=c.organization_id and s.customer_id=c.customer_id and s.published_revision_id is not null))),
 'publish',app.module_enabled(org,'portal') and app.portal_feature_available(org,'portal_auth'),'payments',app.module_enabled(org,'card_payments') and app.module_entitled(org,'card_payments'));
end $$;
revoke all on function public.portal_module_availability(uuid) from public,anon,authenticated;
grant execute on function public.portal_module_availability(uuid) to authenticated;
create or replace function app.valid_portal_content(p_content jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare v jsonb:=app.upgrade_portal_content(p_content); p jsonb; m jsonb; n jsonb; cfg jsonb; kind text;
 page_ids text[]:='{}'; paths text[]:='{}'; module_ids text[]:='{}'; nav_ids text[]:='{}'; kinds text[];
begin
 if not coalesce(app.portal_keys(v,array['version','settings','defaultPageId','pages','navigation']),false) or v->'version'<>'2'::jsonb then return false; end if;
 if not app.portal_keys(v->'settings',array['title','introduction','layout']) or not coalesce(app.portal_text(v->'settings'->'title',100),false) or not coalesce(app.portal_text(v->'settings'->'introduction',1000,true),false) or jsonb_typeof(v->'settings'->'layout') is distinct from 'string' or v->'settings'->>'layout' not in('comfortable','compact') then return false; end if;
 if jsonb_typeof(v->'pages') is distinct from 'array' or jsonb_typeof(v->'navigation') is distinct from 'array' or jsonb_typeof(v->'defaultPageId') is distinct from 'string' then return false; end if;
 if jsonb_array_length(v->'pages') not between 1 and 12 or jsonb_array_length(v->'navigation') not between 1 and 12 then return false; end if;
 for p in select value from jsonb_array_elements(v->'pages') loop
  if not app.portal_keys(p,array['id','name','path','modules']) or jsonb_typeof(p->'id') is distinct from 'string' or jsonb_typeof(p->'path') is distinct from 'string' or not coalesce(p->>'id' ~ '^[a-zA-Z0-9_-]{1,64}$',false) or p->>'id'=any(page_ids) or not coalesce(app.portal_text(p->'name',80),false) or not coalesce(p->>'path' ~ '^[a-z0-9]+(-[a-z0-9]+)*$',false) or length(p->>'path')>64 or p->>'path'=any(paths) or jsonb_typeof(p->'modules') is distinct from 'array' then return false; end if;
  if jsonb_array_length(p->'modules') not between 1 and 12 then return false; end if;
  page_ids:=array_append(page_ids,p->>'id'); paths:=array_append(paths,p->>'path'); kinds:='{}';
  for m in select value from jsonb_array_elements(p->'modules') loop
   kind:=m->>'kind'; cfg:=m->'config';
   if not app.portal_keys(m,array['id','kind','config']) or jsonb_typeof(m->'id') is distinct from 'string' or not coalesce(m->>'id' ~ '^[a-zA-Z0-9_-]{1,64}$',false) or m->>'id'=any(module_ids) or kind is null or kind not in('work','invoices','forms','services') or (kind='forms' and kind=any(kinds)) then return false; end if;
   if not app.portal_keys(cfg,case when kind='invoices' then array['heading','variant','limit','payments'] else array['heading','variant','limit'] end) or not coalesce(app.portal_text(cfg->'heading',100),false) or jsonb_typeof(cfg->'variant') is distinct from 'string' or jsonb_typeof(cfg->'limit') is distinct from 'number' then return false; end if;
   if (cfg->>'limit')::numeric not between 1 and 100 or mod((cfg->>'limit')::numeric,1)<>0 then return false; end if;
   if (kind='work' and cfg->>'variant' not in('history','upcoming')) or (kind='invoices' and cfg->>'variant' not in('list','summary')) or (kind='forms' and cfg->>'variant' not in('list','cards')) or (kind='services' and cfg->>'variant' not in('list','cards','summary')) or (kind='invoices' and jsonb_typeof(cfg->'payments') is distinct from 'boolean') then return false; end if;
   module_ids:=array_append(module_ids,m->>'id'); kinds:=array_append(kinds,kind);
  end loop;
 end loop;
 for n in select value from jsonb_array_elements(v->'navigation') loop
  if not app.portal_keys(n,array['pageId','label']) or jsonb_typeof(n->'pageId') is distinct from 'string' or not coalesce(n->>'pageId'=any(page_ids),false) or n->>'pageId'=any(nav_ids) or not coalesce(app.portal_text(n->'label',80),false) then return false; end if;
  nav_ids:=array_append(nav_ids,n->>'pageId');
 end loop;
 return coalesce(v->>'defaultPageId'=any(page_ids) and v->>'defaultPageId'=any(nav_ids),false);
end $$;
