-- One assistant resource may be deployed to several surfaces.  The first deployment is the
-- public web widget; operator Ask remains the existing deployment while its configuration is
-- migrated in a later slice.  Conversations remain Communications records, never AI records.

alter table public.external_actors add constraint external_actors_org_id_unique unique (organization_id, id);

create table public.ai_assistants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  instructions text not null default '' check (length(instructions) <= 8000),
  status text not null default 'draft' check (status in ('draft','active','disabled')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id), updated_by uuid not null references auth.users(id),
  unique (organization_id,id)
);

create table public.ai_assistant_deployments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  assistant_id uuid not null,
  surface text not null check (surface in ('operator_copilot','website_chat','customer_portal','sms','voice','email')),
  public_site_id uuid null,
  enabled boolean not null default false,
  display_name text not null default 'Assistant' check (length(btrim(display_name)) between 1 and 80),
  greeting text not null default 'Hi — how can I help?' check (length(btrim(greeting)) between 1 and 1000),
  handoff_message text not null default 'Thanks — a member of our team will follow up.' check (length(btrim(handoff_message)) between 1 and 1000),
  handoff_destination text null check (handoff_destination is null or length(btrim(handoff_destination)) <= 500),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id,id), unique (organization_id,assistant_id,surface,public_site_id),
  foreign key (organization_id,assistant_id) references public.ai_assistants(organization_id,id) on delete cascade,
  foreign key (organization_id,public_site_id) references public.public_sites(organization_id,id) on delete cascade,
  check ((surface='website_chat') = (public_site_id is not null))
);

-- Knowledge is opt-in.  This first public surface may cite only a published site; documents,
-- customer data and tool results never enter its prompt.
create table public.ai_assistant_knowledge_sources (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  assistant_id uuid not null, source_kind text not null check (source_kind='published_site'),
  public_site_id uuid not null, created_at timestamptz not null default now(),
  unique (organization_id,assistant_id,source_kind,public_site_id),
  foreign key (organization_id,assistant_id) references public.ai_assistants(organization_id,id) on delete cascade,
  foreign key (organization_id,public_site_id) references public.public_sites(organization_id,id) on delete cascade
);

create table public.communication_threads (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid null, external_actor_id uuid null, public_site_id uuid null,
  channel text not null check (channel in ('web','email','sms','voice')),
  state text not null default 'open' check (state in ('open','handoff_requested','claimed','resolved','closed')),
  visitor_key uuid null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id,id),
  foreign key (organization_id,customer_id) references public.customers(organization_id,id) on delete set null,
  foreign key (organization_id,external_actor_id) references public.external_actors(organization_id,id) on delete set null,
  foreign key (organization_id,public_site_id) references public.public_sites(organization_id,id) on delete set null,
  check (visitor_key is null or channel='web')
);
create unique index communication_threads_public_visitor_unique on public.communication_threads(organization_id,public_site_id,visitor_key) where visitor_key is not null and state in ('open','handoff_requested','claimed');
create index communication_threads_org_updated_idx on public.communication_threads(organization_id,updated_at desc);

create table public.communication_entries (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, thread_id uuid not null,
  channel text not null check (channel in ('web','email','sms','voice')), direction text not null check (direction in ('inbound','outbound','internal')),
  body text not null default '' check (length(body) <= 4000), delivery_state text not null default 'received' check (delivery_state in ('received','queued','sent','failed')),
  created_at timestamptz not null default now(),
  unique (organization_id,id), foreign key (organization_id,thread_id) references public.communication_threads(organization_id,id) on delete cascade
);
create index communication_entries_thread_created_idx on public.communication_entries(organization_id,thread_id,created_at);

