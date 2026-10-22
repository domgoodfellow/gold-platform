-- Marketing owns intent and acquisition; Studio keeps responses and CRM keeps identities.
do $$
declare caps text[];
begin
  select array_agg(distinct capability) into caps from pg_constraint c,
    lateral regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g') m
    cross join lateral unnest(case when left(m[1],1)='{' then m[1]::text[] else array[m[1]] end) capability
    where c.conrelid='public.roles'::regclass and c.conname='roles_capabilities_known';
  alter table public.roles drop constraint roles_capabilities_known;
  caps := caps || array['marketing.read','marketing.manage'];
  execute format('alter table public.roles add constraint roles_capabilities_known check (capabilities <@ array[%s]::text[])',
    (select string_agg(quote_literal(v),',' order by v) from unnest(caps) v));
  update public.roles set capabilities = array(select distinct v from unnest(capabilities || array['marketing.read','marketing.manage']) v)
    where 'organization.manage'=any(capabilities);
end $$;

create unique index if not exists memberships_org_id_unique on public.memberships(organization_id,id);
create table public.marketing_campaigns (
  organization_id uuid not null references public.organizations(id),
  id uuid not null default gen_random_uuid(),
  name text not null check(length(btrim(name)) between 1 and 160),
  objective text not null check(objective in ('lead_generation','engagement','reengagement','awareness')),
  description text not null default '' check(length(description)<=4000),
  status text not null default 'draft' check(status in ('draft','active','paused','completed','archived')),
  planned_start_on date, planned_end_on date,
  owner_membership_id uuid,
  landing_site_id uuid, landing_revision_id uuid, landing_page_id uuid,
  channels text[] not null default '{}' check(channels <@ array['website','form','email','sms','manual']::text[]),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  primary key(organization_id,id),
  foreign key(organization_id,owner_membership_id) references public.memberships(organization_id,id),
  foreign key(organization_id,landing_site_id,landing_revision_id) references public.public_site_revisions(organization_id,site_id,id),
  check ((landing_site_id is null and landing_revision_id is null and landing_page_id is null) or (landing_site_id is not null and landing_revision_id is not null and landing_page_id is not null)),
  check(planned_end_on >= planned_start_on), check((status='archived')=(archived_at is not null))
);
create table public.marketing_audiences (
  organization_id uuid not null references public.organizations(id), id uuid not null default gen_random_uuid(),
  name text not null check(length(btrim(name)) between 1 and 160), description text not null default '' check(length(description)<=2000),
  definition_version integer not null default 1 check(definition_version=1),
  stage_id uuid, created_from date, created_before date,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(organization_id,id),
  foreign key(organization_id,stage_id) references public.customer_stages(organization_id,id),
  check(created_before >= created_from)
);
create table public.marketing_campaign_audiences (
  organization_id uuid not null, campaign_id uuid not null, audience_id uuid not null,
  primary key(organization_id,campaign_id,audience_id),
  foreign key(organization_id,campaign_id) references public.marketing_campaigns(organization_id,id),
  foreign key(organization_id,audience_id) references public.marketing_audiences(organization_id,id)
);
create table public.marketing_campaign_forms (
  organization_id uuid not null, campaign_id uuid not null, form_id uuid not null,
  token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  primary key(organization_id,campaign_id,form_id),
  unique(organization_id,token),
  foreign key(organization_id,campaign_id) references public.marketing_campaigns(organization_id,id),
  foreign key(organization_id,form_id) references public.forms(organization_id,id)
);
create unique index if not exists form_submissions_org_form_id_unique on public.form_submissions(organization_id,form_id,id);
create table public.marketing_inquiries (
  organization_id uuid not null, id uuid not null default gen_random_uuid(),
  campaign_id uuid, submission_id uuid not null, form_id uuid not null,
  source text not null, source_context jsonb not null default '{}' check(octet_length(source_context::text)<=2000),
  campaign_name_at_capture text, form_name_at_capture text not null,
  occurred_at timestamptz not null, created_at timestamptz not null default now(),
  status text not null default 'new' check(status in ('new','in_review','handed_off','disqualified')),
  customer_id uuid, reviewed_by uuid references auth.users(id), reviewed_at timestamptz, handed_off_at timestamptz,
  primary key(organization_id,id), unique(organization_id,submission_id),
  foreign key(organization_id,campaign_id) references public.marketing_campaigns(organization_id,id),
  foreign key(organization_id,form_id) references public.forms(organization_id,id),
  foreign key(organization_id,form_id,submission_id) references public.form_submissions(organization_id,form_id,id),
  foreign key(organization_id,customer_id) references public.customers(organization_id,id),
  check((status='handed_off')=(handed_off_at is not null)), check(status<>'handed_off' or customer_id is not null)
);
create index marketing_campaigns_status on public.marketing_campaigns(organization_id,status,created_at desc);
create index marketing_inquiries_period on public.marketing_inquiries(organization_id,occurred_at desc,id);
create index marketing_inquiries_campaign on public.marketing_inquiries(organization_id,campaign_id,occurred_at desc);
create index marketing_inquiries_review on public.marketing_inquiries(organization_id,status,handed_off_at);

