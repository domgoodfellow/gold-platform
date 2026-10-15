alter table public.service_disclosure_revisions add unique(organization_id,customer_id,engagement_id,disclosure_id,id);

create table public.service_reviews (
 organization_id uuid not null,
 id uuid not null default gen_random_uuid(),
 customer_id uuid not null,
 engagement_id uuid not null,
 disclosure_id uuid not null,
 revision_id uuid not null,
 deliverable_id uuid,
 state text not null default 'pending' check(state in('pending','approved','changes_requested','withdrawn','superseded')),
 version integer not null default 1 check(version in(1,2)),
 released_at timestamptz not null default now(),
 released_by uuid not null references auth.users(id),
 finished_at timestamptz,
 finished_by uuid references auth.users(id),
 portal_invite_id uuid,
 responder_name text,
 change_description text check(length(btrim(change_description)) between 1 and 3000),
 support_case_id uuid,
 primary key(organization_id,id),
 unique nulls not distinct(organization_id,revision_id,deliverable_id),
 foreign key(organization_id,customer_id,engagement_id,disclosure_id,revision_id)
  references public.service_disclosure_revisions(organization_id,customer_id,engagement_id,disclosure_id,id),
 foreign key(organization_id,revision_id,deliverable_id)
  references public.service_disclosure_deliverables(organization_id,revision_id,deliverable_id),
 foreign key(organization_id,portal_invite_id) references public.customer_portal_invites(organization_id,id),
 foreign key(organization_id,support_case_id) references public.support_cases(organization_id,id),
 check((state='pending' and version=1 and finished_at is null and finished_by is null)
  or (state<>'pending' and version=2 and finished_at is not null and finished_by is not null)),
 check((state in('approved','changes_requested'))=(portal_invite_id is not null and responder_name is not null)),
 check((state='changes_requested')=(change_description is not null and support_case_id is not null)),
 check(state='changes_requested' or (change_description is null and support_case_id is null))
);
create index service_review_customer on public.service_reviews(organization_id,customer_id,engagement_id,released_at desc,id);
create index service_review_case on public.service_reviews(organization_id,support_case_id) where support_case_id is not null;
alter table public.service_reviews enable row level security;
alter table public.service_reviews force row level security;
revoke all on public.service_reviews from public,anon,authenticated;
grant select on public.service_reviews to authenticated;
create policy service_review_read on public.service_reviews for select to authenticated
 using(organization_id in(select app.current_tenant_ids()) and app.has_capability(organization_id,'customer.update'));

create function app.preserve_service_review() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='DELETE' or old.state<>'pending' then raise exception 'Service review history is immutable' using errcode='42501'; end if;
 if (to_jsonb(new)-array['state','version','finished_at','finished_by','portal_invite_id','responder_name','change_description','support_case_id'])
  is distinct from (to_jsonb(old)-array['state','version','finished_at','finished_by','portal_invite_id','responder_name','change_description','support_case_id'])
  or new.state='pending' then raise exception 'Service review target is immutable' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function app.preserve_service_review() from public,anon,authenticated;
create trigger preserve_service_review before update or delete on public.service_reviews for each row execute function app.preserve_service_review();

-- Disclosure locks precede review locks in every command, including concurrent publication.
create function app.supersede_service_reviews() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.published_revision_id is distinct from new.published_revision_id then
  update public.service_reviews set state=case when new.published_revision_id is null then 'withdrawn' else 'superseded' end,
   version=2,finished_at=now(),finished_by=auth.uid()
   where organization_id=new.organization_id and disclosure_id=new.id and state='pending';
 end if;
 return new;
end $$;
revoke all on function app.supersede_service_reviews() from public,anon,authenticated;
create trigger supersede_service_reviews after update of published_revision_id on public.service_disclosures for each row execute function app.supersede_service_reviews();

create function public.release_service_review(p_organization_id uuid,p_customer_id uuid,p_engagement_id uuid,p_revision_id uuid,p_deliverable_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare d public.service_disclosures; result uuid;
begin
 if auth.uid() is null or not app.has_capability(p_organization_id,'customer.update') then raise exception 'Customer management permission required' using errcode='42501'; end if;
 select * into d from public.service_disclosures where organization_id=p_organization_id and customer_id=p_customer_id and engagement_id=p_engagement_id for update;
 if not found or d.published_revision_id is distinct from p_revision_id or p_revision_id is null then raise exception 'Current published review material required' using errcode='PT409'; end if;
 if exists(select 1 from public.service_disclosure_deliverables where organization_id=p_organization_id and revision_id=p_revision_id)
  and not exists(select 1 from public.service_engagements e join public.client_tenant_relationships r on r.organization_id=e.organization_id and r.id=e.relationship_id where e.organization_id=p_organization_id and e.id=p_engagement_id and r.status='active') then raise exception 'Review material unavailable' using errcode='42501'; end if;
 if p_deliverable_id is not null and not exists(select 1 from public.service_disclosure_deliverables where organization_id=p_organization_id and revision_id=p_revision_id and deliverable_id=p_deliverable_id) then raise exception 'Approved deliverable required' using errcode='42501'; end if;
 insert into public.service_reviews(organization_id,customer_id,engagement_id,disclosure_id,revision_id,deliverable_id,released_by)
  values(p_organization_id,p_customer_id,p_engagement_id,d.id,p_revision_id,p_deliverable_id,auth.uid())
  on conflict do nothing returning id into result;
 if result is null then raise exception 'Review already requested for this revision and target' using errcode='PT409'; end if;
 insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload)
  values(p_organization_id,auth.uid(),'customer',p_customer_id,'service_review.released',jsonb_build_object('reviewId',result,'revisionId',p_revision_id));
 return result;