alter table public.ai_assistants enable row level security; alter table public.ai_assistants force row level security;
alter table public.ai_assistant_deployments enable row level security; alter table public.ai_assistant_deployments force row level security;
alter table public.ai_assistant_knowledge_sources enable row level security; alter table public.ai_assistant_knowledge_sources force row level security;
alter table public.communication_threads enable row level security; alter table public.communication_threads force row level security;
alter table public.communication_entries enable row level security; alter table public.communication_entries force row level security;
create policy ai_assistants_tenant_read on public.ai_assistants for select to authenticated using (organization_id in (select app.current_tenant_ids()));
create policy ai_deployments_tenant_read on public.ai_assistant_deployments for select to authenticated using (organization_id in (select app.current_tenant_ids()));
create policy ai_knowledge_tenant_read on public.ai_assistant_knowledge_sources for select to authenticated using (organization_id in (select app.current_tenant_ids()));
create policy communication_threads_tenant_read on public.communication_threads for select to authenticated using (organization_id in (select app.current_tenant_ids()));
create policy communication_entries_tenant_read on public.communication_entries for select to authenticated using (organization_id in (select app.current_tenant_ids()));
grant select on public.ai_assistants,public.ai_assistant_deployments,public.ai_assistant_knowledge_sources,public.communication_threads,public.communication_entries to authenticated;

-- Public configuration is a projection of an active website deployment.  It contains no tenant
-- private data and requires a published page before it can be discovered.
create function public.public_assistant_deployment(p_site_id uuid) returns jsonb language sql stable security definer set search_path='' as $fn$
  select jsonb_build_object('deploymentId',d.id,'organizationId',d.organization_id,'displayName',d.display_name,'greeting',d.greeting,'instructions',a.instructions,'handoffMessage',d.handoff_message)
  from public.ai_assistant_deployments d join public.ai_assistants a on a.organization_id=d.organization_id and a.id=d.assistant_id
  join public.public_pages pg on pg.organization_id=d.organization_id and pg.site_id=d.public_site_id
  join public.public_page_revisions r on r.organization_id=pg.organization_id and r.id=pg.current_published_revision_id and r.status='published'
  where d.surface='website_chat' and d.public_site_id=p_site_id and d.enabled and a.status='active' limit 1;
$fn$;
revoke all on function public.public_assistant_deployment(uuid) from public;
grant execute on function public.public_assistant_deployment(uuid) to anon,authenticated;

-- The public route obtains the opaque visitor key from browser storage.  It can append only to
-- the thread keyed by that value; staff retain the only ordinary table read path.
create function public.record_public_communication(p_site_id uuid,p_visitor_key uuid,p_body text)
returns uuid language plpgsql volatile security definer set search_path='' as $fn$
declare v_deployment public.ai_assistant_deployments; v_thread uuid; begin
 if length(btrim(p_body)) not between 1 and 2000 then raise exception 'invalid message' using errcode='22023'; end if;
 select d.* into v_deployment from public.ai_assistant_deployments d join public.ai_assistants a on a.organization_id=d.organization_id and a.id=d.assistant_id where d.public_site_id=p_site_id and d.surface='website_chat' and d.enabled and a.status='active';
 if not found then raise exception 'unavailable' using errcode='42501'; end if;
 insert into public.communication_threads(organization_id,public_site_id,channel,visitor_key) values(v_deployment.organization_id,p_site_id,'web',p_visitor_key)
 on conflict (organization_id,public_site_id,visitor_key) where visitor_key is not null and state in ('open','handoff_requested','claimed') do update set updated_at=now() returning id into v_thread;
 insert into public.communication_entries(organization_id,thread_id,channel,direction,body) values(v_deployment.organization_id,v_thread,'web','inbound',btrim(p_body)); return v_thread;
