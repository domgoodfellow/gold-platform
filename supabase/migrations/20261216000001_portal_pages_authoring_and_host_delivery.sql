-- Full Batch B: coherent pages/navigation/modules, reviewed publication and live exposure.
create function app.portal_keys(v jsonb,k text[]) returns boolean language sql immutable set search_path='' as $$
 select case when jsonb_typeof(v)='object' then v ?& k and (select count(*) from jsonb_object_keys(v))=cardinality(k) else false end;
$$;
create function app.portal_text(v jsonb,n integer,empty_ok boolean default false) returns boolean language sql immutable set search_path='' as $$
 select jsonb_typeof(v)='string' and length(v #>> '{}')<=n and (empty_ok or length(btrim(v #>> '{}',E' \t\n\r\f\013'||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'))>0);
$$;
create function app.upgrade_portal_content(v jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare modules jsonb; kind text;
begin
 if not app.portal_keys(v,array['title','introduction','modules']) then return v; end if;
 if not coalesce(app.portal_text(v->'title',100),false) or not coalesce(app.portal_text(v->'introduction',1000,true),false) or jsonb_typeof(v->'modules') is distinct from 'array' then return v; end if;
 if jsonb_array_length(v->'modules') not between 1 and 4 or (select count(*)<>count(distinct value) from jsonb_array_elements(v->'modules')) then return v; end if;
 modules:='[]'::jsonb;
 for kind in select value #>> '{}' from jsonb_array_elements(v->'modules') loop
  if kind is null or kind not in('work','forms','invoices','services') then return v; end if;
  if kind<>'services' then modules:=modules||jsonb_build_array(jsonb_build_object('id','home-'||kind,'kind',kind,'config',jsonb_build_object('heading',case kind when 'work' then 'Your work' when 'invoices' then 'Your invoices' else 'Forms' end,'variant',case kind when 'work' then 'history' else 'list' end,'limit',20)||case when kind='invoices' then '{"payments":true}'::jsonb else '{}'::jsonb end)); end if;
 end loop;
 if modules='[]'::jsonb then modules:='[{"id":"home-work","kind":"work","config":{"heading":"Your work","variant":"history","limit":20}}]'::jsonb; end if;
 return jsonb_build_object('version',2,'settings',jsonb_build_object('title',v->'title','introduction',v->'introduction','layout','comfortable'),'defaultPageId','home','pages',jsonb_build_array(jsonb_build_object('id','home','name','Home','path','home','modules',modules)),'navigation','[{"pageId":"home","label":"Home"}]'::jsonb);
end $$;
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
   if not app.portal_keys(m,array['id','kind','config']) or jsonb_typeof(m->'id') is distinct from 'string' or not coalesce(m->>'id' ~ '^[a-zA-Z0-9_-]{1,64}$',false) or m->>'id'=any(module_ids) or kind is null or kind not in('work','invoices','forms') or (kind='forms' and kind=any(kinds)) then return false; end if;
   if not app.portal_keys(cfg,case when kind='invoices' then array['heading','variant','limit','payments'] else array['heading','variant','limit'] end) or not coalesce(app.portal_text(cfg->'heading',100),false) or jsonb_typeof(cfg->'variant') is distinct from 'string' or jsonb_typeof(cfg->'limit') is distinct from 'number' then return false; end if;
   if (cfg->>'limit')::numeric not between 1 and 100 or mod((cfg->>'limit')::numeric,1)<>0 then return false; end if;
   if (kind='work' and cfg->>'variant' not in('history','upcoming')) or (kind='invoices' and cfg->>'variant' not in('list','summary')) or (kind='forms' and cfg->>'variant' not in('list','cards')) or (kind='invoices' and jsonb_typeof(cfg->'payments') is distinct from 'boolean') then return false; end if;
   module_ids:=array_append(module_ids,m->>'id'); kinds:=array_append(kinds,kind);
  end loop;
 end loop;
 for n in select value from jsonb_array_elements(v->'navigation') loop
  if not app.portal_keys(n,array['pageId','label']) or jsonb_typeof(n->'pageId') is distinct from 'string' or not coalesce(n->>'pageId'=any(page_ids),false) or n->>'pageId'=any(nav_ids) or not coalesce(app.portal_text(n->'label',80),false) then return false; end if;
  nav_ids:=array_append(nav_ids,n->>'pageId');
 end loop;
 return coalesce(v->>'defaultPageId'=any(page_ids) and v->>'defaultPageId'=any(nav_ids),false);
end $$;
revoke all on function app.portal_keys(jsonb,text[]),app.portal_text(jsonb,integer,boolean),app.upgrade_portal_content(jsonb) from public,anon,authenticated;

-- Preserve immutable historical content; normalize it only when read/restored.
update public.portal_definitions set draft_content=app.upgrade_portal_content(draft_content);
alter table public.portal_definitions add column draft_status text not null default 'draft' check(draft_status in('draft','in_review'));
alter table public.portal_definitions add column submitted_at timestamptz;
alter table public.portal_definitions add column submitted_by uuid references auth.users(id);
alter table public.portal_definitions add check((draft_status='draft' and submitted_at is null and submitted_by is null) or (draft_status='in_review' and submitted_at is not null and submitted_by is not null));
alter table public.portal_revisions add column reviewed_at timestamptz;
alter table public.portal_revisions add column reviewed_by uuid references auth.users(id);

create function app.portal_feature_available(org uuid,key text,legacy boolean default false) returns boolean language plpgsql stable security definer set search_path='' as $$
declare feature uuid; has_plan boolean;
begin
 select id into feature from public.platform_catalog_features where platform_catalog_features.key=portal_feature_available.key and implementation_state='available';
 if feature is null or exists(select 1 from public.organization_feature_activation_overrides where organization_id=org and feature_id=feature) then return false; end if;
 select exists(select 1 from public.organization_plan_assignments where organization_id=org and plan_kind='plan' and period_start<=current_date and period_end>current_date) into has_plan;
 if has_plan then return exists(select 1 from public.organization_plan_assignments where organization_id=org and period_start<=current_date and period_end>current_date and app.plan_grants_feature(plan_id,feature)); end if;
 return app.module_paid(org,'portal') or (legacy and not exists(select 1 from public.organization_plan_assignments where organization_id=org and plan_kind='plan') and not exists(select 1 from public.organization_commercial_terms where organization_id=org and product_key='module:portal'));
end $$;
revoke all on function app.portal_feature_available(uuid,text,boolean) from public,anon,authenticated;
create function app.portal_live_content(org uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.portal_definitions; content jsonb;
begin
 if not app.module_enabled(org,'portal') then return null; end if;
 select * into p from public.portal_definitions where organization_id=org;
 if not found or p.revision_number=0 then
  if not app.portal_feature_available(org,'portal_auth',true) then return null; end if;
  return app.upgrade_portal_content('{"title":"Customer portal","introduction":"","modules":["work","forms","invoices"]}'::jsonb);
 end if;
 if not app.portal_feature_available(org,'portal_auth') then return null; end if;
 select r.content into content from public.portal_revisions r where r.organization_id=org and r.id=p.published_revision_id;
 return app.upgrade_portal_content(content);
end $$;
revoke all on function app.portal_live_content(uuid) from public,anon,authenticated;
create function app.portal_exposed(org uuid,kind text,payments boolean default false) returns boolean language plpgsql stable security definer set search_path='' as $$
declare content jsonb:=app.portal_live_content(org); legacy boolean;
begin
 if content is null or kind not in('work','invoices','forms') then return false; end if;
 select not exists(select 1 from public.portal_definitions where organization_id=org and revision_number>0) into legacy;
 if not app.portal_feature_available(org,case when kind='forms' then 'portal_auth' else 'portal_history' end,legacy) then return false; end if;
 return exists(select 1 from jsonb_array_elements(content->'pages') p cross join lateral jsonb_array_elements(p->'modules') m where m->>'kind'=kind and (not payments or m->'config'->'payments'='true'::jsonb) and exists(select 1 from jsonb_array_elements(content->'navigation') n where n->>'pageId'=p->>'id'));
end $$;
revoke all on function app.portal_exposed(uuid,text,boolean) from public,anon,authenticated;
create or replace function public.portal_published_composition() returns jsonb language sql stable security definer set search_path='' as $$
 select app.portal_live_content(c.organization_id) from public.portal_context() c;
$$;
create function public.portal_module_availability(p_organization_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare org uuid; legacy boolean;
begin
 if p_organization_id is null then select organization_id into org from public.portal_context();
 elsif app.has_capability(p_organization_id,'organization.manage') then org:=p_organization_id; end if;
 if org is null then raise exception 'Portal unavailable' using errcode='42501'; end if;
 select not exists(select 1 from public.portal_definitions where organization_id=org and revision_number>0) into legacy;
 return jsonb_build_object('defaultExperience',legacy,'work',app.portal_feature_available(org,'portal_history',legacy),'invoices',app.portal_feature_available(org,'portal_history',legacy),'forms',app.portal_feature_available(org,'portal_auth',legacy),'publish',app.module_enabled(org,'portal') and app.portal_feature_available(org,'portal_auth'),'payments',app.module_enabled(org,'card_payments') and app.module_entitled(org,'card_payments'));
end $$;
revoke all on function public.portal_module_availability(uuid) from public,anon,authenticated;
grant execute on function public.portal_module_availability(uuid) to authenticated;

alter function public.save_portal_draft(uuid,integer,jsonb) set schema app;
alter function public.publish_portal_draft(uuid,integer) set schema app;
revoke all on function app.save_portal_draft(uuid,integer,jsonb),app.publish_portal_draft(uuid,integer) from public,anon,authenticated;
create function public.save_portal_draft(p_organization_id uuid,p_expected_version integer,p_content jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare id uuid;
begin
 id:=app.save_portal_draft(p_organization_id,p_expected_version,app.upgrade_portal_content(p_content));
 update public.portal_definitions set draft_status='draft',submitted_at=null,submitted_by=null where organization_id=p_organization_id;
 return id;
end $$;
create function public.submit_portal_draft(p_organization_id uuid,p_expected_version integer) returns void language plpgsql security definer set search_path='' as $$
declare p public.portal_definitions;
begin
 if auth.uid() is null or not app.has_capability(p_organization_id,'organization.manage') then raise exception 'Organization management required' using errcode='42501'; end if;
 select * into p from public.portal_definitions where organization_id=p_organization_id for update;
 if not found or p_expected_version is distinct from p.draft_version then raise exception 'Portal changed. Reload before review.' using errcode='PT409'; end if;
 if p.draft_status='in_review' then return; end if;
 update public.portal_definitions set draft_status='in_review',submitted_at=now(),submitted_by=auth.uid(),draft_version=draft_version+1 where organization_id=p_organization_id;
 insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload) values(p_organization_id,auth.uid(),'portal',p.id,'portal.submitted',jsonb_build_object('version',p.draft_version+1));
end $$;
create function public.publish_portal_draft(p_organization_id uuid,p_expected_version integer) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.portal_definitions; v_id uuid; live jsonb;
begin
 if auth.uid() is null or not app.has_capability(p_organization_id,'organization.manage') then raise exception 'Organization management required' using errcode='42501'; end if;
 select * into p from public.portal_definitions where organization_id=p_organization_id for update;
 if not found or p_expected_version is distinct from p.draft_version then raise exception 'Portal changed. Reload before publishing.' using errcode='PT409'; end if;
 if not app.module_enabled(p_organization_id,'portal') or not app.portal_feature_available(p_organization_id,'portal_auth') then raise exception 'Portal entitlement and activation required' using errcode='42501'; end if;
 select app.upgrade_portal_content(content) into live from public.portal_revisions where organization_id=p_organization_id and portal_revisions.id=p.published_revision_id;
 if live=p.draft_content then
  update public.portal_definitions set draft_status='draft',submitted_at=null,submitted_by=null where organization_id=p_organization_id;
  return p.published_revision_id;
 end if;
 if p.draft_status<>'in_review' then raise exception 'Send this saved draft for review before publishing' using errcode='22023'; end if;
 v_id:=app.publish_portal_draft(p_organization_id,p_expected_version);
 update public.portal_revisions set reviewed_at=p.submitted_at,reviewed_by=p.submitted_by where organization_id=p_organization_id and portal_revisions.id=v_id;
 update public.portal_definitions set draft_status='draft',submitted_at=null,submitted_by=null where organization_id=p_organization_id;
 return v_id;
end $$;
revoke all on function public.save_portal_draft(uuid,integer,jsonb),public.submit_portal_draft(uuid,integer),public.publish_portal_draft(uuid,integer) from public,anon,authenticated;
grant execute on function public.save_portal_draft(uuid,integer,jsonb),public.submit_portal_draft(uuid,integer),public.publish_portal_draft(uuid,integer) to authenticated;

-- Guard the canonical commands themselves, not just the page's visible buttons.
alter function public.submit_portal_form(uuid,uuid,jsonb) set schema app;
alter function public.portal_forms_available() set schema app;
alter function public.begin_external_card_payment(uuid,text) set schema app;
alter function public.external_card_payment_availability(uuid,text) set schema app;
revoke all on function app.submit_portal_form(uuid,uuid,jsonb),app.portal_forms_available(),app.begin_external_card_payment(uuid,text),app.external_card_payment_availability(uuid,text) from public,anon,authenticated;
create function public.portal_forms_available() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare org uuid;
begin
 select organization_id into org from public.portal_context();
 if org is null or not app.portal_exposed(org,'forms') then return '[]'::jsonb; end if;
 return app.portal_forms_available();
end $$;
create function public.submit_portal_form(p_form_id uuid,p_revision_id uuid,p_answers jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid;
begin
 select organization_id into org from public.portal_context();
 if org is null or not app.portal_exposed(org,'forms') then raise exception 'Forms are not available in this Portal' using errcode='42501'; end if;
 return app.submit_portal_form(p_form_id,p_revision_id,p_answers);
end $$;
create function public.begin_external_card_payment(p_invoice_id uuid,p_provider text) returns table(request_id uuid,outstanding_minor bigint,currency text,account_id text) language plpgsql security definer set search_path='' as $$
declare org uuid;
begin
 select organization_id into org from public.portal_context();
 if org is null or not app.portal_exposed(org,'invoices',true) or not app.module_enabled(org,'card_payments') or not app.module_entitled(org,'card_payments') then raise exception 'Payments are not available in this Portal' using errcode='42501'; end if;
 return query select * from app.begin_external_card_payment(p_invoice_id,p_provider);
end $$;
create function public.external_card_payment_availability(p_invoice_id uuid,p_provider text) returns table(outstanding_minor bigint,currency text,account_id text) language plpgsql stable security definer set search_path='' as $$
declare org uuid;
begin
 select organization_id into org from public.portal_context();
 if org is null or not app.portal_exposed(org,'invoices',true) or not app.module_enabled(org,'card_payments') or not app.module_entitled(org,'card_payments') then return; end if;
 return query select * from app.external_card_payment_availability(p_invoice_id,p_provider);
end $$;
revoke all on function public.external_card_payment_availability(uuid,text) from public,anon,authenticated;
grant execute on function public.external_card_payment_availability(uuid,text) to authenticated;
revoke all on function public.submit_portal_form(uuid,uuid,jsonb),public.portal_forms_available(),public.begin_external_card_payment(uuid,text) from public,anon,authenticated;
grant execute on function public.submit_portal_form(uuid,uuid,jsonb),public.portal_forms_available(),public.begin_external_card_payment(uuid,text) to authenticated;

-- A commercial relationship is not a Portal module: managed-services projections are Batch C.
drop function public.portal_service_summaries();
drop function public.set_engagement_portal_visibility(uuid,uuid,boolean);
alter table public.service_engagements drop column portal_visible;

create function app.portal_managed_host(org uuid,host text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organizations o cross join public.platform_settings s where o.id=org and s.singleton and lower(host)=o.slug||'.'||s.platform_public_domain);
$$;
revoke all on function app.portal_managed_host(uuid,text) from public,anon,authenticated;
create function public.portal_context_at_hostname(p_hostname text) returns table(organization_id uuid,customer_id uuid,portal_invite_id uuid,expires_at timestamptz) language sql stable security definer set search_path='' as $$
 select c.* from public.portal_context() c cross join lateral app.resolve_hostname(p_hostname) h
 where h.organization_id=c.organization_id and (h.surface='portal' or app.portal_managed_host(c.organization_id,p_hostname));
$$;
create function public.claim_portal_invite_at_hostname(p_token text,p_hostname text) returns uuid language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.customer_portal_invites i cross join lateral app.resolve_hostname(p_hostname) h where i.token=p_token and i.revoked_at is null and i.organization_id=h.organization_id and (h.surface='portal' or app.portal_managed_host(i.organization_id,p_hostname))) then raise exception 'Portal unavailable' using errcode='42501'; end if;
 return public.claim_portal_invite(p_token);
end $$;
revoke all on function public.portal_context_at_hostname(text),public.claim_portal_invite_at_hostname(text,text) from public,anon,authenticated;
grant execute on function public.portal_context_at_hostname(text),public.claim_portal_invite_at_hostname(text,text) to authenticated;