end $$;

create function public.withdraw_service_review(p_organization_id uuid,p_customer_id uuid,p_engagement_id uuid,p_review_id uuid,p_expected_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare d public.service_disclosures;
begin
 if auth.uid() is null or not app.has_capability(p_organization_id,'customer.update') then raise exception 'Customer management permission required' using errcode='42501'; end if;
 select * into d from public.service_disclosures where organization_id=p_organization_id and customer_id=p_customer_id and engagement_id=p_engagement_id for update;
 update public.service_reviews set state='withdrawn',version=2,finished_at=now(),finished_by=auth.uid()
  where organization_id=p_organization_id and customer_id=p_customer_id and engagement_id=p_engagement_id and disclosure_id=d.id and id=p_review_id and state='pending' and version=p_expected_version;
 if not found then raise exception 'Review changed. Reload before withdrawal.' using errcode='PT409'; end if;
 insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload)
  values(p_organization_id,auth.uid(),'customer',p_customer_id,'service_review.withdrawn',jsonb_build_object('reviewId',p_review_id));
end $$;

-- Narrow Support intake. Request prose remains solely in the immutable review response.
create function app.service_review_case(r public.service_reviews) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid:=gen_random_uuid(); seq bigint; policy public.support_service_levels; title text;
begin
 select left('Changes requested: '||coalesce(d.title,v.content->>'title'),200) into title from public.service_disclosure_revisions v
  left join public.service_disclosure_deliverables d on d.organization_id=v.organization_id and d.revision_id=v.id and d.deliverable_id=r.deliverable_id
  where v.organization_id=r.organization_id and v.id=r.revision_id;
 insert into public.support_case_counters values(r.organization_id,1) on conflict(organization_id) do update set last_number=public.support_case_counters.last_number+1 returning last_number into seq;
 insert into public.support_cases(organization_id,id,case_number,title,customer_id,created_by)
  values(r.organization_id,result,'CASE-'||lpad(seq::text,greatest(4,length(seq::text)),'0'),title,r.customer_id,auth.uid());
 select * into policy from public.support_service_levels where organization_id=r.organization_id and active and priority='normal' and queue_id is null;
 if found then
  update public.support_cases set policy_id=policy.id,target_snapshot=jsonb_build_object('name',policy.name,'priority',policy.priority,'queue',policy.queue_id,'minutes',policy.target_minutes,'clock','elapsed','applied_at',now()),resolution_due_at=created_at+make_interval(mins=>policy.target_minutes) where organization_id=r.organization_id and id=result;
 end if;
 insert into public.support_case_events(organization_id,case_id,actor_id,actor_name,kind,new_value)
  values(r.organization_id,result,auth.uid(),'Portal customer','created',jsonb_build_object('reviewId',r.id));
 return result;
end $$;
revoke all on function app.service_review_case(public.service_reviews) from public,anon,authenticated;

