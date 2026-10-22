create table public.integration_library_actions (
  capability_key text primary key check (length(capability_key) <= 80),
  connector_key text not null references public.platform_connectors(key),
  application_key text not null,
  required_permission text not null,
  input_schema jsonb not null
);
alter table public.integration_library_actions enable row level security;
alter table public.integration_library_actions force row level security;
create policy integration_library_actions_read on public.integration_library_actions for select to authenticated using (true);
grant select on public.integration_library_actions to authenticated;

alter table public.integration_executions drop constraint integration_executions_principal_kind_check;
alter table public.integration_executions add constraint integration_executions_principal_kind_check
  check (principal_kind in ('assistant', 'automation', 'member'));

create table public.integration_library_jobs (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null unique references public.integration_executions(id) on delete cascade,
  organization_id uuid not null,
  connection_id uuid not null,
  capability_key text not null references public.integration_library_actions(capability_key),
  arguments jsonb not null check (jsonb_typeof(arguments) = 'object' and pg_column_size(arguments) <= 24000),
  expires_at timestamptz not null default now() + interval '60 seconds',
  claimed_at timestamptz,
  foreign key (organization_id, connection_id) references public.integration_connections(organization_id,id) on delete cascade
);
alter table public.integration_library_jobs enable row level security;
alter table public.integration_library_jobs force row level security;
revoke all on public.integration_library_jobs from public, anon, authenticated;

create function public.queue_integration_library_read(p_connection_id uuid, p_capability_key text, p_arguments jsonb)
returns uuid language plpgsql security definer set search_path = '' as $fn$
declare c public.integration_connections; a public.integration_library_actions; v_execution uuid; v_job uuid;
begin
  select * into c from public.integration_connections where id=p_connection_id;
  select * into a from public.integration_library_actions where capability_key=p_capability_key;
  if c.id is null or a.capability_key is null or a.connector_key<>c.connector_key or c.status<>'active'
     or c.organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(c.organization_id,'integration.manage')
     or not app.has_capability(c.organization_id,a.required_permission) then
    raise exception 'operation not permitted' using errcode='42501';
  end if;
  insert into public.integration_executions(organization_id,principal_kind,principal_id,invoked_by,target_kind,
    connection_id,connector_key,capability_key,decision,status,started_at,pending_arguments)
  values(c.organization_id,'member',auth.uid(),auth.uid(),'native',c.id,c.connector_key,a.capability_key,'allowed','running',now(),p_arguments)
  returning id into v_execution;
  insert into public.integration_library_jobs(execution_id,organization_id,connection_id,capability_key,arguments)
  values(v_execution,c.organization_id,c.id,a.capability_key,p_arguments) returning id into v_job;
  return v_job;
end;$fn$;
revoke all on function public.queue_integration_library_read(uuid,text,jsonb) from public,anon;
grant execute on function public.queue_integration_library_read(uuid,text,jsonb) to authenticated;

create function public.queue_granted_integration_library_read(p_execution_id uuid,p_arguments jsonb)
returns uuid language plpgsql security definer set search_path='' as $fn$
declare e public.integration_executions; a public.integration_library_actions; v_job uuid;
begin
  select * into e from public.integration_executions where id=p_execution_id for update;
  select * into a from public.integration_library_actions where capability_key=e.capability_key;
  if e.id is null or e.principal_kind not in ('assistant','automation') or e.decision<>'allowed' or e.status<>'running'
     or a.connector_key is distinct from e.connector_key
     or app.integration_execution_blocker(e.organization_id,e.principal_kind,e.principal_id,e.grant_id,e.resource_value,e.invoked_by) is not null then
    raise exception 'operation not permitted' using errcode='42501';
  end if;
  insert into public.integration_library_jobs(execution_id,organization_id,connection_id,capability_key,arguments)
  values(e.id,e.organization_id,e.connection_id,e.capability_key,p_arguments) returning id into v_job;
  return v_job;
