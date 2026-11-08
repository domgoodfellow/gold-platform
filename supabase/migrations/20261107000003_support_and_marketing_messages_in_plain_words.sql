-- Seven messages two database functions raise, in plain sentences (Work Order 4 follow-up).
-- Behaviour is unchanged: each function is its live definition with only these message
-- strings replaced. Left as they are, because no person's action reaches them: 'shape' (raised
-- and caught inside app.form_answers_problem, which returns its own sentence), 'readings must be
-- an array' (a malformed request from a device sender) and 'Unsupported Support command' (an
-- unknown command name, which only a bug can send).

CREATE OR REPLACE FUNCTION public.support_command(p_organization_id uuid, p_command text, p_input jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      if not found then raise exception 'That queue is no longer available.'; end if;
    end if;
    return result;
  elsif p_command in ('policy.create','policy.edit') then
    if nullif(p_input->>'queue','') is not null and not exists(select 1 from public.support_queues where organization_id=p_organization_id and id=(p_input->>'queue')::uuid and active) then raise exception 'This case’s queue is no longer active. Choose another queue first.'; end if;
    if p_command='policy.create' then
      insert into public.support_service_levels(organization_id,id,name,priority,queue_id,target_minutes,active,created_by)
        values(p_organization_id,result,btrim(p_input->>'name'),p_input->>'priority',nullif(p_input->>'queue','')::uuid,(p_input->>'minutes')::integer,coalesce((p_input->>'active')::boolean,true),actor);
    else
      update public.support_service_levels set name=btrim(p_input->>'name'),priority=p_input->>'priority',queue_id=nullif(p_input->>'queue','')::uuid,
        target_minutes=(p_input->>'minutes')::integer,active=(p_input->>'active')::boolean,updated_at=now() where organization_id=p_organization_id and id=result;
      if not found then raise exception 'That service level is no longer available.'; end if;
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
    if c.queue_id is not null and not exists(select 1 from public.support_queues where organization_id=p_organization_id and id=c.queue_id and active) then raise exception 'This case’s queue is no longer active. Choose another queue first.'; end if;
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
        if c.queue_id is not null and c.queue_id is distinct from old_c.queue_id and not exists(select 1 from public.support_queues where organization_id=p_organization_id and id=c.queue_id and active) then raise exception 'This case’s queue is no longer active. Choose another queue first.'; end if;
        event_kind:=case when c.queue_id is distinct from old_c.queue_id then 'queue' else 'assignment' end;
      when 'case.priority' then c.priority:=p_input->>'priority'; event_kind:='priority';
      when 'case.status' then
        target_status:=p_input->>'status';
        if not ((c.status='new' and target_status in ('open','waiting')) or (c.status='open' and target_status='waiting') or (c.status='waiting' and target_status='open')) then raise exception 'This case can’t move to that status from where it is now.'; end if;
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
        if not found then raise exception 'That link is no longer there.'; end if;event_kind:='unlinked';
      else raise exception 'Unsupported Support command';
    end case;
    if c.queue_id is not null and c.queue_id is distinct from old_c.queue_id and not exists(select 1 from public.support_queues where organization_id=p_organization_id and id=c.queue_id and active) then raise exception 'This case’s queue is no longer active. Choose another queue first.'; end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_command(p_organization_id uuid, p_command text, p_input jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        (c.status='paused' and target in ('active','completed','archived')) or (c.status='completed' and target='archived')) then raise exception 'This campaign can’t be changed that way from where it is now.'; end if;
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
      if target not in ('in_review','disqualified') or i.status='disqualified' then raise exception 'This inquiry can’t be changed that way from where it is now.'; end if;
      update public.marketing_inquiries set status=target,reviewed_by=actor,reviewed_at=now() where organization_id=p_organization_id and id=result;
    else
      if i.status='disqualified' then raise exception 'Disqualified inquiries cannot be handed off'; end if;
      customer:=coalesce(nullif(p_input->>'customer','')::uuid,i.customer_id);
      if customer is null and p_command='inquiry.handoff' and p_input->>'create'='true' then
        if not app.has_capability(p_organization_id,'customer.create') then raise exception 'Customer creation permission required' using errcode='42501'; end if;
        customer:=public.create_customer(p_organization_id,btrim(p_input->>'name'),nullif(lower(btrim(p_input->>'email')),''),nullif(btrim(p_input->>'phone'),''),'{}');
      end if;
      if customer is null or not exists(select 1 from public.contacts where organization_id=p_organization_id and id=customer) then raise exception 'Select a Customer in this organization'; end if;
      update public.marketing_inquiries set customer_id=customer,status=case when p_command='inquiry.handoff' then 'handed_off' else 'in_review' end,
        reviewed_by=actor,reviewed_at=now(),handed_off_at=case when p_command='inquiry.handoff' then now() end where organization_id=p_organization_id and id=result;
    end if;
  else raise exception 'Unknown Marketing command' using errcode='22023'; end if;
  insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload)
    values(p_organization_id,actor,case when p_command like 'campaign.%' then 'marketing_campaign' when p_command like 'audience.%' then 'marketing_audience' else 'marketing_inquiry' end,result,p_command,
      jsonb_strip_nulls(jsonb_build_object('status',p_input->>'status','customer_id',customer,'form_id',p_input->>'form','audience_id',p_input->>'audience','page_id',p_input->>'page')));
  return result;
end $function$;