end $fn$;
create function public.record_public_communication_reply(p_site_id uuid,p_visitor_key uuid,p_body text,p_handoff boolean default false)
returns void language plpgsql volatile security definer set search_path='' as $fn$
declare v_thread public.communication_threads; begin
 if length(btrim(p_body)) not between 1 and 4000 then raise exception 'invalid reply' using errcode='22023'; end if;
 select t.* into v_thread from public.communication_threads t join public.ai_assistant_deployments d on d.organization_id=t.organization_id and d.public_site_id=t.public_site_id where t.public_site_id=p_site_id and t.visitor_key=p_visitor_key and t.state in ('open','handoff_requested','claimed') and d.surface='website_chat' and d.enabled order by t.updated_at desc limit 1;
 if not found then raise exception 'unavailable' using errcode='42501'; end if;
 insert into public.communication_entries(organization_id,thread_id,channel,direction,body,delivery_state) values(v_thread.organization_id,v_thread.id,'web','outbound',btrim(p_body),'sent');
 update public.communication_threads set state=case when p_handoff then 'handoff_requested' else state end,updated_at=now() where id=v_thread.id;
end $fn$;
revoke all on function public.record_public_communication(uuid,uuid,text),public.record_public_communication_reply(uuid,uuid,text,boolean) from public;
grant execute on function public.record_public_communication(uuid,uuid,text),public.record_public_communication_reply(uuid,uuid,text,boolean) to anon,authenticated;

create table public.public_communication_rate_limits (key text primary key, count integer not null, window_started_at timestamptz not null, expires_at timestamptz not null);
alter table public.public_communication_rate_limits enable row level security; alter table public.public_communication_rate_limits force row level security;
-- No policy and no grant to anon/authenticated: reached only through consume_public_communication_rate_limit (security definer), never through PostgREST directly (I1).
create function public.consume_public_communication_rate_limit(p_site_id uuid,p_visitor_key uuid) returns table(allowed boolean,retry_after integer) language plpgsql volatile security definer set search_path='' as $fn$
declare v_key text:=p_site_id::text||':'||p_visitor_key::text; v_row public.public_communication_rate_limits%rowtype; v_now timestamptz:=now(); begin
 delete from public.public_communication_rate_limits where expires_at<=v_now; select * into v_row from public.public_communication_rate_limits where key=v_key for update;
 if not found or v_row.window_started_at<=v_now-interval '1 minute' then insert into public.public_communication_rate_limits(key,count,window_started_at,expires_at) values(v_key,1,v_now,v_now+interval '1 minute') on conflict(key) do update set count=1,window_started_at=excluded.window_started_at,expires_at=excluded.expires_at; return query select true,null::integer; return; end if;
 if v_row.count>=20 then return query select false,greatest(1,ceil(extract(epoch from(v_row.window_started_at+interval '1 minute'-v_now)))::integer); return; end if; update public.public_communication_rate_limits set count=count+1 where key=v_key; return query select true,null::integer;
end $fn$;
revoke all on function public.consume_public_communication_rate_limit(uuid,uuid) from public;
grant execute on function public.consume_public_communication_rate_limit(uuid,uuid) to anon,authenticated;

-- Media is deliberately not operational assets or private document evidence.  It is a governed
-- registry for public-capable image/audio/video bytes, with a private bucket and tenant scope.
create table public.media_assets (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 storage_path text not null check(length(storage_path) between 1 and 1024), file_name text not null check(length(btrim(file_name)) between 1 and 255),
 mime_type text not null check(mime_type like 'image/%' or mime_type like 'video/%' or mime_type like 'audio/%'), size_bytes bigint not null check(size_bytes>0),
 title text null check(title is null or length(btrim(title))<=200), alt_text text null check(alt_text is null or length(btrim(alt_text))<=500),
 visibility text not null default 'private' check(visibility in ('private','public')), created_at timestamptz not null default now(), created_by uuid not null references auth.users(id),
 unique(organization_id,id),unique(organization_id,storage_path)
);
alter table public.media_assets enable row level security; alter table public.media_assets force row level security;
create policy media_assets_tenant_read on public.media_assets for select to authenticated using(organization_id in(select app.current_tenant_ids()));
grant select on public.media_assets to authenticated;
insert into storage.buckets(id,name,public,file_size_limit) values('media','media',false,52428800) on conflict(id) do nothing;