create function public.portal_service_reviews(p_disclosure_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ctx record; result jsonb;
begin
 select * into ctx from public.portal_context();
 perform public.portal_service_disclosures(p_disclosure_id);
 select coalesce(jsonb_agg(record order by released_at desc,id),'[]'::jsonb) into result from (
  select r.id,r.released_at,jsonb_build_object('id',r.id,'revisionId',r.revision_id,'revisionNumber',v.number,'version',r.version,'state',r.state,'releasedAt',r.released_at,'finishedAt',r.finished_at,
   'targetTitle',case when r.deliverable_id is null then v.content->>'title'
    when exists(select 1 from public.service_engagements e join public.client_tenant_relationships rel on rel.organization_id=e.organization_id and rel.id=e.relationship_id where e.organization_id=r.organization_id and e.id=r.engagement_id and rel.status='active') then d.title else 'Review material unavailable' end,'changeDescription',r.change_description,
   'materialAvailable',s.published_revision_id=r.revision_id and (not exists(select 1 from public.service_disclosure_deliverables x where x.organization_id=r.organization_id and x.revision_id=r.revision_id)
    or exists(select 1 from public.service_engagements e join public.client_tenant_relationships rel on rel.organization_id=e.organization_id and rel.id=e.relationship_id where e.organization_id=r.organization_id and e.id=r.engagement_id and rel.status='active'))) record
  from public.service_reviews r join public.service_disclosure_revisions v on v.organization_id=r.organization_id and v.id=r.revision_id
  join public.service_disclosures s on s.organization_id=r.organization_id and s.id=r.disclosure_id
  left join public.service_disclosure_deliverables d on d.organization_id=r.organization_id and d.revision_id=r.revision_id and d.deliverable_id=r.deliverable_id
  where r.organization_id=ctx.organization_id and r.customer_id=ctx.customer_id and r.disclosure_id=p_disclosure_id order by r.released_at desc,r.id limit 50
 ) records;
 return result;
end $$;

create function public.respond_service_review(p_review_id uuid,p_expected_version integer,p_decision text,p_description text default null)
returns void language plpgsql security definer set search_path='' as $$
declare ctx record; r public.service_reviews; d public.service_disclosures; case_id uuid; actor_name text;
begin
 select * into ctx from public.portal_context();
 if ctx.organization_id is null or not app.portal_exposed(ctx.organization_id,'services') then raise exception 'Services are not available in this Portal' using errcode='42501'; end if;
 select s.* into d from public.service_disclosures s join public.service_reviews x on x.organization_id=s.organization_id and x.disclosure_id=s.id
  where x.organization_id=ctx.organization_id and x.customer_id=ctx.customer_id and x.id=p_review_id for update of s;
 if not found then raise exception 'Customer review unavailable' using errcode='42501'; end if;
 select * into r from public.service_reviews where organization_id=ctx.organization_id and customer_id=ctx.customer_id and id=p_review_id for update;
 if r.state<>'pending' or r.version is distinct from p_expected_version or d.published_revision_id is distinct from r.revision_id then raise exception 'Review changed. Reload before responding.' using errcode='PT409'; end if;
 perform public.portal_service_disclosures(d.id);
 -- Lock the relationship so ending it and responding cannot both observe active material.
 if exists(select 1 from public.service_disclosure_deliverables where organization_id=r.organization_id and revision_id=r.revision_id) then
  perform 1 from public.client_tenant_relationships rel join public.service_engagements e on e.organization_id=rel.organization_id and e.relationship_id=rel.id
   where e.organization_id=r.organization_id and e.id=r.engagement_id and rel.status='active' for share of rel;
  if not found then raise exception 'Review material unavailable' using errcode='42501'; end if;
 end if;
 if p_decision is null or p_decision not in('approved','changes_requested')
  or (p_decision='changes_requested' and not coalesce(app.portal_text(to_jsonb(p_description),3000),false))
  or (p_decision='approved' and p_description is not null) then raise exception 'Choose a decision and provide a description of at most 3000 characters for changes.' using errcode='22023'; end if;
 select name into actor_name from public.customers where organization_id=r.organization_id and id=r.customer_id;
 if p_decision='changes_requested' then case_id:=app.service_review_case(r); end if;
 update public.service_reviews set state=p_decision,version=2,finished_at=now(),finished_by=auth.uid(),portal_invite_id=ctx.portal_invite_id,
  responder_name=actor_name,change_description=case when p_decision='changes_requested' then btrim(p_description) end,support_case_id=case_id where organization_id=r.organization_id and id=r.id;
 insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload)
  values(r.organization_id,auth.uid(),'customer',r.customer_id,'service_review.'||p_decision,jsonb_build_object('reviewId',r.id,'revisionId',r.revision_id));
end $$;

create function public.support_service_review(p_organization_id uuid,p_case_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not app.has_capability(p_organization_id,'support.read') then raise exception 'Support permission required' using errcode='42501'; end if;
 return (select jsonb_build_object('reviewId',r.id,'engagementId',r.engagement_id,'customerId',r.customer_id,'revisionNumber',v.number,'targetTitle',coalesce(d.title,v.content->>'title'),'description',r.change_description,'respondedAt',r.finished_at,'responderName',r.responder_name)
  from public.service_reviews r join public.service_disclosure_revisions v on v.organization_id=r.organization_id and v.id=r.revision_id
  left join public.service_disclosure_deliverables d on d.organization_id=r.organization_id and d.revision_id=r.revision_id and d.deliverable_id=r.deliverable_id
  where r.organization_id=p_organization_id and r.support_case_id=p_case_id);
end $$;
revoke all on function public.release_service_review(uuid,uuid,uuid,uuid,uuid),public.withdraw_service_review(uuid,uuid,uuid,uuid,integer),public.portal_service_reviews(uuid),public.respond_service_review(uuid,integer,text,text),public.support_service_review(uuid,uuid) from public,anon,authenticated;
grant execute on function public.release_service_review(uuid,uuid,uuid,uuid,uuid),public.withdraw_service_review(uuid,uuid,uuid,uuid,integer),public.portal_service_reviews(uuid),public.respond_service_review(uuid,integer,text,text),public.support_service_review(uuid,uuid) to authenticated;