end;$fn$;
revoke all on function public.queue_granted_integration_library_read(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.queue_granted_integration_library_read(uuid,jsonb) to integration_operator;

create function public.claim_integration_library_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare j public.integration_library_jobs; e public.integration_executions; c public.integration_connections;
  a public.integration_library_actions; v_secret text;
begin
  select * into j from public.integration_library_jobs where id=p_job_id for update;
  if j.id is null or j.claimed_at is not null or j.expires_at<now() then return null; end if;
  select * into e from public.integration_executions where id=j.execution_id for update;
  select * into c from public.integration_connections where id=j.connection_id;
  select * into a from public.integration_library_actions where capability_key=j.capability_key;
  if c.status is distinct from 'active' or e.status is distinct from 'running' or e.decision is distinct from 'allowed'
     or c.connector_key is distinct from a.connector_key or c.organization_id<>j.organization_id then return null; end if;
  if e.principal_kind='member' then
    if not exists(select 1 from public.memberships m join public.roles r on r.id=m.role_id
      where m.organization_id=j.organization_id and m.user_id=e.invoked_by
        and 'integration.manage'=any(r.capabilities) and a.required_permission=any(r.capabilities)) then return null; end if;
  elsif app.integration_execution_blocker(e.organization_id,e.principal_kind,e.principal_id,e.grant_id,e.resource_value,e.invoked_by) is not null then
    return null;
  end if;
  select secret into v_secret from public.read_integration_credential(c.id);
  if v_secret is null then return null; end if;
  update public.integration_library_jobs set claimed_at=now(), arguments='{}' where id=j.id;
  return jsonb_build_object('id',j.id,'execution_id',e.id,'organization_id',j.organization_id,
    'connector_key',c.connector_key,'capability_key',j.capability_key,'arguments',j.arguments,'secret',v_secret,'principal_kind',e.principal_kind);
end;$fn$;
revoke all on function public.claim_integration_library_job(uuid) from public,anon,authenticated;
grant execute on function public.claim_integration_library_job(uuid) to integration_operator;
create table public.integration_resource_syncs (
  organization_id uuid not null,
  resource_id uuid primary key,
  enabled boolean not null default false,
  parameters jsonb not null default '{}' check(jsonb_typeof(parameters)='object'),
  cursor jsonb not null default '{}' check(jsonb_typeof(cursor)='object'),
  state text not null default 'idle' check(state in ('idle','pending','running','error')),
  generation bigint not null default 0,
  lease_id uuid,
  lease_until timestamptz,
  last_success_at timestamptz,
  last_error text,
  next_run_at timestamptz not null default now(),
  foreign key(organization_id,resource_id) references public.integration_resources(organization_id,id) on delete cascade
);
create table public.integration_resource_records (
  organization_id uuid not null,
  resource_id uuid not null,
  external_id text not null check(length(external_id) between 1 and 500),
  display_name text not null,
  metadata jsonb not null check(pg_column_size(metadata)<=64000),
  content_hash text not null,
  generation bigint not null,
  deleted boolean not null default false,
  source_updated_at timestamptz not null default now(),
  primary key(resource_id,external_id),
  foreign key(organization_id,resource_id) references public.integration_resources(organization_id,id) on delete cascade
);
alter table public.integration_resource_syncs enable row level security;
alter table public.integration_resource_syncs force row level security;
alter table public.integration_resource_records enable row level security;
alter table public.integration_resource_records force row level security;
revoke all on public.integration_resource_syncs,public.integration_resource_records from public,anon,authenticated;
create policy integration_resource_syncs_read on public.integration_resource_syncs for select to authenticated
  using(organization_id in(select app.current_tenant_ids()));
create policy integration_resource_records_read on public.integration_resource_records for select to authenticated
  using(organization_id in(select app.current_tenant_ids()) and exists(select 1 from public.integration_resources r
    where r.id=resource_id and app.has_capability(r.organization_id,
      case when r.resource_type in ('google_calendar','microsoft_calendar') then 'work_item.schedule' else 'document.create' end)));
grant select(organization_id,resource_id,enabled,parameters,state,last_success_at,last_error,next_run_at)
  on public.integration_resource_syncs to authenticated;
grant select on public.integration_resource_records to authenticated;

create function public.configure_integration_resource_sync(p_resource_id uuid,p_enabled boolean,p_parameters jsonb)
returns void language plpgsql security definer set search_path='' as $fn$
declare r public.integration_resources; s public.integration_resource_syncs;
begin
  select * into r from public.integration_resources where id=p_resource_id;
  if r.id is null or r.status<>'active' or r.organization_id not in(select app.current_tenant_ids())
     or not app.has_capability(r.organization_id,'integration.manage')
     or not app.has_capability(r.organization_id,case when r.resource_type in('google_calendar','microsoft_calendar') then 'work_item.schedule' else 'document.create' end)
     or r.resource_type not in('google_calendar','google_drive_folder','google_drive','google_sheet','microsoft_calendar','microsoft_drive_folder','microsoft_drive','microsoft_workbook') then
    raise exception 'resource not permitted' using errcode='42501';
  end if;
  if jsonb_typeof(p_parameters)<>'object' or pg_column_size(p_parameters)>4000
     or exists(select 1 from jsonb_object_keys(p_parameters) k where k not in('range','worksheet','key_column','start','end')) then
    raise exception 'invalid synchronization parameters' using errcode='22023';
  end if;
  select * into s from public.integration_resource_syncs where resource_id=p_resource_id for update;
  if s.lease_until>now() and p_enabled and s.parameters<>p_parameters then
    raise exception 'synchronization is running; try again after it finishes' using errcode='55000';
  end if;
  if p_parameters ? 'key_column' and (jsonb_typeof(p_parameters->'key_column')<>'number' or (p_parameters->>'key_column')::numeric not between 0 and 100 or mod((p_parameters->>'key_column')::numeric,1)<>0) then
    raise exception 'invalid key column' using errcode='22023';
  end if;
  insert into public.integration_resource_syncs(organization_id,resource_id,enabled,parameters)
  values(r.organization_id,r.id,p_enabled,p_parameters)
  on conflict(resource_id) do update set enabled=excluded.enabled, parameters=excluded.parameters,
    cursor=case when public.integration_resource_syncs.parameters<>excluded.parameters then '{}'::jsonb else public.integration_resource_syncs.cursor end,
    state=case when public.integration_resource_syncs.parameters<>excluded.parameters then 'idle' else public.integration_resource_syncs.state end,
    last_success_at=case when public.integration_resource_syncs.parameters<>excluded.parameters then null else public.integration_resource_syncs.last_success_at end,
    next_run_at=now();
end;$fn$;
revoke all on function public.configure_integration_resource_sync(uuid,boolean,jsonb) from public,anon;
grant execute on function public.configure_integration_resource_sync(uuid,boolean,jsonb) to authenticated;

create function public.claim_integration_resource_sync(p_resource_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare s public.integration_resource_syncs; r public.integration_resources; c public.integration_connections; v_lease uuid:=gen_random_uuid();
begin
  select * into s from public.integration_resource_syncs where resource_id=p_resource_id for update;
  select * into r from public.integration_resources where id=p_resource_id;
  select * into c from public.integration_connections where id=r.connection_id;
  if s.resource_id is null or not s.enabled or r.status<>'active' or c.status<>'active' or s.lease_until>now() then return null; end if;
  update public.integration_resource_syncs set state='running',lease_id=v_lease,lease_until=now()+interval '90 seconds',
    generation=case when s.state in ('pending','running','error') then generation else generation+1 end where resource_id=p_resource_id;
  return jsonb_build_object('lease_id',v_lease,'connector_key',c.connector_key,'connection_id',c.id,
    'resource_type',r.resource_type,'external_id',r.external_id,'cursor',s.cursor,'parameters',s.parameters);
end;$fn$;
revoke all on function public.claim_integration_resource_sync(uuid) from public,anon,authenticated;
grant execute on function public.claim_integration_resource_sync(uuid) to integration_operator;

create function public.commit_integration_resource_sync(p_resource_id uuid,p_lease_id uuid,p_records jsonb,
  p_cursor jsonb,p_complete boolean,p_snapshot boolean,p_error text,p_restart boolean default false)
returns void language plpgsql security definer set search_path='' as $fn$
declare s public.integration_resource_syncs; item jsonb;
begin
  select * into s from public.integration_resource_syncs where resource_id=p_resource_id for update;
  if s.resource_id is null or s.lease_id is distinct from p_lease_id or s.lease_until<now() then
    raise exception 'synchronization lease expired' using errcode='42501';
  end if;
  if not exists(select 1 from public.integration_resources r join public.integration_connections c on c.id=r.connection_id
      where r.id=p_resource_id and r.status='active' and c.status='active') then
    raise exception 'source is no longer active' using errcode='42501';
  end if;
  if p_error is null and s.enabled then
    if p_restart then
      update public.integration_resource_syncs set generation=generation+1 where resource_id=p_resource_id returning * into s;
    end if;
    for item in select * from jsonb_array_elements(p_records) loop
      if coalesce((item->>'deleted')::boolean,false) then
        update public.integration_resource_records set deleted=true,source_updated_at=now(),generation=s.generation
          where resource_id=p_resource_id and external_id=item->>'external_id';
      else
        insert into public.integration_resource_records(organization_id,resource_id,external_id,display_name,metadata,content_hash,generation)
        values(s.organization_id,p_resource_id,item->>'external_id',left(item->>'display_name',200),item->'metadata',
          md5((item->'metadata')::text),s.generation)
        on conflict(resource_id,external_id) do update set display_name=excluded.display_name,metadata=excluded.metadata,
          content_hash=excluded.content_hash,generation=excluded.generation,deleted=false,
          source_updated_at=case when public.integration_resource_records.content_hash<>excluded.content_hash or public.integration_resource_records.deleted
            then now() else public.integration_resource_records.source_updated_at end;
      end if;
    end loop;
    if p_complete and p_snapshot then
      update public.integration_resource_records set deleted=true,source_updated_at=now()
      where resource_id=p_resource_id and generation<>s.generation and not deleted;
    end if;
  end if;
  update public.integration_resource_syncs set cursor=case when p_error is null and enabled then p_cursor else cursor end,
    state=case when p_error is not null then 'error' when p_complete then 'idle' else 'pending' end,
    last_success_at=case when p_complete and p_error is null and enabled then now() else last_success_at end,
    last_error=left(p_error,300),lease_id=null,lease_until=null,
    next_run_at=now()+case when not p_complete and p_error is null then interval '1 minute' else interval '15 minutes' end
  where resource_id=p_resource_id;
end;$fn$;
revoke all on function public.commit_integration_resource_sync(uuid,uuid,jsonb,jsonb,boolean,boolean,text,boolean) from public,anon,authenticated;
grant execute on function public.commit_integration_resource_sync(uuid,uuid,jsonb,jsonb,boolean,boolean,text,boolean) to integration_operator;

create function public.due_integration_resource_syncs()
returns table(resource_id uuid) language sql security definer set search_path='' as $fn$
  select resource_id from public.integration_resource_syncs where enabled and next_run_at<=now()
    and (lease_until is null or lease_until<now()) order by next_run_at limit 10;
$fn$;
revoke all on function public.due_integration_resource_syncs() from public,anon,authenticated;
grant execute on function public.due_integration_resource_syncs() to integration_operator;

-- Generated from the installed open-source library by library/seed.mjs.
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('airtable','Airtable','Low‒code platform to build apps.','CRM & Sales','beta','api_key','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('asana','Asana','Work management platform designed to help teams organize, track, and manage their work.','Project Management','beta','oauth2','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('clickup','ClickUp','All-in-one productivity platform','Project Management','beta','oauth2','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('discord','Discord','Instant messaging and VoIP social platform','Communications','beta','api_key','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('dropbox','Dropbox','Cloud storage and file synchronization','Files & Cloud Storage','beta','oauth2','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('github','GitHub','Developer platform that allows developers to create, store, manage and share their code','Developer Tools','beta','oauth2','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('gitlab','GitLab','Collaboration tool for developers','Developer Tools','beta','oauth2','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('google_workspace','Google Workspace','Create, edit, and collaborate on spreadsheets online','Documents & Productivity','beta','oauth2','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('hubspot','HubSpot','Powerful CRM that offers tools for sales, customer service, and marketing automation.','CRM & Sales','beta','oauth2','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('intercom','Intercom','Customer messaging platform for sales, marketing, and support','Customer Support','beta','api_key','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('linear','Linear','Issue tracking for modern software teams','Customer Support','beta','api_key','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('mailchimp','Mailchimp','All-in-One integrated marketing platform for managing audiences, sending campaigns, tracking engagement, and automating lifecycle communications.','Marketing & Advertising','beta','oauth2','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('microsoft_365','Microsoft 365','','Communications','beta','oauth2','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('notion','Notion','The all-in-one workspace','Documents & Productivity','beta','oauth2','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('openai','OpenAI','Chat, images, audio and embeddings from OpenAI models.','AI & Agents','beta','api_key','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('pipedrive','Pipedrive','Sales CRM and pipeline management software','CRM & Sales','beta','oauth2','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('quickbooks','Quickbooks Online','','Accounting & Finance','beta','api_key','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('salesforce','Salesforce','CRM software solutions and enterprise cloud computing','CRM & Sales','beta','api_key','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('shopify','Shopify','Ecommerce platform for online stores','Commerce','beta','api_key','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('slack','Slack','Channel-based messaging platform','Communications','beta','oauth2','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('square','Square','Payment solutions for every business','Payments','beta','oauth2','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('stripe','Stripe','Online payment processing for internet businesses','Payments','beta','api_key','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('telegram_bot','Telegram Bot','Build chatbots for Telegram','Communications','beta','api_key','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('trello','Trello','Project management tool for teams','Project Management','beta','api_key','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('woocommerce','WooCommerce','E-commerce platform built on WordPress','Commerce','beta','api_key','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('wordpress','WordPress','Open-source website creation software','Website & Content Management','beta','api_key','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('xero','Xero','Beautiful accounting software','Accounting & Finance','beta','oauth2','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values('zendesk','Zendesk','Customer service software and support ticket system','Customer Support','beta','api_key','native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;
insert into public.integration_library_actions values('piece.airtable.get_record','airtable','airtable','customer.update','{"type":"object","properties":{"base_id":{"type":"string","description":"Base ID","maxLength":2000},"table_id_or_name":{"type":"string","description":"Table ID or Name","maxLength":2000},"record_id":{"type":"string","description":"Record ID","maxLength":2000}},"required":["base_id","table_id_or_name","record_id"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.airtable.get_record','customer.update') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.airtable.list_records','airtable','airtable','customer.update','{"type":"object","properties":{"base_id":{"type":"string","description":"Base ID","maxLength":2000},"table_id_or_name":{"type":"string","description":"Table ID or Name","maxLength":2000},"filter_by_formula":{"type":"string","description":"Filter By Formula","maxLength":2000},"view":{"type":"string","description":"View","maxLength":2000},"max_records":{"type":"number","description":"Max Records"},"page_size":{"type":"number","description":"Page Size"},"sort":{"type":"object","description":"Sort"},"fields":{"type":"array","description":"Fields"}},"required":["base_id","table_id_or_name"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.airtable.list_records','customer.update') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.airtable.list_bases','airtable','airtable','customer.update','{"type":"object","properties":{},"required":[],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.airtable.list_bases','customer.update') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.airtable.get_current_user','airtable','airtable','customer.update','{"type":"object","properties":{},"required":[],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.airtable.get_current_user','customer.update') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.asana.get_current_user','asana','asana','integration.manage','{"type":"object","properties":{},"required":[],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.asana.get_current_user','integration.manage') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.asana.get_task','asana','asana','integration.manage','{"type":"object","properties":{"task":{"type":"string","description":"Task GID","maxLength":2000}},"required":["task"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.asana.get_task','integration.manage') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.asana.list_projects','asana','asana','integration.manage','{"type":"object","properties":{"workspace":{"type":"string","description":"Workspace GID","maxLength":2000},"archived":{"type":"string","description":"Archived","maxLength":2000},"limit":{"type":"number","description":"Limit"},"offset":{"type":"string","description":"Offset","maxLength":2000}},"required":["workspace"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.asana.list_projects','integration.manage') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.github.list_my_repositories','github','github','integration.manage','{"type":"object","properties":{"visibility":{"type":"string","description":"Visibility","maxLength":2000},"affiliation":{"type":"string","description":"Affiliation","maxLength":2000},"sort":{"type":"string","description":"Sort","maxLength":2000}},"required":[],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.github.list_my_repositories','integration.manage') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.github.get_file_content','github','github','integration.manage','{"type":"object","properties":{"owner":{"type":"string","description":"Owner","maxLength":2000},"repo":{"type":"string","description":"Repository","maxLength":2000},"path":{"type":"string","description":"Path","maxLength":2000},"ref":{"type":"string","description":"Ref","maxLength":2000}},"required":["owner","repo","path"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.github.get_file_content','integration.manage') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.google_calendar.google_calendar_get_event','google_workspace','google-calendar','work_item.schedule','{"type":"object","properties":{"calendar_id":{"type":"string","description":"Calendar","maxLength":2000},"event_id":{"type":"string","description":"Event ID","maxLength":2000},"max_attendees":{"type":"number","description":"Max Attendees"},"time_zone":{"type":"string","description":"Time Zone","maxLength":2000}},"required":["calendar_id","event_id"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.google_calendar.google_calendar_get_event','work_item.schedule') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.google_calendar.google_calendar_list_events','google_workspace','google-calendar','work_item.schedule','{"type":"object","properties":{"calendar_id":{"type":"string","description":"Calendar","maxLength":2000},"event_types":{"type":"array","description":"Event Types","default":["default","focusTime","outOfOffice"]},"search":{"type":"string","description":"Search Term","maxLength":2000},"start_date":{"type":"string","description":"Start Time","maxLength":2000},"end_date":{"type":"string","description":"End Time","maxLength":2000},"singleEvents":{"type":"boolean","description":"Expand Recurring Events","default":false}},"required":["calendar_id"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.google_calendar.google_calendar_list_events','work_item.schedule') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.google_calendar.google_calendar_list_calendars','google_workspace','google-calendar','work_item.schedule','{"type":"object","properties":{},"required":[],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.google_calendar.google_calendar_list_calendars','work_item.schedule') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.google_contacts.search_contacts','google_workspace','google-contacts','customer.update','{"type":"object","properties":{"query":{"type":"string","description":"Query","maxLength":2000},"pageSize":{"type":"number","description":"Page Size"}},"required":["query"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.google_contacts.search_contacts','customer.update') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.google_drive.drive_get_file','google_workspace','google-drive','document.create','{"type":"object","properties":{"file_id":{"type":"string","description":"File / Folder ID","maxLength":2000}},"required":["file_id"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.google_drive.drive_get_file','document.create') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.google_drive.drive_list_files','google_workspace','google-drive','document.create','{"type":"object","properties":{"folder_id":{"type":"string","description":"Folder ID","maxLength":2000},"include_trashed":{"type":"boolean","description":"Include Trashed","default":false},"depth_level":{"type":"number","description":"Depth Level","default":1},"download_files":{"type":"boolean","description":"Download Files","default":false},"include_team_drives":{"type":"boolean","description":"Include Team Drives","default":false}},"required":["folder_id"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.google_drive.drive_list_files','document.create') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.google_drive.drive_search_files','google_workspace','google-drive','document.create','{"type":"object","properties":{"query_term":{"type":"string","description":"Query Term","maxLength":2000,"default":"name"},"operator":{"type":"string","description":"Operator","maxLength":2000,"default":"contains"},"value":{"type":"string","description":"Value","maxLength":2000},"type":{"type":"string","description":"File Type","maxLength":2000,"default":"all"},"parent_folder_id":{"type":"string","description":"Parent Folder ID","maxLength":2000},"include_team_drives":{"type":"boolean","description":"Include Team Drives","default":false}},"required":["value"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.google_drive.drive_search_files','document.create') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.google_drive.drive_list_shared_drives','google_workspace','google-drive','document.create','{"type":"object","properties":{"query":{"type":"string","description":"Query","maxLength":2000},"page_size":{"type":"number","description":"Page Size"}},"required":[],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.google_drive.drive_list_shared_drives','document.create') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.google_sheets.sheets_get_all_rows','google_workspace','google-sheets','document.create','{"type":"object","properties":{"spreadsheet_id":{"type":"string","description":"Spreadsheet ID","maxLength":2000},"sheet_id":{"type":"number","description":"Worksheet ID"},"first_row_headers":{"type":"boolean","description":"First Row Headers","default":true}},"required":["spreadsheet_id","sheet_id"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.google_sheets.sheets_get_all_rows','document.create') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.google_sheets.sheets_get_row','google_workspace','google-sheets','document.create','{"type":"object","properties":{"spreadsheet_id":{"type":"string","description":"Spreadsheet ID","maxLength":2000},"sheet_id":{"type":"number","description":"Worksheet ID"},"row_number":{"type":"number","description":"Row Number"},"header_row":{"type":"number","description":"Header Row Number","default":1},"use_header_names":{"type":"boolean","description":"Use Column Names","default":true}},"required":["spreadsheet_id","sheet_id","row_number"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.google_sheets.sheets_get_row','document.create') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.google_sheets.sheets_get_spreadsheet','google_workspace','google-sheets','document.create','{"type":"object","properties":{"spreadsheet_id":{"type":"string","description":"Spreadsheet ID","maxLength":2000},"include_grid_data":{"type":"boolean","description":"Include Grid Data","default":false}},"required":["spreadsheet_id"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.google_sheets.sheets_get_spreadsheet','document.create') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.google_sheets.sheets_get_values','google_workspace','google-sheets','document.create','{"type":"object","properties":{"spreadsheet_id":{"type":"string","description":"Spreadsheet ID","maxLength":2000},"worksheet_title":{"type":"string","description":"Worksheet Title","maxLength":2000},"range":{"type":"string","description":"Range (A1 Notation)","maxLength":2000},"major_dimension":{"type":"string","description":"Major Dimension","maxLength":2000,"default":"ROWS"},"value_render_option":{"type":"string","description":"Value Render Option","maxLength":2000,"default":"FORMATTED_VALUE"}},"required":["spreadsheet_id","worksheet_title"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.google_sheets.sheets_get_values','document.create') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.google_sheets.sheets_search_spreadsheets','google_workspace','google-sheets','document.create','{"type":"object","properties":{"spreadsheet_name":{"type":"string","description":"Spreadsheet Name","maxLength":2000},"exact_match":{"type":"boolean","description":"Exact Match","default":false}},"required":["spreadsheet_name"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.google_sheets.sheets_search_spreadsheets','document.create') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.hubspot.get-company','hubspot','hubspot','customer.update','{"type":"object","properties":{"companyId":{"type":"string","description":"Company ID","maxLength":2000},"additionalPropertiesToRetrieve":{"type":"array","description":"Additional Properties to Retrieve"}},"required":["companyId"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.hubspot.get-company','customer.update') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.hubspot.get-contact','hubspot','hubspot','customer.update','{"type":"object","properties":{"contactId":{"type":"string","description":"Contact ID","maxLength":2000},"additionalPropertiesToRetrieve":{"type":"array","description":"Additional Properties to Retrieve"}},"required":["contactId"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.hubspot.get-contact','customer.update') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.hubspot.find-company','hubspot','hubspot','customer.update','{"type":"object","properties":{"firstSearchPropertyName":{"type":"string","description":"Search Property","maxLength":2000},"firstSearchPropertyValue":{"type":"string","description":"Search Value","maxLength":2000},"secondSearchPropertyName":{"type":"string","description":"Second Search Property","maxLength":2000},"secondSearchPropertyValue":{"type":"string","description":"Second Search Value","maxLength":2000},"additionalPropertiesToRetrieve":{"type":"array","description":"Additional Properties to Retrieve"}},"required":["firstSearchPropertyName","firstSearchPropertyValue"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.hubspot.find-company','customer.update') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.hubspot.find-contact','hubspot','hubspot','customer.update','{"type":"object","properties":{"firstSearchPropertyName":{"type":"string","description":"Search Property","maxLength":2000},"firstSearchPropertyValue":{"type":"string","description":"Search Value","maxLength":2000},"secondSearchPropertyName":{"type":"string","description":"Second Search Property","maxLength":2000},"secondSearchPropertyValue":{"type":"string","description":"Second Search Value","maxLength":2000},"additionalPropertiesToRetrieve":{"type":"array","description":"Additional Properties to Retrieve"}},"required":["firstSearchPropertyName","firstSearchPropertyValue"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.hubspot.find-contact','customer.update') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.microsoft_excel_365.get_worksheets','microsoft_365','microsoft-excel-365','document.create','{"type":"object","properties":{"storageSource":{"type":"string","description":"Excel File Source","maxLength":2000,"default":"onedrive"},"siteId":{"type":"string","description":"Sharepoint Site","maxLength":2000},"documentId":{"type":"string","description":"Sharepoint Document Library","maxLength":2000},"workbookId":{"type":"string","description":"Workbook","maxLength":2000},"returnAll":{"type":"boolean","description":"Return All","default":false},"limit":{"type":"number","description":"Limit","default":10}},"required":["workbookId"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.microsoft_excel_365.get_worksheets','document.create') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.microsoft_excel_365.get_worksheet_rows','microsoft_365','microsoft-excel-365','document.create','{"type":"object","properties":{"storageSource":{"type":"string","description":"Excel File Source","maxLength":2000,"default":"onedrive"},"siteId":{"type":"string","description":"Sharepoint Site","maxLength":2000},"documentId":{"type":"string","description":"Sharepoint Document Library","maxLength":2000},"workbookId":{"type":"string","description":"Workbook","maxLength":2000},"worksheetId":{"type":"string","description":"Worksheet","maxLength":2000},"range":{"type":"string","description":"Range","maxLength":2000},"headerRow":{"type":"number","description":"Header Row"},"firstDataRow":{"type":"number","description":"First Data Row"},"useFilter":{"type":"boolean","description":"Use Filters ?","default":false},"filterList":{"type":"string","description":"Filter","maxLength":2000}},"required":["workbookId","worksheetId"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.microsoft_excel_365.get_worksheet_rows','document.create') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.microsoft_excel_365.get_workbooks','microsoft_365','microsoft-excel-365','document.create','{"type":"object","properties":{"storageSource":{"type":"string","description":"Excel File Source","maxLength":2000,"default":"onedrive"},"siteId":{"type":"string","description":"Sharepoint Site","maxLength":2000},"documentId":{"type":"string","description":"Sharepoint Document Library","maxLength":2000},"limit":{"type":"number","description":"Limit"}},"required":[],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.microsoft_excel_365.get_workbooks','document.create') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.microsoft_excel_365.get_range','microsoft_365','microsoft-excel-365','document.create','{"type":"object","properties":{"storageSource":{"type":"string","description":"Excel File Source","maxLength":2000,"default":"onedrive"},"siteId":{"type":"string","description":"Sharepoint Site","maxLength":2000},"documentId":{"type":"string","description":"Sharepoint Document Library","maxLength":2000},"workbookId":{"type":"string","description":"Workbook","maxLength":2000},"worksheetId":{"type":"string","description":"Worksheet","maxLength":2000},"range":{"type":"string","description":"Range","maxLength":2000}},"required":["workbookId","worksheetId","range"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.microsoft_excel_365.get_range','document.create') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.microsoft_onedrive.onedrive_get_item','microsoft_365','microsoft-onedrive','document.create','{"type":"object","properties":{"itemId":{"type":"string","description":"Item ID","maxLength":2000},"path":{"type":"string","description":"Path","maxLength":2000}},"required":[],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.microsoft_onedrive.onedrive_get_item','document.create') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.microsoft_onedrive.onedrive_list_drives','microsoft_365','microsoft-onedrive','document.create','{"type":"object","properties":{"pageToken":{"type":"string","description":"Page Token","maxLength":2000}},"required":[],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.microsoft_onedrive.onedrive_list_drives','document.create') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.microsoft_onedrive.onedrive_list_folder_children','microsoft_365','microsoft-onedrive','document.create','{"type":"object","properties":{"folderId":{"type":"string","description":"Folder ID","maxLength":2000},"folderPath":{"type":"string","description":"Folder Path","maxLength":2000},"itemType":{"type":"string","description":"Item Type","maxLength":2000,"default":"all"},"pageSize":{"type":"number","description":"Page Size"},"pageToken":{"type":"string","description":"Page Token","maxLength":2000}},"required":[],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.microsoft_onedrive.onedrive_list_folder_children','document.create') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.microsoft_outlook_calendar.list_events','microsoft_365','microsoft-outlook-calendar','work_item.schedule','{"type":"object","properties":{"calendarId":{"type":"string","description":"Calendar","maxLength":2000},"filter":{"type":"string","description":"Filter","maxLength":2000}},"required":["calendarId"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.microsoft_outlook_calendar.list_events','work_item.schedule') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.pipedrive.get-deal','pipedrive','pipedrive','customer.update','{"type":"object","properties":{"dealId":{"type":"number","description":"Deal ID"}},"required":["dealId"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.pipedrive.get-deal','customer.update') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.pipedrive.list-deals','pipedrive','pipedrive','customer.update','{"type":"object","properties":{"ownerId":{"type":"number","description":"Owner ID"},"personId":{"type":"number","description":"Person ID"},"organizationId":{"type":"number","description":"Organization ID"},"pipelineId":{"type":"number","description":"Pipeline ID"},"stageId":{"type":"number","description":"Stage ID"},"status":{"type":"string","description":"Status","maxLength":2000},"updatedSince":{"type":"string","description":"Updated Since","maxLength":2000},"updatedUntil":{"type":"string","description":"Updated Until","maxLength":2000},"sortBy":{"type":"string","description":"Sort By","maxLength":2000},"sortDirection":{"type":"string","description":"Sort Direction","maxLength":2000},"limit":{"type":"number","description":"Limit","default":50},"cursor":{"type":"string","description":"Cursor","maxLength":2000}},"required":[],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.pipedrive.list-deals','customer.update') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.pipedrive.get-person','pipedrive','pipedrive','customer.update','{"type":"object","properties":{"personId":{"type":"number","description":"Person ID"}},"required":["personId"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.pipedrive.get-person','customer.update') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.pipedrive.list-persons','pipedrive','pipedrive','customer.update','{"type":"object","properties":{"ownerId":{"type":"number","description":"Owner ID"},"organizationId":{"type":"number","description":"Organization ID"},"dealId":{"type":"number","description":"Deal ID"},"updatedSince":{"type":"string","description":"Updated Since","maxLength":2000},"updatedUntil":{"type":"string","description":"Updated Until","maxLength":2000},"sortBy":{"type":"string","description":"Sort By","maxLength":2000},"sortDirection":{"type":"string","description":"Sort Direction","maxLength":2000},"limit":{"type":"number","description":"Limit","default":50},"cursor":{"type":"string","description":"Cursor","maxLength":2000}},"required":[],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.pipedrive.list-persons','customer.update') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.quickbooks.find_invoice','quickbooks','quickbooks','report.read','{"type":"object","properties":{"invoice_number":{"type":"string","description":"Invoice Number","maxLength":2000}},"required":["invoice_number"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.quickbooks.find_invoice','report.read') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.quickbooks.find_customer','quickbooks','quickbooks','report.read','{"type":"object","properties":{"search_term":{"type":"string","description":"Customer Name","maxLength":2000}},"required":["search_term"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.quickbooks.find_customer','report.read') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.salesforce.find_record','salesforce','salesforce','customer.update','{"type":"object","properties":{"object":{"type":"string","description":"Object","maxLength":2000},"field":{"type":"string","description":"Field","maxLength":2000},"search_value":{"type":"string","description":"Search Value","maxLength":2000}},"required":["object","field","search_value"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.salesforce.find_record','customer.update') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.salesforce.run_query','salesforce','salesforce','customer.update','{"type":"object","properties":{"query":{"type":"string","description":"Query","maxLength":2000}},"required":["query"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.salesforce.run_query','customer.update') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.shopify.get_customer','shopify','shopify','report.read','{"type":"object","properties":{"customerId":{"type":"string","description":"Customer ID","maxLength":2000}},"required":["customerId"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.shopify.get_customer','report.read') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.shopify.get_customers','shopify','shopify','report.read','{"type":"object","properties":{},"required":[],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.shopify.get_customers','report.read') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.shopify.get_order','shopify','shopify','report.read','{"type":"object","properties":{"order_id":{"type":"string","description":"Order ID","maxLength":2000}},"required":["order_id"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.shopify.get_order','report.read') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.shopify.get_shop','shopify','shopify','report.read','{"type":"object","properties":{},"required":[],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.shopify.get_shop','report.read') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.shopify.search_orders','shopify','shopify','report.read','{"type":"object","properties":{"query":{"type":"string","description":"Search Query","maxLength":2000},"sort_key":{"type":"string","description":"Sort By","maxLength":2000},"reverse":{"type":"boolean","description":"Reverse Order","default":false},"first":{"type":"number","description":"Page Size","default":40},"after":{"type":"string","description":"Cursor","maxLength":2000}},"required":[],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.shopify.search_orders','report.read') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.square.get_merchant','square','square','report.read','{"type":"object","properties":{},"required":[],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.square.get_merchant','report.read') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.square.list_payments','square','square','report.read','{"type":"object","properties":{"location_id":{"type":"string","description":"Location ID","maxLength":2000},"begin_time":{"type":"string","description":"Created After","maxLength":2000},"end_time":{"type":"string","description":"Created Before","maxLength":2000},"limit":{"type":"number","description":"Limit","default":50},"cursor":{"type":"string","description":"Cursor","maxLength":2000}},"required":[],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.square.list_payments','report.read') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.stripe.get_customer','stripe','stripe','report.read','{"type":"object","properties":{"id":{"type":"string","description":"Customer ID","maxLength":2000}},"required":["id"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.stripe.get_customer','report.read') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.stripe.get_invoice','stripe','stripe','report.read','{"type":"object","properties":{"invoice_id":{"type":"string","description":"Invoice ID","maxLength":2000}},"required":["invoice_id"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.stripe.get_invoice','report.read') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.stripe.list_customers','stripe','stripe','report.read','{"type":"object","properties":{"email":{"type":"string","description":"Email","maxLength":2000},"limit":{"type":"number","description":"Limit"},"starting_after":{"type":"string","description":"Starting After","maxLength":2000}},"required":[],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.stripe.list_customers','report.read') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.stripe.list_payment_intents','stripe','stripe','report.read','{"type":"object","properties":{"customer":{"type":"string","description":"Customer ID","maxLength":2000},"created_after":{"type":"string","description":"Created After","maxLength":2000},"created_before":{"type":"string","description":"Created Before","maxLength":2000},"limit":{"type":"number","description":"Limit"},"starting_after":{"type":"string","description":"Starting After","maxLength":2000}},"required":[],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.stripe.list_payment_intents','report.read') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.stripe.list_charges','stripe','stripe','report.read','{"type":"object","properties":{"customer":{"type":"string","description":"Customer ID","maxLength":2000},"payment_intent":{"type":"string","description":"Payment Intent ID","maxLength":2000},"created_after":{"type":"string","description":"Created After","maxLength":2000},"created_before":{"type":"string","description":"Created Before","maxLength":2000},"limit":{"type":"number","description":"Limit"}},"required":[],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.stripe.list_charges','report.read') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.stripe.list_invoices','stripe','stripe','report.read','{"type":"object","properties":{"customer":{"type":"string","description":"Customer ID","maxLength":2000},"status":{"type":"string","description":"Status","maxLength":2000},"subscription":{"type":"string","description":"Subscription ID","maxLength":2000},"limit":{"type":"number","description":"Limit"}},"required":[],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.stripe.list_invoices','report.read') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.stripe.list_payouts','stripe','stripe','report.read','{"type":"object","properties":{"status":{"type":"string","description":"Status","maxLength":2000},"arrival_date_after":{"type":"string","description":"Arrival Date After","maxLength":2000},"arrival_date_before":{"type":"string","description":"Arrival Date Before","maxLength":2000},"limit":{"type":"number","description":"Limit"}},"required":[],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.stripe.list_payouts','report.read') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.trello.get_card','trello','trello','integration.manage','{"type":"object","properties":{"cardId":{"type":"string","description":"Card ID","maxLength":2000}},"required":["cardId"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.trello.get_card','integration.manage') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.trello.get_board','trello','trello','integration.manage','{"type":"object","properties":{"board_id":{"type":"string","description":"Board ID","maxLength":2000}},"required":["board_id"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.trello.get_board','integration.manage') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.woocommerce.list_customers','woocommerce','woocommerce','report.read','{"type":"object","properties":{"email":{"type":"string","description":"Email","maxLength":2000},"search":{"type":"string","description":"Search","maxLength":2000},"role":{"type":"string","description":"Role","maxLength":2000,"default":"all"},"orderby":{"type":"string","description":"Sort By","maxLength":2000},"order":{"type":"string","description":"Sort Direction","maxLength":2000},"page":{"type":"number","description":"Page","default":1},"per_page":{"type":"number","description":"Per Page","default":10}},"required":[],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.woocommerce.list_customers','report.read') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.woocommerce.list_orders','woocommerce','woocommerce','report.read','{"type":"object","properties":{"status":{"type":"string","description":"Status","maxLength":2000},"customer_id":{"type":"number","description":"Customer ID"},"product_id":{"type":"number","description":"Product ID"},"search":{"type":"string","description":"Search","maxLength":2000},"after":{"type":"string","description":"Created After","maxLength":2000},"before":{"type":"string","description":"Created Before","maxLength":2000},"orderby":{"type":"string","description":"Sort By","maxLength":2000},"order":{"type":"string","description":"Sort Direction","maxLength":2000},"page":{"type":"number","description":"Page","default":1},"per_page":{"type":"number","description":"Per Page","default":10}},"required":[],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.woocommerce.list_orders','report.read') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.xero.xero_find_contact','xero','xero','report.read','{"type":"object","properties":{"tenant_id":{"type":"string","description":"Organization","maxLength":2000},"search_by":{"type":"string","description":"Search By","maxLength":2000,"default":"NAME"},"value":{"type":"string","description":"Value","maxLength":2000},"include_archived":{"type":"boolean","description":"Include Archived","default":false},"summary_only":{"type":"boolean","description":"Summary Only (faster, lighter)","default":true},"page":{"type":"number","description":"Page"}},"required":["tenant_id","value"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.xero.xero_find_contact','report.read') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.xero.xero_find_invoice','xero','xero','report.read','{"type":"object","properties":{"tenant_id":{"type":"string","description":"Organization","maxLength":2000},"search_by":{"type":"string","description":"Search By","maxLength":2000,"default":"INVOICE_NUMBER"},"value":{"type":"string","description":"Value","maxLength":2000},"type_filter":{"type":"string","description":"Type Filter","maxLength":2000},"summary_only":{"type":"boolean","description":"Summary Only (faster, lighter)","default":true},"page":{"type":"number","description":"Page"}},"required":["tenant_id","value"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.xero.xero_find_invoice','report.read') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.xero.xero_list_organisations','xero','xero','report.read','{"type":"object","properties":{},"required":[],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.xero.xero_list_organisations','report.read') on conflict(capability_key) do nothing;
insert into public.integration_library_actions values('piece.xero.xero_get_invoice','xero','xero','report.read','{"type":"object","properties":{"tenant_id":{"type":"string","description":"Organization","maxLength":2000},"invoice_id":{"type":"string","description":"Invoice ID or Number","maxLength":2000}},"required":["tenant_id","invoice_id"],"additionalProperties":false}'::jsonb);
insert into public.integration_capability_permissions values('piece.xero.xero_get_invoice','report.read') on conflict(capability_key) do nothing;