do $$ declare t text; begin
  foreach t in array array['marketing_campaigns','marketing_audiences','marketing_campaign_audiences','marketing_campaign_forms','marketing_inquiries'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy marketing_read on public.%I for select to authenticated using (app.has_capability(organization_id,''marketing.read'') or app.has_capability(organization_id,''marketing.manage''))',t);
  end loop;
end $$;

create function app.require_marketing(p_org uuid, p_write boolean default false) returns uuid
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not (app.has_capability(p_org,'marketing.manage') or
    (not p_write and app.has_capability(p_org,'marketing.read'))) then
    raise exception 'Marketing permission required' using errcode='42501';
  end if;
  return auth.uid();
end $$;
revoke all on function app.require_marketing(uuid,boolean) from public,anon,authenticated;

-- All writes go through this capability checked, tenant-scoped command surface.
create or replace function public.marketing_command(p_organization_id uuid,p_command text,p_input jsonb) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; result uuid; c public.marketing_campaigns; i public.marketing_inquiries; target text; customer uuid;
begin
  actor := app.require_marketing(p_organization_id,true);
  if p_command in ('campaign.create','campaign.edit','campaign.status','campaign.form','campaign.audience','campaign.page') then
    result := coalesce((p_input->>'id')::uuid,gen_random_uuid());
    if p_command <> 'campaign.create' then
      select * into c from public.marketing_campaigns where organization_id=p_organization_id and id=result for update;
      if not found then raise exception 'Campaign not found' using errcode='P0002'; end if;
      if c.status='archived' then raise exception 'Archived campaigns are immutable'; end if;
    end if;
    if p_command='campaign.create' then
      insert into public.marketing_campaigns(organization_id,id,name,objective,description,planned_start_on,planned_end_on,owner_membership_id,channels,created_by)
      values(p_organization_id,result,btrim(p_input->>'name'),p_input->>'objective',coalesce(p_input->>'description',''),nullif(p_input->>'start','')::date,
        nullif(p_input->>'end','')::date,nullif(p_input->>'owner','')::uuid,array(select jsonb_array_elements_text(coalesce(p_input->'channels','[]'))),actor);
    elsif p_command='campaign.edit' then
      update public.marketing_campaigns set name=btrim(p_input->>'name'),objective=p_input->>'objective',description=coalesce(p_input->>'description',''),
        planned_start_on=nullif(p_input->>'start','')::date,planned_end_on=nullif(p_input->>'end','')::date,owner_membership_id=nullif(p_input->>'owner','')::uuid,
        channels=array(select jsonb_array_elements_text(coalesce(p_input->'channels','[]'))),updated_at=now() where organization_id=p_organization_id and id=result;
    elsif p_command='campaign.status' then
      target:=p_input->>'status';
      if target=c.status then return result; end if;
      if not ((c.status='draft' and target in ('active','archived')) or (c.status='active' and target in ('paused','completed','archived')) or
        (c.status='paused' and target in ('active','completed','archived')) or (c.status='completed' and target='archived')) then raise exception 'Invalid campaign transition'; end if;
      update public.marketing_campaigns set status=target,updated_at=now(),archived_at=case when target='archived' then now() end where organization_id=p_organization_id and id=result;
    elsif p_command='campaign.form' then
      if coalesce((p_input->>'remove')::boolean,false) then
        -- Keep associations once attribution exists so previously shared tokens remain auditable.
        if exists(select 1 from public.marketing_inquiries where organization_id=p_organization_id and campaign_id=result and form_id=(p_input->>'form')::uuid) then raise exception 'An acquisition source with results must be retained'; end if;
        delete from public.marketing_campaign_forms where organization_id=p_organization_id and campaign_id=result and form_id=(p_input->>'form')::uuid;
      else
        insert into public.marketing_campaign_forms(organization_id,campaign_id,form_id) values(p_organization_id,result,(p_input->>'form')::uuid) on conflict do nothing;
      end if;
    elsif p_command='campaign.page' then
      if not exists(select 1 from public.public_sites s join public.public_site_revisions r on (r.organization_id,r.site_id,r.id)=(s.organization_id,s.id,s.current_published_revision_id), lateral jsonb_array_elements(r.pages) page
        where s.organization_id=p_organization_id and s.id=(p_input->>'site')::uuid and r.id=(p_input->>'revision')::uuid and page->>'id'=p_input->>'page') then raise exception 'Select a currently published Studio page'; end if;
      update public.marketing_campaigns set landing_site_id=(p_input->>'site')::uuid,landing_revision_id=(p_input->>'revision')::uuid,landing_page_id=(p_input->>'page')::uuid,updated_at=now() where organization_id=p_organization_id and id=result;
    else
      if coalesce((p_input->>'remove')::boolean,false) then delete from public.marketing_campaign_audiences where organization_id=p_organization_id and campaign_id=result and audience_id=(p_input->>'audience')::uuid;
      else insert into public.marketing_campaign_audiences values(p_organization_id,result,(p_input->>'audience')::uuid) on conflict do nothing; end if;
    end if;
  elsif p_command='audience.save' then
    result:=coalesce((p_input->>'id')::uuid,gen_random_uuid());
    insert into public.marketing_audiences(organization_id,id,name,description,stage_id,created_from,created_before,created_by)
      values(p_organization_id,result,btrim(p_input->>'name'),coalesce(p_input->>'description',''),nullif(p_input->>'stage','')::uuid,nullif(p_input->>'from','')::date,nullif(p_input->>'before','')::date,actor)
      on conflict(organization_id,id) do update set name=excluded.name,description=excluded.description,stage_id=excluded.stage_id,created_from=excluded.created_from,created_before=excluded.created_before,updated_at=now();
  elsif p_command in ('inquiry.review','inquiry.link','inquiry.handoff') then
    result:=(p_input->>'id')::uuid;
    select * into i from public.marketing_inquiries where organization_id=p_organization_id and id=result for update;
    if not found then raise exception 'Inquiry not found' using errcode='P0002'; end if;
    if i.status='handed_off' then return result; end if;
    if p_command='inquiry.review' then
      target:=p_input->>'status';
      if target not in ('in_review','disqualified') or i.status='disqualified' then raise exception 'Invalid review transition'; end if;
      update public.marketing_inquiries set status=target,reviewed_by=actor,reviewed_at=now() where organization_id=p_organization_id and id=result;
    else
      if i.status='disqualified' then raise exception 'Disqualified inquiries cannot be handed off'; end if;
      customer:=coalesce(nullif(p_input->>'customer','')::uuid,i.customer_id);
      if customer is null and p_command='inquiry.handoff' and p_input->>'create'='true' then
        if not app.has_capability(p_organization_id,'customer.create') then raise exception 'Customer creation permission required' using errcode='42501'; end if;
        customer:=public.create_customer(p_organization_id,btrim(p_input->>'name'),nullif(lower(btrim(p_input->>'email')),''),nullif(btrim(p_input->>'phone'),''),'{}');
      end if;
      if customer is null or not exists(select 1 from public.customers where organization_id=p_organization_id and id=customer) then raise exception 'Select a Customer in this organization'; end if;
      update public.marketing_inquiries set customer_id=customer,status=case when p_command='inquiry.handoff' then 'handed_off' else 'in_review' end,
        reviewed_by=actor,reviewed_at=now(),handed_off_at=case when p_command='inquiry.handoff' then now() end where organization_id=p_organization_id and id=result;
    end if;
  else raise exception 'Unknown Marketing command' using errcode='22023'; end if;
  insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload)
    values(p_organization_id,actor,case when p_command like 'campaign.%' then 'marketing_campaign' when p_command like 'audience.%' then 'marketing_audience' else 'marketing_inquiry' end,result,p_command,
      jsonb_strip_nulls(jsonb_build_object('status',p_input->>'status','customer_id',customer,'form_id',p_input->>'form','audience_id',p_input->>'audience','page_id',p_input->>'page')));
  return result;
