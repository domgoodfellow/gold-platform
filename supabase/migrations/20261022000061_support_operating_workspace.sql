-- Support owns problems and private resolution evidence, never message or Work state.
do $$ declare caps text[]; begin
  select array_agg(distinct capability) into caps from pg_constraint c,
    lateral regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g') m
    cross join lateral unnest(case when left(m[1],1)='{' then m[1]::text[] else array[m[1]] end) capability
    where c.conrelid='public.roles'::regclass and c.conname='roles_capabilities_known';
  alter table public.roles drop constraint roles_capabilities_known;
  caps := caps || array['support.read','support.case.create','support.case.update','support.case.assign','support.case.resolve','support.configure'];
  execute format('alter table public.roles add constraint roles_capabilities_known check (capabilities <@ array[%s]::text[])',
    (select string_agg(quote_literal(v),',' order by v) from unnest(caps) v));
  update public.roles set capabilities=array(select distinct v from unnest(capabilities || array['support.read','support.case.create','support.case.update','support.case.assign','support.case.resolve','support.configure']) v)
    where 'organization.manage'=any(capabilities);
end $$;

create table public.support_queues (
  organization_id uuid not null references public.organizations(id), id uuid not null default gen_random_uuid(),
  name text not null check(length(btrim(name)) between 1 and 120), description text not null default '' check(length(description)<=4000),
  active boolean not null default true, created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(organization_id,id), unique(organization_id,name)
);
create table public.support_service_levels (
  organization_id uuid not null references public.organizations(id), id uuid not null default gen_random_uuid(),
  name text not null check(length(btrim(name)) between 1 and 120),
  priority text not null check(priority in ('low','normal','high','urgent')), queue_id uuid,
  target_minutes integer not null check(target_minutes between 1 and 525600),
  clock_basis text not null default 'elapsed' check(clock_basis='elapsed'), active boolean not null default true,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(organization_id,id), foreign key(organization_id,queue_id) references public.support_queues(organization_id,id)
);
create unique index support_policy_applicability on public.support_service_levels(organization_id,priority,queue_id) nulls not distinct where active;
create table public.support_case_counters (
  organization_id uuid primary key references public.organizations(id), last_number bigint not null check(last_number>0)
);
create table public.support_cases (
  organization_id uuid not null references public.organizations(id), id uuid not null default gen_random_uuid(),
  case_number text not null, title text not null check(length(btrim(title)) between 1 and 200),
  description text not null default '' check(length(description)<=12000),
  status text not null default 'new' check(status in ('new','open','waiting','resolved','closed')),
  priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
  queue_id uuid, assigned_membership_id uuid, customer_id uuid,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  resolved_at timestamptz, closed_at timestamptz, resolution_summary text,
  escalated_at timestamptz, policy_id uuid, target_snapshot jsonb, resolution_due_at timestamptz,
  primary key(organization_id,id), unique(organization_id,case_number),
  foreign key(organization_id,queue_id) references public.support_queues(organization_id,id),
  foreign key(organization_id,assigned_membership_id) references public.memberships(organization_id,id),
  foreign key(organization_id,customer_id) references public.customers(organization_id,id),
  foreign key(organization_id,policy_id) references public.support_service_levels(organization_id,id),
  check(status not in ('resolved','closed') or (resolved_at is not null and length(btrim(resolution_summary)) between 10 and 12000)),
  check((status='closed')=(closed_at is not null)),
  check((policy_id is null and target_snapshot is null and resolution_due_at is null) or (policy_id is not null and target_snapshot is not null and resolution_due_at is not null))
);
-- General events are readable by every member and client-insertable. Private case evidence
-- needs capability-restricted reads and server-attributed immutable writes in one store.
create table public.support_case_events (
  organization_id uuid not null, id uuid not null default gen_random_uuid(), case_id uuid not null,
  actor_id uuid not null references auth.users(id), actor_name text not null, kind text not null,
  previous_value jsonb, new_value jsonb, body text not null default '' check(length(body)<=12000),
  occurred_at timestamptz not null default now(), primary key(organization_id,id),
  foreign key(organization_id,case_id) references public.support_cases(organization_id,id),
  check(kind in ('created','edited','status','priority','assignment','queue','escalated','resolved','reopened','note','linked','unlinked','closed'))
);
create table public.support_case_links (
  organization_id uuid not null, id uuid not null default gen_random_uuid(), case_id uuid not null,
  conversation_id uuid, call_id uuid, work_item_id uuid, invoice_id uuid, asset_id uuid, location_id uuid,
  created_at timestamptz not null default now(), primary key(organization_id,id),
  foreign key(organization_id,case_id) references public.support_cases(organization_id,id),
  foreign key(organization_id,conversation_id) references public.conversations(organization_id,id),
  foreign key(organization_id,call_id) references public.calls(organization_id,id),
  foreign key(organization_id,work_item_id) references public.work_items(organization_id,id),
  foreign key(organization_id,invoice_id) references public.invoices(organization_id,id),
  foreign key(organization_id,asset_id) references public.assets(organization_id,id),
  foreign key(organization_id,location_id) references public.locations(organization_id,id),
  check(num_nonnulls(conversation_id,call_id,work_item_id,invoice_id,asset_id,location_id)=1),
  unique nulls not distinct(organization_id,case_id,conversation_id,call_id,work_item_id,invoice_id,asset_id,location_id)
);
create index support_cases_status on public.support_cases(organization_id,status,created_at desc,id);
create index support_cases_queue on public.support_cases(organization_id,queue_id,status,created_at desc,id);
create index support_cases_owner on public.support_cases(organization_id,assigned_membership_id,status);
create index support_cases_due on public.support_cases(organization_id,resolution_due_at) where status in ('new','open','waiting');
create index support_cases_customer on public.support_cases(organization_id,customer_id);
create index support_case_events_history on public.support_case_events(organization_id,case_id,occurred_at desc,id);
create index support_case_events_recent on public.support_case_events(organization_id,occurred_at desc,id);
create index support_case_links_conversation on public.support_case_links(organization_id,conversation_id);
create index support_case_links_work on public.support_case_links(organization_id,work_item_id);
do $$ declare t text; begin
  foreach t in array array['support_queues','support_service_levels','support_case_counters','support_cases','support_case_events','support_case_links'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    if t<>'support_case_counters' then
      execute format('grant select on public.%I to authenticated',t);
      execute format('create policy support_read on public.%I for select to authenticated using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id,''support.read''))',t);
    end if;
  end loop;
end $$;

create function public.support_command(p_organization_id uuid,p_command text,p_input jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); actor_name text; authority text; result uuid;
  c public.support_cases; old_c public.support_cases; policy public.support_service_levels;
  seq bigint; event_kind text; summary text; target_status text; k text; reference_id uuid;
begin
  authority:=case when p_command like 'queue.%' or p_command like 'policy.%' then 'support.configure'
    when p_command='case.create' then 'support.case.create'
    when p_command='case.assign' then 'support.case.assign'
    when p_command in ('case.resolve','case.reopen','case.close') then 'support.case.resolve'
    else 'support.case.update' end;
  if actor is null or not app.has_capability(p_organization_id,'support.read') or not app.has_capability(p_organization_id,authority) then
    raise exception 'Support permission required: %',authority using errcode='42501';
  end if;
  select coalesce(display_name,'Member') into actor_name from public.memberships where organization_id=p_organization_id and user_id=actor;
  if actor_name is null then raise exception 'Organization membership required' using errcode='42501'; end if;
  result:=coalesce(nullif(p_input->>'id','')::uuid,gen_random_uuid());
  if p_command in ('queue.create','queue.edit') then
    if p_command='queue.create' then
      insert into public.support_queues(organization_id,id,name,description,active,created_by)
        values(p_organization_id,result,btrim(p_input->>'name'),coalesce(p_input->>'description',''),coalesce((p_input->>'active')::boolean,true),actor);
    else
      update public.support_queues set name=btrim(p_input->>'name'),description=coalesce(p_input->>'description',''),active=(p_input->>'active')::boolean,updated_at=now()
        where organization_id=p_organization_id and id=result;
      if not found then raise exception 'Queue unavailable'; end if;
    end if;
    return result;
  elsif p_command in ('policy.create','policy.edit') then
    if nullif(p_input->>'queue','') is not null and not exists(select 1 from public.support_queues where organization_id=p_organization_id and id=(p_input->>'queue')::uuid and active) then raise exception 'Active queue required'; end if;
    if p_command='policy.create' then
      insert into public.support_service_levels(organization_id,id,name,priority,queue_id,target_minutes,active,created_by)
        values(p_organization_id,result,btrim(p_input->>'name'),p_input->>'priority',nullif(p_input->>'queue','')::uuid,(p_input->>'minutes')::integer,coalesce((p_input->>'active')::boolean,true),actor);
    else
      update public.support_service_levels set name=btrim(p_input->>'name'),priority=p_input->>'priority',queue_id=nullif(p_input->>'queue','')::uuid,
        target_minutes=(p_input->>'minutes')::integer,active=(p_input->>'active')::boolean,updated_at=now() where organization_id=p_organization_id and id=result;
      if not found then raise exception 'Policy unavailable'; end if;
    end if;
    return result;
  end if;
  if p_command='case.create' then
    if (nullif(p_input->>'owner','') is not null or nullif(p_input->>'queue','') is not null) and not app.has_capability(p_organization_id,'support.case.assign') then raise exception 'Assignment permission required' using errcode='42501'; end if;
    if nullif(p_input->>'conversation','') is not null and nullif(p_input->>'customer','') is null then
      p_input:=p_input || jsonb_build_object('customer',(select customer_id from public.conversations where organization_id=p_organization_id and id=(p_input->>'conversation')::uuid));
    end if;
    insert into public.support_case_counters values(p_organization_id,1) on conflict(organization_id) do update set last_number=public.support_case_counters.last_number+1 returning last_number into seq;
    insert into public.support_cases(organization_id,id,case_number,title,description,priority,queue_id,assigned_membership_id,customer_id,created_by)
      values(p_organization_id,result,'CASE-'||lpad(seq::text,greatest(4,length(seq::text)),'0'),btrim(p_input->>'title'),coalesce(p_input->>'description',''),coalesce(p_input->>'priority','normal'),nullif(p_input->>'queue','')::uuid,nullif(p_input->>'owner','')::uuid,nullif(p_input->>'customer','')::uuid,actor)
      returning * into c;
    if c.queue_id is not null and not exists(select 1 from public.support_queues where organization_id=p_organization_id and id=c.queue_id and active) then raise exception 'Active queue required'; end if;
    select * into policy from public.support_service_levels where organization_id=p_organization_id and active and priority=c.priority and (queue_id=c.queue_id or queue_id is null) order by queue_id nulls last limit 1;
    if found then
      update public.support_cases set policy_id=policy.id,target_snapshot=jsonb_build_object('name',policy.name,'priority',policy.priority,'queue',policy.queue_id,'minutes',policy.target_minutes,'clock','elapsed','applied_at',now()),resolution_due_at=created_at+make_interval(mins=>policy.target_minutes) where organization_id=p_organization_id and id=result returning * into c;
    end if;
    event_kind:='created';
  else
    select * into c from public.support_cases where organization_id=p_organization_id and id=result for update;
    if not found then raise exception 'Case unavailable' using errcode='42501'; end if;
    old_c:=c;
    if p_command not in ('case.reopen','case.close') and c.status in ('resolved','closed') then raise exception 'Reopen the Case before editing'; end if;
    case p_command
      when 'case.edit' then c.title:=btrim(p_input->>'title'); c.description:=coalesce(p_input->>'description',''); c.customer_id:=nullif(p_input->>'customer','')::uuid; event_kind:='edited';
      when 'case.assign' then
        if p_input ? 'owner' then c.assigned_membership_id:=nullif(p_input->>'owner','')::uuid; end if;
        if p_input ? 'queue' then c.queue_id:=nullif(p_input->>'queue','')::uuid; end if;
        if c.queue_id is not null and c.queue_id is distinct from old_c.queue_id and not exists(select 1 from public.support_queues where organization_id=p_organization_id and id=c.queue_id and active) then raise exception 'Active queue required'; end if;
        event_kind:=case when c.queue_id is distinct from old_c.queue_id then 'queue' else 'assignment' end;
      when 'case.priority' then c.priority:=p_input->>'priority'; event_kind:='priority';
      when 'case.status' then
        target_status:=p_input->>'status';
        if not ((c.status='new' and target_status in ('open','waiting')) or (c.status='open' and target_status='waiting') or (c.status='waiting' and target_status='open')) then raise exception 'Unsupported status transition'; end if;
        c.status:=target_status; event_kind:='status';
      when 'case.resolve' then
        summary:=btrim(p_input->>'summary'); if coalesce(length(summary),0)<10 then raise exception 'A meaningful resolution summary of at least 10 characters is required'; end if;
        c.status:='resolved';c.resolved_at:=now();c.resolution_summary:=summary;event_kind:='resolved';
      when 'case.close' then
        if c.status<>'resolved' then raise exception 'Only a Resolved Case can be closed'; end if;
        c.status:='closed';c.closed_at:=now();event_kind:='closed';
      when 'case.reopen' then
        if c.status not in ('resolved','closed') then raise exception 'Only a Resolved or Closed Case can be reopened'; end if;
        summary:=btrim(p_input->>'reason');if coalesce(length(summary),0)<10 then raise exception 'A reopening reason of at least 10 characters is required'; end if;
        c.status:='open';c.closed_at:=null;c.escalated_at:=null;event_kind:='reopened';
      when 'case.escalate' then
        summary:=btrim(p_input->>'reason');if coalesce(length(summary),0)<10 then raise exception 'An escalation reason of at least 10 characters is required'; end if;
        c.escalated_at:=now();
        if nullif(p_input->>'priority','') is not null then c.priority:=p_input->>'priority'; end if;
        if p_input ? 'owner' or p_input ? 'queue' then
          if not app.has_capability(p_organization_id,'support.case.assign') then raise exception 'Assignment permission required' using errcode='42501'; end if;
          if p_input ? 'owner' then c.assigned_membership_id:=nullif(p_input->>'owner','')::uuid; end if;
          if p_input ? 'queue' then c.queue_id:=nullif(p_input->>'queue','')::uuid; end if;
        end if;
        event_kind:='escalated';
      when 'case.note' then
        summary:=btrim(p_input->>'body');if coalesce(length(summary),0)<1 then raise exception 'Enter an internal note'; end if;event_kind:='note';
      when 'case.link' then event_kind:='linked';
      when 'case.unlink' then
        delete from public.support_case_links where organization_id=p_organization_id and case_id=c.id and id=(p_input->>'link')::uuid;
        if not found then raise exception 'Related link unavailable'; end if;event_kind:='unlinked';
      else raise exception 'Unsupported Support command';
    end case;
    if c.queue_id is not null and c.queue_id is distinct from old_c.queue_id and not exists(select 1 from public.support_queues where organization_id=p_organization_id and id=c.queue_id and active) then raise exception 'Active queue required'; end if;
    update public.support_cases set title=c.title,description=c.description,customer_id=c.customer_id,status=c.status,priority=c.priority,queue_id=c.queue_id,
      assigned_membership_id=c.assigned_membership_id,resolved_at=c.resolved_at,closed_at=c.closed_at,resolution_summary=c.resolution_summary,escalated_at=c.escalated_at,updated_at=now()
      where organization_id=p_organization_id and id=c.id returning * into c;
  end if;
  if p_command in ('case.create','case.link') then
    foreach k in array array['conversation','call','work_item','invoice','asset','location'] loop
      reference_id:=nullif(p_input->>k,'')::uuid;
      if reference_id is not null then
        execute format('insert into public.support_case_links(organization_id,case_id,%I) values($1,$2,$3) on conflict do nothing',k||'_id') using p_organization_id,c.id,reference_id;
      end if;
    end loop;
  end if;
  insert into public.support_case_events(organization_id,case_id,actor_id,actor_name,kind,previous_value,new_value,body)
    values(p_organization_id,c.id,actor,actor_name,event_kind,
      case when old_c.id is not null then to_jsonb(old_c)||jsonb_build_object(
        'owner_name',(select display_name from public.memberships where organization_id=p_organization_id and id=old_c.assigned_membership_id),
        'queue_name',(select name from public.support_queues where organization_id=p_organization_id and id=old_c.queue_id)) end,
      to_jsonb(c)||jsonb_build_object('references',p_input - 'body' - 'summary' - 'reason',
        'owner_name',(select display_name from public.memberships where organization_id=p_organization_id and id=c.assigned_membership_id),
        'queue_name',(select name from public.support_queues where organization_id=p_organization_id and id=c.queue_id)),coalesce(summary,''));
  return c.id;
end $$;
revoke all on function public.support_command(uuid,text,jsonb) from public,anon;
grant execute on function public.support_command(uuid,text,jsonb) to authenticated;

create view public.support_case_records with (security_invoker=true) as
  select c.*,cu.name customer_name,q.name queue_name,case when m.id is not null then coalesce(m.display_name,'Member') end owner_name
  from public.support_cases c
  left join public.customers cu on (cu.organization_id,cu.id)=(c.organization_id,c.customer_id)
  left join public.support_queues q on (q.organization_id,q.id)=(c.organization_id,c.queue_id)
  left join public.memberships m on (m.organization_id,m.id)=(c.organization_id,c.assigned_membership_id);
grant select on public.support_case_records to authenticated;

create function public.support_read(p_organization_id uuid,p_view text,p_filters jsonb default '{}') returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare zone text; since timestamptz; until_at timestamptz; today timestamptz; tomorrow timestamptz;
  search text:=coalesce(p_filters->>'q',''); selected uuid:=nullif(p_filters->>'selected','')::uuid;
  page integer:=greatest(1,least(1000000,coalesce((p_filters->>'page')::integer,1))); result jsonb;
begin
  if auth.uid() is null or not app.has_capability(p_organization_id,'support.read') then raise exception 'Support read permission required' using errcode='42501'; end if;
  select timezone into zone from public.organizations where id=p_organization_id;
  if zone is null then raise exception 'Organization unavailable' using errcode='42501'; end if;
  since:=coalesce(nullif(p_filters->>'from','')::date,date_trunc('week',now() at time zone zone)::date)::timestamp at time zone zone;
  until_at:=(coalesce(nullif(p_filters->>'to','')::date,(now() at time zone zone)::date)+1)::timestamp at time zone zone;
  if until_at<=since or until_at-since>interval '366 days' then raise exception 'Choose a date range of at most one year'; end if;
  today:=((now() at time zone zone)::date)::timestamp at time zone zone;
  tomorrow:=((now() at time zone zone)::date+1)::timestamp at time zone zone;
  if p_view='search' then
    select coalesce(jsonb_agg(x),'[]') into result from (
      select id,name,'customer' kind from public.customers where organization_id=p_organization_id and (name ilike '%'||search||'%' or id::text=search)
        and coalesce(p_filters->>'kind','customer')='customer'
      union all select id,coalesce(nullif(subject,''),'Conversation')||' · '||left(id::text,8),'conversation' from public.conversations
        where organization_id=p_organization_id and p_filters->>'kind'='conversation' and (coalesce(subject,'') ilike '%'||search||'%' or id::text ilike search||'%')
      union all select id,'Call · '||left(id::text,8),'call' from public.calls where organization_id=p_organization_id and p_filters->>'kind'='call' and id::text ilike search||'%'
      union all select id,title||' · '||left(id::text,8),'work_item' from public.work_items where organization_id=p_organization_id and p_filters->>'kind'='work_item' and (title ilike '%'||search||'%' or id::text ilike search||'%')
      union all select id,'Invoice #'||number::text||' · '||left(id::text,8),'invoice' from public.invoices where organization_id=p_organization_id and p_filters->>'kind'='invoice' and (id::text ilike search||'%' or number::text ilike search||'%')
      union all select id,name,'asset' from public.assets where organization_id=p_organization_id and p_filters->>'kind'='asset' and name ilike '%'||search||'%'
      union all select id,label,'location' from public.locations where organization_id=p_organization_id and p_filters->>'kind'='location' and label ilike '%'||search||'%'
      limit 25
    ) x;
    return result;
  end if;
  with all_cases as materialized (select * from public.support_case_records where organization_id=p_organization_id),
  filtered as materialized (
    select c.* from all_cases c where
      (search='' or concat_ws(' ',case_number,title,customer_name) ilike '%'||search||'%' or exists(select 1 from public.support_case_links l where l.organization_id=p_organization_id and l.case_id=c.id and concat_ws(' ',l.conversation_id,l.call_id,l.work_item_id,l.invoice_id,l.asset_id,l.location_id) ilike '%'||search||'%'))
      and (coalesce(p_filters->>'status','') in ('','any') or (p_filters->>'status'='active' and status in ('new','open','waiting')) or status=p_filters->>'status')
      and (coalesce(p_filters->>'priority','')='' or priority=p_filters->>'priority')
      and (coalesce(p_filters->>'queue','')='' or (p_filters->>'queue'='none' and queue_id is null) or queue_id::text=p_filters->>'queue')
      and (coalesce(p_filters->>'owner','')='' or (p_filters->>'owner'='unassigned' and assigned_membership_id is null) or assigned_membership_id::text=p_filters->>'owner')
      and (coalesce(p_filters->>'attention','')='' or (p_filters->>'attention'='unassigned' and assigned_membership_id is null and status in ('new','open','waiting')) or (p_filters->>'attention'='urgent' and priority='urgent' and status in ('new','open','waiting')) or (p_filters->>'attention'='overdue' and resolution_due_at<now() and status in ('new','open','waiting')) or (p_filters->>'attention'='escalated' and escalated_at is not null and status in ('new','open','waiting')))
      and (coalesce(p_filters->>'customer','')='' or customer_id=nullif(p_filters->>'customer','')::uuid)
      and (coalesce(p_filters->>'related','')='' or exists(select 1 from public.support_case_links l where l.organization_id=p_organization_id and l.case_id=c.id and p_filters->>'related' in (l.conversation_id::text,l.call_id::text,l.work_item_id::text,l.invoice_id::text,l.asset_id::text,l.location_id::text)))
      and (coalesce(p_filters->>'period','')<>'resolved' or (status in ('resolved','closed') and resolved_at>=since and resolved_at<until_at))
      and (coalesce(p_filters->>'period','')<>'resolved_today' or (status in ('resolved','closed') and resolved_at>=today and resolved_at<tomorrow))
      and (coalesce(p_filters->>'period','')<>'created' or (created_at>=since and created_at<until_at))
      and (coalesce(p_filters->>'period','')<>'due_today' or (resolution_due_at>=today and resolution_due_at<tomorrow and status in ('new','open','waiting')))
      and (coalesce(p_filters->>'period','')<>'assigned_today' or exists(select 1 from public.support_case_events e where e.organization_id=p_organization_id and e.case_id=c.id and e.occurred_at>=today and e.occurred_at<tomorrow and e.kind in ('assignment','queue','created','escalated') and e.new_value->>'assigned_membership_id' is not null and e.new_value->>'assigned_membership_id' is distinct from e.previous_value->>'assigned_membership_id'))
  ), ranked as (select f.*,row_number() over(partition by status order by created_at desc,id) rn from filtered f)
  select jsonb_build_object(
    'cases',(select coalesce(jsonb_agg(x),'[]') from (select * from filtered where p_view<>'home' or status in ('new','open','waiting') order by
      case when p_filters->>'sort'='due' then resolution_due_at end asc nulls last,
      case when p_filters->>'sort'='oldest' then created_at end asc,
      created_at desc,id limit case when p_view='home' then 8 else 25 end offset case when p_view='home' then 0 else (page-1)*25 end) x),
    'total',(select count(*) from filtered),
    'board',(select coalesce(jsonb_agg(jsonb_build_object('status',s,'count',(select count(*) from filtered where status=s),'cases',(select coalesce(jsonb_agg(x),'[]') from (select * from ranked where status=s and rn<=8 order by rn) x))),'[]') from unnest(array['new','open','waiting','resolved','closed']) s),
    'selected',(select to_jsonb(c) from all_cases c where id=selected),
    'summary',(select jsonb_build_object('open',count(*) filter(where status in ('new','open','waiting')),'unassigned',count(*) filter(where assigned_membership_id is null and status in ('new','open','waiting')),'overdue',count(*) filter(where resolution_due_at<now() and status in ('new','open','waiting')),'urgent',count(*) filter(where priority='urgent' and status in ('new','open','waiting')),
      'resolved',count(*) filter(where status in ('resolved','closed') and resolved_at>=since and resolved_at<until_at),'created',count(*) filter(where created_at>=since and created_at<until_at),
      'due_today',count(*) filter(where status in ('new','open','waiting') and resolution_due_at>=today and resolution_due_at<tomorrow),
      'resolved_today',count(*) filter(where status in ('resolved','closed') and resolved_at>=today and resolved_at<tomorrow),
      'unqueued',count(*) filter(where queue_id is null and status in ('new','open','waiting')),
      'unqueued_created',count(*) filter(where queue_id is null and created_at>=since and created_at<until_at),
      'unqueued_resolved',count(*) filter(where queue_id is null and status in ('resolved','closed') and resolved_at>=since and resolved_at<until_at),
      'assigned_today',count(*) filter(where exists(select 1 from public.support_case_events e where e.organization_id=p_organization_id and e.case_id=all_cases.id and e.occurred_at>=today and e.occurred_at<tomorrow and e.kind in ('assignment','queue','created','escalated') and e.new_value->>'assigned_membership_id' is not null and e.new_value->>'assigned_membership_id' is distinct from e.previous_value->>'assigned_membership_id')),
      'near_due',count(*) filter(where status in ('new','open','waiting') and resolution_due_at>=now() and resolution_due_at<now()+interval '4 hours'),
      'targeted_resolved',count(*) filter(where status in ('resolved','closed') and resolved_at>=since and resolved_at<until_at and resolution_due_at is not null),
      'met_target',count(*) filter(where status in ('resolved','closed') and resolved_at>=since and resolved_at<until_at and resolved_at<=resolution_due_at),
      'resolution_hours',avg(extract(epoch from(resolved_at-created_at))/3600) filter(where status in ('resolved','closed') and resolved_at>=since and resolved_at<until_at)) from all_cases),
    'attention',(select jsonb_object_agg(k,(select coalesce(jsonb_agg(x),'[]') from (select * from all_cases where status in ('new','open','waiting') and
      ((k='unassigned' and assigned_membership_id is null) or (k='overdue' and resolution_due_at<now()) or (k='urgent' and priority='urgent') or (k='escalated' and escalated_at is not null)) order by resolution_due_at asc nulls last,created_at,id limit 6) x)) from unnest(array['unassigned','overdue','urgent','escalated']) k),
    'queues',(select coalesce(jsonb_agg(x),'[]') from (select q.*,(select count(*) from all_cases c where c.queue_id=q.id and c.status in ('new','open','waiting')) open_count,(select count(*) from all_cases c where c.queue_id=q.id and c.status in ('new','open','waiting') and resolution_due_at<now()) overdue_count,(select count(*) from all_cases c where c.queue_id=q.id and c.created_at>=since and c.created_at<until_at) created_count,(select count(*) from all_cases c where c.queue_id=q.id and c.status in ('resolved','closed') and c.resolved_at>=since and c.resolved_at<until_at) resolved_count from public.support_queues q where organization_id=p_organization_id order by active desc,name,id) x),
    'policies',(select coalesce(jsonb_agg(p order by name,id),'[]') from public.support_service_levels p where organization_id=p_organization_id),
    'members',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',coalesce(display_name,'Member')) order by display_name,id),'[]') from public.memberships where organization_id=p_organization_id),
    'events',(select coalesce(jsonb_agg(x),'[]') from (select e.*,c.case_number,c.title from public.support_case_events e join all_cases c on c.id=e.case_id where e.organization_id=p_organization_id and (selected is null or e.case_id=selected) order by e.occurred_at desc,e.id desc limit case when selected is null then 8 else 25 end offset case when selected is null then 0 else greatest(0,coalesce((p_filters->>'event_page')::integer,1)-1)*25 end) x),
    'event_total',(select count(*) from public.support_case_events where organization_id=p_organization_id and case_id=selected),
    'links',(select coalesce(jsonb_agg(x),'[]') from (select l.id,coalesce(l.conversation_id,l.call_id,l.work_item_id,l.invoice_id,l.asset_id,l.location_id) record_id,
      case when l.conversation_id is not null then 'conversation' when l.call_id is not null then 'call' when l.work_item_id is not null then 'work_item' when l.invoice_id is not null then 'invoice' when l.asset_id is not null then 'asset' else 'location' end kind,
      coalesce(w.title,a.name,loc.label,cv.subject,'Invoice #'||i.number::text,'Record') label, i.work_item_id invoice_work_item_id
      from public.support_case_links l left join public.work_items w on (w.organization_id,w.id)=(l.organization_id,l.work_item_id)
      left join public.assets a on (a.organization_id,a.id)=(l.organization_id,l.asset_id)
      left join public.locations loc on (loc.organization_id,loc.id)=(l.organization_id,l.location_id)
      left join public.conversations cv on (cv.organization_id,cv.id)=(l.organization_id,l.conversation_id)
      left join public.invoices i on (i.organization_id,i.id)=(l.organization_id,l.invoice_id)
      where l.organization_id=p_organization_id and l.case_id=selected) x),
    'trend',(select coalesce(jsonb_agg(x order by x."day"),'[]') from (select d::date as "day",(select count(*) from all_cases where (created_at at time zone zone)::date=d::date) created,(select count(*) from all_cases where status in ('resolved','closed') and (resolved_at at time zone zone)::date=d::date) resolved from generate_series((since at time zone zone)::date,(until_at at time zone zone)::date-1,interval '1 day') d) x),
    'priorities',(select jsonb_agg(jsonb_build_object('priority',p,'count',(select count(*) from all_cases where priority=p),'created',(select count(*) from all_cases where priority=p and created_at>=since and created_at<until_at))) from unnest(array['urgent','high','normal','low']) p),
    'period',jsonb_build_object('from',(since at time zone zone)::date,'to',(until_at at time zone zone)::date-1)
  ) into result;
  return result;
end $$;
revoke all on function public.support_read(uuid,text,jsonb) from public,anon;
grant execute on function public.support_read(uuid,text,jsonb) to authenticated;