end $$;
revoke all on function public.marketing_command(uuid,text,jsonb) from public,anon;
grant execute on function public.marketing_command(uuid,text,jsonb) to authenticated;

-- Wrap the existing canonical write; request identity prevents duplicate submissions on retries.
create table public.marketing_submission_requests (
  organization_id uuid not null, request_id uuid not null, form_id uuid not null, submission_id uuid not null, fingerprint text not null,
  primary key(organization_id,request_id),
  foreign key(organization_id,form_id,submission_id) references public.form_submissions(organization_id,form_id,id),
  foreign key(organization_id,form_id) references public.forms(organization_id,id)
);
alter table public.marketing_submission_requests enable row level security;
alter table public.marketing_submission_requests force row level security;
revoke all on public.marketing_submission_requests from public,anon,authenticated;

create function public.submit_marketing_form(p_public_key text,p_revision_id uuid,p_answers jsonb,p_source text,p_token uuid,p_utm jsonb,p_request_id uuid) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare f public.forms; c public.marketing_campaigns; association public.marketing_campaign_forms; submission uuid; prior public.marketing_submission_requests; meta jsonb; fingerprint text;
begin
  if auth.uid() is null then raise exception 'Public session required' using errcode='42501'; end if;
  if p_source not in ('hosted','website','embed') or p_source is null or p_request_id is null then raise exception 'Invalid source or request' using errcode='22023'; end if;
  select * into f from public.forms where public_key=lower(btrim(p_public_key));
  if not found then raise exception 'Form unavailable' using errcode='GD001'; end if;
  if p_utm is null or jsonb_typeof(p_utm)<>'object' or octet_length(p_utm::text)>1600 then raise exception 'Invalid attribution metadata' using errcode='22023'; end if;
  if exists(select 1 from jsonb_each(p_utm) e where e.key not in ('utm_source','utm_medium','utm_campaign','utm_content','utm_term') or jsonb_typeof(e.value)<>'string' or length(e.value#>>'{}')>200) then raise exception 'Invalid UTM field' using errcode='22023'; end if;
  if p_token is not null then
    select * into association from public.marketing_campaign_forms where token=p_token and organization_id=f.organization_id and form_id=f.id;
    if not found then raise exception 'Invalid Campaign attribution' using errcode='22023'; end if;
    select * into c from public.marketing_campaigns where organization_id=f.organization_id and id=association.campaign_id;
    if c.status<>'active' then raise exception 'Campaign is not accepting acquisition' using errcode='22023'; end if;
  end if;
  fingerprint:=md5(jsonb_build_array(p_revision_id,p_answers,p_source,p_token,p_utm)::text);
  perform pg_advisory_xact_lock(hashtextextended(f.organization_id::text || p_request_id::text,0));
  select * into prior from public.marketing_submission_requests where organization_id=f.organization_id and request_id=p_request_id;
  if found then
    if prior.form_id<>f.id or prior.fingerprint<>fingerprint then raise exception 'Request identity reused with different data' using errcode='22023'; end if;
    return prior.submission_id;
  end if;
  submission:=app.record_form_submission(f.organization_id,f.id,p_revision_id,p_answers,p_source,auth.uid(),null,null);
  meta:=p_utm || jsonb_strip_nulls(jsonb_build_object('campaign_token',p_token));
  update public.form_submissions set context=context || meta where organization_id=f.organization_id and id=submission;
  insert into public.marketing_submission_requests values(f.organization_id,p_request_id,f.id,submission,fingerprint);
  -- Only explicit tracked acquisition creates Marketing interest. Existing/untracked submissions keep their contract.
  if p_token is not null then
    insert into public.marketing_inquiries(organization_id,campaign_id,submission_id,form_id,source,source_context,campaign_name_at_capture,form_name_at_capture,occurred_at)
    values(f.organization_id,c.id,submission,f.id,p_source,meta,c.name,f.name,now()) on conflict(organization_id,submission_id) do nothing;
    insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload)
      select f.organization_id,auth.uid(),'marketing_inquiry',id,'inquiry.captured',jsonb_build_object('campaign_id',c.id,'submission_id',submission)
      from public.marketing_inquiries where organization_id=f.organization_id and submission_id=submission;
  end if;
  return submission;
end $$;
revoke all on function public.submit_marketing_form(text,uuid,jsonb,text,uuid,jsonb,uuid) from public,anon;
grant execute on function public.submit_marketing_form(text,uuid,jsonb,text,uuid,jsonb,uuid) to authenticated;

create or replace function public.marketing_read(p_organization_id uuid,p_view text,p_filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; since timestamptz; until_at timestamptz; page_no integer; search text; selected uuid; zone text;
begin
  perform app.require_marketing(p_organization_id);
  select timezone into zone from public.organizations where id=p_organization_id;
  since:=coalesce(nullif(p_filters->>'from','')::date,(now() at time zone zone)::date-29)::timestamp at time zone zone;
  until_at:=(coalesce(nullif(p_filters->>'to','')::date,(now() at time zone zone)::date)+1)::timestamp at time zone zone;
  if until_at<since or until_at-since>interval '366 days' then raise exception 'Choose a period of up to one year'; end if;
  page_no:=greatest(1,least(100000,coalesce((p_filters->>'page')::integer,1)));
  search:=replace(replace(coalesce(p_filters->>'q',''),'%',''),'_','');
  selected:=nullif(p_filters->>'campaign','')::uuid;
  if p_view='inquiry' then
    select to_jsonb(i)||jsonb_build_object('answers',s.answers,'definition',r.definition,'customer_name',cu.name)
      into result from public.marketing_inquiries i
      join public.form_submissions s on (s.organization_id,s.id)=(i.organization_id,i.submission_id)
      join public.form_revisions r on (r.organization_id,r.form_id,r.id)=(s.organization_id,s.form_id,s.form_revision_id)
      left join public.customers cu on (cu.organization_id,cu.id)=(i.organization_id,i.customer_id)
      where i.organization_id=p_organization_id and i.id=(p_filters->>'id')::uuid;
    return result;
  elsif p_view='audience' then
    select jsonb_build_object('total',count(*),'customers',(select coalesce(jsonb_agg(x),'[]') from
      (select cu.id,cu.name,cu.created_at from public.customers cu join public.marketing_audiences a on a.organization_id=cu.organization_id
       where a.organization_id=p_organization_id and a.id=(p_filters->>'id')::uuid
       and (a.stage_id is null or cu.stage_id=a.stage_id) and (a.created_from is null or cu.created_at>=a.created_from)
       and (a.created_before is null or cu.created_at<a.created_before+interval '1 day') order by cu.name,cu.id limit 25) x))
    into result from public.customers cu join public.marketing_audiences a on a.organization_id=cu.organization_id
      where a.organization_id=p_organization_id and a.id=(p_filters->>'id')::uuid
      and (a.stage_id is null or cu.stage_id=a.stage_id) and (a.created_from is null or cu.created_at>=a.created_from)
      and (a.created_before is null or cu.created_at<a.created_before+interval '1 day');
    return result;
  elsif p_view='customers' then
    return (select coalesce(jsonb_agg(x),'[]') from (select id,name,email,phone from public.customers where organization_id=p_organization_id
      and (name ilike '%'||search||'%' or email ilike '%'||search||'%') order by name,id limit 25) x);
  end if;
  with campaigns as (
    select c.*,m.display_name owner_name,
      (select jsonb_build_object('name',page->>'name','slug',case when (page->>'isHome')::boolean then '' else page->>'slug' end) from public.public_sites s join public.public_site_revisions r on (r.organization_id,r.site_id,r.id)=(s.organization_id,s.id,s.current_published_revision_id), lateral jsonb_array_elements(r.pages) page where s.organization_id=c.organization_id and s.id=c.landing_site_id and page->>'id'=c.landing_page_id::text) landing_page,
      (select count(*) from public.marketing_inquiries i where i.organization_id=c.organization_id and i.campaign_id=c.id and i.occurred_at>=since and i.occurred_at<until_at) leads,
      (select count(*) from public.marketing_inquiries i where i.organization_id=c.organization_id and i.campaign_id=c.id and i.occurred_at>=since and i.occurred_at<until_at and i.status='handed_off') handoffs,
      (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name)),'[]') from public.marketing_campaign_audiences ca join public.marketing_audiences a on (a.organization_id,a.id)=(ca.organization_id,ca.audience_id) where ca.organization_id=c.organization_id and ca.campaign_id=c.id) audiences,
      (select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'public_key',f.public_key,'published',f.current_published_revision_id is not null and f.archived_at is null,'token',cf.token)),'[]') from public.marketing_campaign_forms cf join public.forms f on (f.organization_id,f.id)=(cf.organization_id,cf.form_id) where cf.organization_id=c.organization_id and cf.campaign_id=c.id) forms
    from public.marketing_campaigns c left join public.memberships m on (m.organization_id,m.id)=(c.organization_id,c.owner_membership_id)
    where c.organization_id=p_organization_id
      and (search='' or c.name ilike '%'||search||'%') and (selected is null or c.id=selected)
      and (coalesce(p_filters->>'status','')='' or p_view<>'campaigns' or c.status=p_filters->>'status')
      and (coalesce(p_filters->>'objective','')='' or c.objective=p_filters->>'objective')
      and (coalesce(p_filters->>'owner','')='' or c.owner_membership_id=(p_filters->>'owner')::uuid)
      and (coalesce(p_filters->>'attention','')<>'ending' or c.status='active' and c.planned_end_on<=(now() at time zone (select timezone from public.organizations where id=p_organization_id))::date+7)
      and (coalesce(p_filters->>'attention','')<>'setup' or c.status<>'archived' and c.objective in ('lead_generation','engagement') and not exists(select 1 from public.marketing_campaign_forms cf where cf.organization_id=c.organization_id and cf.campaign_id=c.id))
  ), inquiries as (
    select i.*,cu.name customer_name from public.marketing_inquiries i left join public.customers cu on (cu.organization_id,cu.id)=(i.organization_id,i.customer_id)
    where i.organization_id=p_organization_id
      and (case when p_filters->>'handoff'='true' then i.handed_off_at else i.occurred_at end)>=since
      and (case when p_filters->>'handoff'='true' then i.handed_off_at else i.occurred_at end)<until_at
      and (selected is null or i.campaign_id=selected)
      and (search='' or i.form_name_at_capture ilike '%'||search||'%' or i.campaign_name_at_capture ilike '%'||search||'%' or i.id::text ilike '%'||search||'%')
      and (p_view<>'leads' or coalesce(p_filters->>'status','')='' or i.status=p_filters->>'status')
      and (coalesce(p_filters->>'review','')<>'awaiting' or i.status in ('new','in_review'))
      and (coalesce(p_filters->>'source','')='' or coalesce(i.source_context->>'utm_source',i.source)=p_filters->>'source')
      and (coalesce(p_filters->>'attributed','')<>'true' or i.campaign_id is not null)
  )
  select jsonb_build_object(
    'campaigns',(select coalesce(jsonb_agg(x),'[]') from (select * from campaigns order by created_at desc,id limit case when p_view='campaigns' then 25 else 8 end offset case when p_view='campaigns' then (page_no-1)*25 else 0 end) x),
    'campaign_total',(select count(*) from campaigns),
    'attention',jsonb_build_object(
      'active',(select coalesce(jsonb_agg(x),'[]') from (select * from campaigns where status='active' order by created_at desc,id limit 5) x),
      'setup',(select coalesce(jsonb_agg(x),'[]') from (select * from campaigns where status<>'archived' and objective in ('lead_generation','engagement') and jsonb_array_length(forms)=0 order by created_at desc,id limit 5) x),
      'ending',(select coalesce(jsonb_agg(x),'[]') from (select * from campaigns where status='active' and planned_end_on<=(now() at time zone (select timezone from public.organizations where id=p_organization_id))::date+7 order by planned_end_on,id limit 5) x),
      'new',(select coalesce(jsonb_agg(x),'[]') from (select * from inquiries where status='new' order by occurred_at desc,id limit 5) x),
      'in_review',(select coalesce(jsonb_agg(x),'[]') from (select * from inquiries where status='in_review' order by occurred_at desc,id limit 5) x)
    ),
    'inquiries',(select coalesce(jsonb_agg(x),'[]') from (select * from inquiries order by occurred_at desc,id limit case when p_view='leads' then 25 else 8 end offset case when p_view='leads' then (page_no-1)*25 else 0 end) x),
    'inquiry_total',(select count(*) from inquiries),
    'summary',(select jsonb_build_object(
      'active',(select count(*) from public.marketing_campaigns where organization_id=p_organization_id and status='active'),
      'active_in_period',(select count(*) from public.marketing_campaigns c where c.organization_id=p_organization_id and exists(select 1 from public.events e where e.organization_id=c.organization_id and e.entity_id=c.id and e.action='campaign.status' and e.payload->>'status'='active' and e.occurred_at<until_at and (e.occurred_at>=since or not exists(select 1 from public.events later where later.organization_id=e.organization_id and later.entity_id=e.entity_id and later.action='campaign.status' and later.occurred_at>e.occurred_at and later.occurred_at<since)))),
      'acquired',count(*),'attributed',count(*) filter(where campaign_id is not null),'cohort_handoffs',count(*) filter(where status='handed_off'),
      'handoffs',(select count(*) from public.marketing_inquiries where organization_id=p_organization_id and handed_off_at>=since and handed_off_at<until_at and (selected is null or campaign_id=selected)),
      'awaiting',count(*) filter(where status in ('new','in_review')),
      'submissions',(select count(*) from public.form_submissions s where s.organization_id=p_organization_id and s.submitted_at>=since and s.submitted_at<until_at and (selected is null or exists(select 1 from public.marketing_campaign_forms cf where cf.organization_id=s.organization_id and cf.form_id=s.form_id and cf.campaign_id=selected)))
    ) from inquiries),
    'audiences',(select coalesce(jsonb_agg(x),'[]') from (select a.*,st.name stage_name,(select count(*) from public.customers cu where cu.organization_id=a.organization_id and (a.stage_id is null or cu.stage_id=a.stage_id) and (a.created_from is null or cu.created_at>=a.created_from) and (a.created_before is null or cu.created_at<a.created_before+interval '1 day')) matching from public.marketing_audiences a left join public.customer_stages st on (st.organization_id,st.id)=(a.organization_id,a.stage_id) where a.organization_id=p_organization_id and (p_view<>'audiences' or search='' or a.name ilike '%'||search||'%') order by a.created_at desc,a.id limit 25 offset case when p_view='audiences' then (page_no-1)*25 else 0 end) x),
    'audience_total',(select count(*) from public.marketing_audiences a where organization_id=p_organization_id and (search='' or a.name ilike '%'||search||'%')),
    'sources',(select coalesce(jsonb_agg(x),'[]') from (select coalesce(source_context->>'utm_source','Unknown / unattributed') source,coalesce(source_context->>'utm_medium','Unknown') medium,form_name_at_capture form,campaign_name_at_capture campaign,count(*) acquired,count(*) filter(where status='handed_off') handoffs from inquiries group by 1,2,3,4 order by count(*) desc limit 50) x),
    'trend',(select coalesce(jsonb_agg(x order by x.day),'[]') from (select (occurred_at at time zone (select timezone from public.organizations where id=p_organization_id))::date as "day",count(*) acquired,count(*) filter(where status='handed_off') handoffs from inquiries group by 1) x),
    'events',(select coalesce(jsonb_agg(x),'[]') from (select id,entity_type,entity_id,action,occurred_at,payload from public.events where organization_id=p_organization_id and entity_type in ('marketing_campaign','marketing_inquiry','marketing_audience') and (selected is null or entity_id=selected or entity_id in (select id from public.marketing_inquiries where organization_id=p_organization_id and campaign_id=selected)) order by occurred_at desc,id limit 12) x),
    'members',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',coalesce(display_name,'Member'))),'[]') from public.memberships where organization_id=p_organization_id),
    'stages',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') from public.customer_stages where organization_id=p_organization_id),
    'available_pages',(select coalesce(jsonb_agg(jsonb_build_object('id',page->>'id','name',page->>'name','site',s.id,'revision',r.id)),'[]') from public.public_sites s join public.public_site_revisions r on (r.organization_id,r.site_id,r.id)=(s.organization_id,s.id,s.current_published_revision_id), lateral jsonb_array_elements(r.pages) page where s.organization_id=p_organization_id),
    'available_forms',(select coalesce(jsonb_agg(x),'[]') from (select id,name,public_key,current_published_revision_id is not null and archived_at is null published from public.forms where organization_id=p_organization_id order by updated_at desc limit 100) x),
    'campaign_options',(select coalesce(jsonb_agg(x),'[]') from (select id,name from public.marketing_campaigns where organization_id=p_organization_id order by updated_at desc limit 100) x),
    'period',jsonb_build_object('from',since,'to',until_at,'from_date',(since at time zone zone)::date,'to_date',(until_at at time zone zone)::date-1)
  ) into result;
  return result;
end $$;
revoke all on function public.marketing_read(uuid,text,jsonb) from public,anon;
grant execute on function public.marketing_read(uuid,text,jsonb) to authenticated;
