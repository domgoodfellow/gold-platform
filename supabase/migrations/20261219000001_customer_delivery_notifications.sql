create table public.customer_notification_settings (
 organization_id uuid not null, customer_id uuid not null, email_identity_id uuid not null,
 primary key(organization_id,customer_id),
 foreign key(organization_id,customer_id) references public.customers(organization_id,id),
 foreign key(organization_id,email_identity_id) references public.email_identities(organization_id,id)
);
create table public.customer_notification_recipients (
 organization_id uuid not null, customer_id uuid not null, id uuid not null default gen_random_uuid(),
 email_address text not null check(email_address=lower(btrim(email_address)) and length(email_address)<=254 and email_address ~ '^[^@\s]{1,64}@[^@\s]+\.[^@\s]+$'),
 purposes text[] not null check(purposes <@ array['service_review_requested','service_update_published','service_review_status_changed']::text[]),
 verified_at timestamptz not null, consent_at timestamptz not null, established_by uuid not null references auth.users(id),
 portal_invite_id uuid not null, withdrawn_at timestamptz, withdrawn_by uuid references auth.users(id),
 verification_method text not null default 'mailbox_code' check(verification_method='mailbox_code'),
 primary key(organization_id,id), unique(organization_id,customer_id), unique(organization_id,customer_id,id),
 foreign key(organization_id,customer_id) references public.customers(organization_id,id),
 foreign key(organization_id,portal_invite_id) references public.customer_portal_invites(organization_id,id)
);
create table public.email_recipient_suppressions (
 organization_id uuid not null references public.organizations(id), email_address text not null,
 reason text not null check(reason in('bounced','complained','rejected')), message_id uuid not null,
 created_at timestamptz not null default now(), primary key(organization_id,email_address),
 foreign key(organization_id,message_id) references public.messages(organization_id,id)
);
create table public.service_notification_intents (
 organization_id uuid not null, id uuid not null default gen_random_uuid(), customer_id uuid not null,
 engagement_id uuid not null, revision_id uuid not null, disclosure_id uuid not null, review_id uuid,
 purpose text not null check(purpose in('service_review_requested','service_update_published','service_review_status_changed')),
 template_version integer not null default 1 check(template_version=1),
 requested boolean not null, recipient_id uuid, email_address text, email_identity_id uuid,
 state text not null check(state in('not_requested','suppressed','queued','failed')),
 reason text, created_at timestamptz not null default now(), created_by uuid not null references auth.users(id),
 primary key(organization_id,id), unique nulls not distinct(organization_id,revision_id,review_id,purpose),
 foreign key(organization_id,customer_id,engagement_id,disclosure_id,revision_id) references public.service_disclosure_revisions(organization_id,customer_id,engagement_id,disclosure_id,id),
 foreign key(organization_id,review_id) references public.service_reviews(organization_id,id),
 foreign key(organization_id,customer_id,recipient_id) references public.customer_notification_recipients(organization_id,customer_id,id),
 foreign key(organization_id,email_identity_id) references public.email_identities(organization_id,id)
);
-- Verification messages share Communications storage, but neither operators nor Portal holders
-- may read the code back through the Data API. Only a narrow worker claim returns its body.
create table app.notification_challenges (
 organization_id uuid not null, customer_id uuid not null, id uuid not null default gen_random_uuid(),
 email_address text not null, purposes text[] not null, code_hash bytea not null,
 actor_id uuid not null references auth.users(id), portal_invite_id uuid not null,
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '20 minutes',
 guesses integer not null default 0, confirmed_at timestamptz,
 primary key(organization_id,id),
 foreign key(organization_id,customer_id) references public.customers(organization_id,id)
);
create index notification_challenge_customer on app.notification_challenges(organization_id,customer_id,created_at desc);
create table app.notification_jobs (
 organization_id uuid not null, id uuid not null default gen_random_uuid(), customer_id uuid not null,
 intent_id uuid, challenge_id uuid, message_id uuid not null, email_identity_id uuid not null,
 state text not null default 'queued' check(state in('queued','sending','accepted','suppressed','failed')),
 attempts integer not null default 0, lease_id uuid, lease_until timestamptz,
 next_attempt_at timestamptz not null default now(), first_attempt_at timestamptz,
 created_at timestamptz not null default now(), reason text,
 primary key(organization_id,id), unique(organization_id,message_id), unique(organization_id,intent_id),
 foreign key(organization_id,customer_id) references public.customers(organization_id,id),
 foreign key(organization_id,intent_id) references public.service_notification_intents(organization_id,id),
 foreign key(organization_id,challenge_id) references app.notification_challenges(organization_id,id),
 foreign key(organization_id,message_id) references public.messages(organization_id,id),
 foreign key(organization_id,email_identity_id) references public.email_identities(organization_id,id),
 check((intent_id is null)<>(challenge_id is null))
);
create index notification_jobs_due on app.notification_jobs(next_attempt_at) where state in('queued','sending');
create table public.service_notification_attempts (
 organization_id uuid not null, id uuid not null, intent_id uuid not null, message_id uuid not null,
 started_at timestamptz not null default now(), finished_at timestamptz, outcome text, detail text,
 primary key(organization_id,id),
 foreign key(organization_id,intent_id) references public.service_notification_intents(organization_id,id),
 foreign key(organization_id,message_id) references public.messages(organization_id,id)
);
create index service_notification_customer on public.service_notification_intents(organization_id,customer_id,engagement_id,created_at desc);
create index service_notification_attempt_history on public.service_notification_attempts(organization_id,intent_id,started_at);
create index notification_customer_jobs on app.notification_jobs(organization_id,customer_id) where state='queued' and intent_id is not null;
do $$ declare t text; begin
 foreach t in array array['customer_notification_settings','customer_notification_recipients','email_recipient_suppressions','service_notification_intents','service_notification_attempts'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy notification_operator_read on public.%I for select to authenticated using(organization_id in(select app.current_tenant_ids()) and app.has_capability(organization_id,''customer.update''))',t);
 end loop;
end $$;
alter table app.notification_challenges enable row level security;
alter table app.notification_jobs enable row level security;
revoke all on app.notification_challenges,app.notification_jobs from public,anon,authenticated;

create function app.notification_verification_message(org uuid,msg uuid) returns boolean language sql stable security definer set search_path='' as $$
 select org in(select app.current_tenant_ids()) and exists(select 1 from app.notification_jobs where organization_id=org and message_id=msg and challenge_id is not null)
$$;
revoke all on function app.notification_verification_message(uuid,uuid) from public;
grant execute on function app.notification_verification_message(uuid,uuid) to authenticated;
create policy hide_notification_verification on public.messages as restrictive for select to authenticated using(not app.notification_verification_message(organization_id,id));
create policy hide_notification_verification on public.email_message_details as restrictive for select to authenticated using(not app.notification_verification_message(organization_id,message_id));

create function public.set_customer_notification_sender(p_organization_id uuid,p_customer_id uuid,p_email_identity_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not app.has_capability(p_organization_id,'customer.update') or not app.has_capability(p_organization_id,'message.send') then raise exception 'Customer management and email sending permission required' using errcode='42501'; end if;
 if not app.email_identity_ready(p_organization_id,p_email_identity_id) then raise exception 'Choose a ready Communications email identity' using errcode='55000'; end if;
 insert into public.customer_notification_settings values(p_organization_id,p_customer_id,p_email_identity_id) on conflict(organization_id,customer_id) do update set email_identity_id=excluded.email_identity_id;
end $$;

create function app.notification_suppressed(org uuid,address text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.email_recipient_suppressions where organization_id=org and email_address=address)
$$;
revoke all on function app.notification_suppressed(uuid,text) from public,anon,authenticated;
create function app.notification_suppress_from_event() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.event_type in('bounced','complained') or (new.event_type='rejected' and new.provider_event_id not like 'send:%') then
  insert into public.email_recipient_suppressions(organization_id,email_address,reason,message_id)
   select new.organization_id,lower(a),new.event_type,new.message_id from public.email_message_details d cross join lateral unnest(d.to_addresses) a
   where d.organization_id=new.organization_id and d.message_id=new.message_id on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function app.notification_suppress_from_event() from public,anon,authenticated;
create trigger notification_email_suppression after insert on public.message_events for each row execute function app.notification_suppress_from_event();
insert into public.email_recipient_suppressions(organization_id,email_address,reason,message_id)
 select e.organization_id,lower(a),e.event_type,e.message_id from public.message_events e join public.email_message_details d using(organization_id,message_id)
 cross join lateral unnest(d.to_addresses) a where e.event_type in('bounced','complained') or (e.event_type='rejected' and e.provider_event_id not like 'send:%') order by e.occurred_at on conflict do nothing;

create function app.queue_customer_notification(org uuid,customer uuid,identity_id uuid,address text,subject text,body text,key text) returns uuid language plpgsql security definer set search_path='' as $$
declare identity public.email_identities; conv uuid; msg uuid;
begin
 select * into identity from public.email_identities where organization_id=org and id=identity_id;
 if not app.email_identity_ready(org,identity_id) or app.notification_suppressed(org,address) then raise exception 'Notification email unavailable' using errcode='55000'; end if;
 insert into public.conversations(organization_id,channel,email_identity_id,external_email,customer_id,subject,last_message_preview,unread)
 values(org,'email',identity.id,address,customer,subject,'Customer notification',false) returning id into conv;
 insert into public.messages(organization_id,conversation_id,direction,status,body,requested_transport,idempotency_key,created_by,intent)
 values(org,conv,'outbound','queued',body,'email',key,auth.uid(),'transactional') returning id into msg;
 insert into public.email_message_details(organization_id,message_id,subject,from_address,from_name,to_addresses) values(org,msg,subject,identity.address,identity.display_name,array[address]);
 insert into public.message_events(organization_id,message_id,event_type,status_after) values(org,msg,'queued','queued');
 return msg;
end $$;
revoke all on function app.queue_customer_notification(uuid,uuid,uuid,text,text,text,text) from public,anon,authenticated;

create function public.propose_notification_recipient(p_email_address text,p_purposes text[]) returns uuid language plpgsql security definer set search_path='' as $$
declare ctx record; identity_id uuid; address text:=lower(btrim(p_email_address)); code text:=encode(extensions.gen_random_bytes(8),'hex'); challenge uuid; msg uuid;
begin
 select * into ctx from public.portal_context();
 if ctx.organization_id is null then raise exception 'Portal unavailable' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(ctx.organization_id::text||ctx.customer_id::text,0));
 if address is null or length(address)>254 or address !~ '^[^@\s]{1,64}@[^@\s]+\.[^@\s]+$' or p_purposes is null or cardinality(p_purposes)=0 or not p_purposes <@ array['service_review_requested','service_update_published','service_review_status_changed']::text[] then raise exception 'Choose an email address and notification purposes' using errcode='22023'; end if;
 if exists(select 1 from app.notification_challenges where organization_id=ctx.organization_id and customer_id=ctx.customer_id and created_at>now()-interval '1 minute') or (select count(*) from app.notification_challenges where organization_id=ctx.organization_id and customer_id=ctx.customer_id and created_at>now()-interval '1 hour')>=5 then raise exception 'Please wait before requesting another confirmation' using errcode='PT429'; end if;
 select email_identity_id into identity_id from public.customer_notification_settings where organization_id=ctx.organization_id and customer_id=ctx.customer_id;
 if identity_id is null or not app.email_identity_ready(ctx.organization_id,identity_id) or app.notification_suppressed(ctx.organization_id,address) then raise exception 'The service organization must configure a ready email sender, and the address must be eligible' using errcode='55000'; end if;
 insert into app.notification_challenges(organization_id,customer_id,email_address,purposes,code_hash,actor_id,portal_invite_id)
 values(ctx.organization_id,ctx.customer_id,address,p_purposes,extensions.digest(code,'sha256'),auth.uid(),ctx.portal_invite_id) returning id into challenge;
 msg:=app.queue_customer_notification(ctx.organization_id,ctx.customer_id,identity_id,address,'Confirm service notifications',
 'Enter this confirmation code in the Portal session where you requested service notifications: '||code||E'\n\nThis code expires in 20 minutes. It confirms only the purposes you selected. If you did not request it, ignore this email. This email grants no Portal access.', 'notification-confirm:'||challenge);
 insert into app.notification_jobs(organization_id,customer_id,challenge_id,message_id,email_identity_id) values(ctx.organization_id,ctx.customer_id,challenge,msg,identity_id);
 return challenge;
end $$;

create function public.confirm_notification_recipient(p_challenge_id uuid,p_code text) returns boolean language plpgsql security definer set search_path='' as $$
declare ctx record; challenge app.notification_challenges;
begin
 select * into ctx from public.portal_context();
 if ctx.organization_id is null then raise exception 'Portal unavailable' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(ctx.organization_id::text||ctx.customer_id::text,0));
 select * into challenge from app.notification_challenges where organization_id=ctx.organization_id and customer_id=ctx.customer_id and actor_id=auth.uid() and id=p_challenge_id for update;
 if not found or challenge.confirmed_at is not null or challenge.expires_at<=now() or challenge.guesses>=5 then return false; end if;
 update app.notification_challenges set guesses=guesses+1 where organization_id=ctx.organization_id and id=challenge.id;
 if extensions.digest(lower(btrim(coalesce(p_code,''))),'sha256')<>challenge.code_hash or app.notification_suppressed(ctx.organization_id,challenge.email_address) then return false; end if;
 -- Reconfirmation invalidates queued notices for the previous consent.
 update public.customer_notification_recipients set withdrawn_at=now(),withdrawn_by=auth.uid(),purposes='{}' where organization_id=ctx.organization_id and customer_id=ctx.customer_id;
 perform app.cancel_customer_notifications(ctx.organization_id,ctx.customer_id);
 insert into public.customer_notification_recipients(organization_id,customer_id,email_address,purposes,verified_at,consent_at,established_by,portal_invite_id)
 values(ctx.organization_id,ctx.customer_id,challenge.email_address,challenge.purposes,now(),now(),auth.uid(),ctx.portal_invite_id)
 on conflict(organization_id,customer_id) do update set id=customer_notification_recipients.id,email_address=excluded.email_address,purposes=excluded.purposes,verified_at=excluded.verified_at,consent_at=excluded.consent_at,established_by=excluded.established_by,portal_invite_id=excluded.portal_invite_id,withdrawn_at=null,withdrawn_by=null;
 update app.notification_challenges set confirmed_at=now() where organization_id=ctx.organization_id and id=challenge.id;
 insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload) values(ctx.organization_id,auth.uid(),'customer',ctx.customer_id,'notification.consent_recorded',jsonb_build_object('challengeId',challenge.id,'purposes',challenge.purposes,'method','mailbox_code'));
 return true;
end $$;

create function app.cancel_customer_notifications(org uuid,customer uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update app.notification_jobs set state='suppressed',reason='Recipient consent changed' where organization_id=org and customer_id=customer and intent_id is not null and state='queued';
 update public.messages m set status='rejected',failure_reason='Recipient consent changed' from app.notification_jobs j where j.organization_id=org and j.customer_id=customer and j.state='suppressed' and m.organization_id=j.organization_id and m.id=j.message_id and m.status='queued';
 update public.service_notification_intents i set state='suppressed',reason='Recipient consent changed' where i.organization_id=org and i.customer_id=customer and exists(select 1 from app.notification_jobs j where j.organization_id=org and j.intent_id=i.id and j.state='suppressed');
end $$;
revoke all on function app.cancel_customer_notifications(uuid,uuid) from public,anon,authenticated;
create function public.withdraw_notification_consent() returns void language plpgsql security definer set search_path='' as $$
declare ctx record;
begin
 select * into ctx from public.portal_context();
 if ctx.organization_id is null then raise exception 'Portal unavailable' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(ctx.organization_id::text||ctx.customer_id::text,0));
 update public.customer_notification_recipients set purposes='{}',withdrawn_at=now(),withdrawn_by=auth.uid() where organization_id=ctx.organization_id and customer_id=ctx.customer_id and established_by=auth.uid() and withdrawn_at is null;
 if not found then raise exception 'Confirm your email in this Portal session before changing preferences' using errcode='42501'; end if;
 perform app.cancel_customer_notifications(ctx.organization_id,ctx.customer_id);
 insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload) values(ctx.organization_id,auth.uid(),'customer',ctx.customer_id,'notification.consent_withdrawn','{}');
end $$;
create function public.portal_notification_preferences() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ctx record; result jsonb;
begin
 select * into ctx from public.portal_context();
 if ctx.organization_id is null then raise exception 'Portal unavailable' using errcode='42501'; end if;
 select jsonb_build_object('emailAddress',email_address,'purposes',purposes,'verifiedAt',verified_at,'withdrawnAt',withdrawn_at,'mayWithdraw',established_by=auth.uid()) into result from public.customer_notification_recipients where organization_id=ctx.organization_id and customer_id=ctx.customer_id and established_by=auth.uid();
 return result;
end $$;

create function app.notification_ineligibility(i public.service_notification_intents) returns text language plpgsql stable security definer set search_path='' as $$
declare r public.customer_notification_recipients;
begin
 select * into r from public.customer_notification_recipients where organization_id=i.organization_id and customer_id=i.customer_id and id=i.recipient_id;
 if r.id is null or r.withdrawn_at is not null or not i.purpose=any(r.purposes) or r.email_address is distinct from i.email_address or r.consent_at>i.created_at then return 'No verified recipient has opted in to this purpose'; end if;
 if app.notification_suppressed(i.organization_id,r.email_address) then return 'Communications has suppressed this recipient address'; end if;
 if i.email_identity_id is null or not app.email_identity_ready(i.organization_id,i.email_identity_id) then return 'Email identity is not ready; configure Communications'; end if;
 if i.purpose<>'service_review_status_changed' and not exists(select 1 from public.service_disclosures d where d.organization_id=i.organization_id and d.customer_id=i.customer_id and d.engagement_id=i.engagement_id and d.id=i.disclosure_id and d.published_revision_id=i.revision_id) then return 'Publication has been withdrawn or superseded'; end if;
 if i.review_id is not null and not exists(select 1 from public.service_reviews where organization_id=i.organization_id and customer_id=i.customer_id and engagement_id=i.engagement_id and revision_id=i.revision_id and id=i.review_id and ((i.purpose='service_review_status_changed' and state in('withdrawn','superseded')) or (i.purpose<>'service_review_status_changed' and state='pending'))) then return 'Review is no longer eligible'; end if;
 if exists(select 1 from public.service_engagements e join public.client_tenant_relationships rel on rel.organization_id=e.organization_id and rel.id=e.relationship_id where e.organization_id=i.organization_id and e.id=i.engagement_id and rel.status<>'active') then return 'Service relationship ended'; end if;
 return null;
end $$;
revoke all on function app.notification_ineligibility(public.service_notification_intents) from public,anon,authenticated;
create function app.notification_portal_destination(org uuid) returns text language sql stable security definer set search_path='' as $$
 with candidates as (
  select hostname,0 priority,is_primary,created_at from public.organization_domains
   where organization_id=org and surface='portal' and verification_state='verified' and ssl_state='issued' and released_at is null
  union all
  select o.slug||'.'||s.platform_public_domain,1,false,o.created_at from public.organizations o cross join public.platform_settings s where o.id=org and s.singleton
 )
 select 'https://'||c.hostname||'/portal' from candidates c where exists(select 1 from app.resolve_hostname(c.hostname) h where h.organization_id=org and (h.surface='portal' or app.portal_managed_host(org,c.hostname)))
 order by c.priority,c.is_primary desc,c.created_at limit 1
$$;
revoke all on function app.notification_portal_destination(uuid) from public,anon,authenticated;
create function app.enqueue_service_notification(i public.service_notification_intents) returns uuid language plpgsql security definer set search_path='' as $$
declare msg uuid; title text; destination text:=app.notification_portal_destination(i.organization_id);
begin
 title:=case i.purpose when 'service_review_requested' then 'A deliverable is ready for your review' when 'service_review_status_changed' then 'A customer review request has been withdrawn' else 'A service update is available' end;
 msg:=app.queue_customer_notification(i.organization_id,i.customer_id,i.email_identity_id,i.email_address,title,
  title||'.'||coalesce(E'\n\nPortal: '||destination,'')||E'\n\nOpen your customer Portal using your existing access link. If your session has ended, ask the service organization to resend your Portal invitation. This notification grants no access and does not record a review decision.\n\nManage email notification preferences in your Portal.', 'service-notification:'||i.id);
 insert into app.notification_jobs(organization_id,customer_id,intent_id,message_id,email_identity_id) values(i.organization_id,i.customer_id,i.id,msg,i.email_identity_id);
 insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload) values(i.organization_id,auth.uid(),'customer',i.customer_id,'notification.delivery_requested',jsonb_build_object('intentId',i.id,'messageId',msg));
 return msg;
end $$;
revoke all on function app.enqueue_service_notification(public.service_notification_intents) from public,anon,authenticated;

create function app.notification_retry_eligible(i public.service_notification_intents) returns boolean language plpgsql stable security definer set search_path='' as $$
declare j app.notification_jobs;
begin
 if i.state in('not_requested','suppressed') then return false; end if;
 select * into j from app.notification_jobs where organization_id=i.organization_id and intent_id=i.id;
 if j.id is null then
  if i.state<>'failed' then return false; end if;
  select email_identity_id into i.email_identity_id from public.customer_notification_settings where organization_id=i.organization_id and customer_id=i.customer_id;
 else
  if j.state not in('failed','queued') or j.reason is null or j.attempts>=5 or j.first_attempt_at<now()-interval '23 hours' or exists(select 1 from public.messages where organization_id=i.organization_id and id=j.message_id and external_id is not null) then return false; end if;
 end if;
 return app.notification_ineligibility(i) is null;
end $$;
revoke all on function app.notification_retry_eligible(public.service_notification_intents) from public,anon,authenticated;

create function app.create_service_notification(org uuid,customer uuid,engagement uuid,revision uuid,review uuid,purpose text,requested boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare i public.service_notification_intents;
begin
 perform pg_advisory_xact_lock(hashtextextended(org::text||customer::text,0));
 i.organization_id:=org; i.customer_id:=customer; i.engagement_id:=engagement; i.revision_id:=revision; i.review_id:=review; i.purpose:=purpose; i.requested:=requested; i.created_at:=now();
 select disclosure_id into i.disclosure_id from public.service_disclosure_revisions where organization_id=org and customer_id=customer and engagement_id=engagement and id=revision;
 select id,email_address into i.recipient_id,i.email_address from public.customer_notification_recipients where organization_id=org and customer_id=customer;
 select email_identity_id into i.email_identity_id from public.customer_notification_settings where organization_id=org and customer_id=customer;
 i.reason:=case when requested then app.notification_ineligibility(i) end;
 i.state:=case when not requested then 'not_requested' when i.reason like 'Email identity%' then 'failed' when i.reason is not null then 'suppressed' else 'queued' end;
 insert into public.service_notification_intents(organization_id,customer_id,engagement_id,revision_id,disclosure_id,review_id,purpose,requested,recipient_id,email_address,email_identity_id,state,reason,created_by)
 values(org,customer,engagement,revision,i.disclosure_id,review,purpose,requested,i.recipient_id,i.email_address,i.email_identity_id,i.state,i.reason,auth.uid())
 on conflict do nothing returning id into i.id;
 if i.id is null then select id into i.id from public.service_notification_intents where organization_id=org and revision_id=revision and review_id is not distinct from review and service_notification_intents.purpose=create_service_notification.purpose; return i.id; end if;
 if i.state='queued' then perform app.enqueue_service_notification(i); end if;
 insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload) values(org,auth.uid(),'customer',customer,'notification.intent_created',jsonb_build_object('intentId',i.id,'state',i.state,'purpose',purpose));
 return i.id;
end $$;
revoke all on function app.create_service_notification(uuid,uuid,uuid,uuid,uuid,text,boolean) from public,anon,authenticated;

create function public.release_service_review_notification(p_organization_id uuid,p_customer_id uuid,p_engagement_id uuid,p_revision_id uuid,p_deliverable_id uuid default null,p_notify boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if auth.uid() is null or not app.has_capability(p_organization_id,'customer.update') then raise exception 'Customer management permission required' using errcode='42501'; end if;
 if p_notify and not app.has_capability(p_organization_id,'message.send') then raise exception 'Email sending permission required' using errcode='42501'; end if;
 perform 1 from public.service_disclosures where organization_id=p_organization_id and customer_id=p_customer_id and engagement_id=p_engagement_id for update;
 select id into result from public.service_reviews where organization_id=p_organization_id and customer_id=p_customer_id and engagement_id=p_engagement_id and revision_id=p_revision_id and deliverable_id is not distinct from p_deliverable_id;
 if result is not null then return result; end if;
 result:=public.release_service_review(p_organization_id,p_customer_id,p_engagement_id,p_revision_id,p_deliverable_id);
 perform app.create_service_notification(p_organization_id,p_customer_id,p_engagement_id,p_revision_id,result,'service_review_requested',coalesce(p_notify,false));
 return result;
end $$;
create function public.publish_service_disclosure_notification(p_organization_id uuid,p_customer_id uuid,p_engagement_id uuid,p_expected_version integer,p_notify boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare revision uuid;
begin
 if auth.uid() is null or not app.has_capability(p_organization_id,'customer.update') then raise exception 'Customer management permission required' using errcode='42501'; end if;
 if p_notify and not app.has_capability(p_organization_id,'message.send') then raise exception 'Email sending permission required' using errcode='42501'; end if;
 revision:=public.publish_service_disclosure(p_organization_id,p_customer_id,p_engagement_id,p_expected_version);
 perform app.create_service_notification(p_organization_id,p_customer_id,p_engagement_id,revision,null,'service_update_published',coalesce(p_notify,false));
 return revision;
end $$;

create function public.withdraw_service_review_notification(p_organization_id uuid,p_customer_id uuid,p_engagement_id uuid,p_review_id uuid,p_expected_version integer,p_notify boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare r public.service_reviews;
begin
 if auth.uid() is null or not app.has_capability(p_organization_id,'customer.update') or (p_notify and not app.has_capability(p_organization_id,'message.send')) then raise exception 'Customer management and requested email sending permission required' using errcode='42501'; end if;
 perform 1 from public.service_disclosures where organization_id=p_organization_id and customer_id=p_customer_id and engagement_id=p_engagement_id for update;
 select * into r from public.service_reviews where organization_id=p_organization_id and customer_id=p_customer_id and engagement_id=p_engagement_id and id=p_review_id;
 if r.state='withdrawn' and exists(select 1 from public.service_notification_intents where organization_id=p_organization_id and review_id=p_review_id and purpose='service_review_status_changed') then return; end if;
 perform public.withdraw_service_review(p_organization_id,p_customer_id,p_engagement_id,p_review_id,p_expected_version);
 perform app.create_service_notification(p_organization_id,p_customer_id,p_engagement_id,r.revision_id,r.id,'service_review_status_changed',coalesce(p_notify,false));
end $$;
revoke all on function public.withdraw_service_review_notification(uuid,uuid,uuid,uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.withdraw_service_review_notification(uuid,uuid,uuid,uuid,integer,boolean) to authenticated;

-- A notification worker can read only a leased job, never arbitrary messages or recipients.
do $$ begin if not exists(select 1 from pg_roles where rolname='customer_notification_worker') then create role customer_notification_worker nologin noinherit; end if; end $$;
grant customer_notification_worker to authenticator;
grant usage on schema public to customer_notification_worker;
insert into auth.users(id,aud,role) values('00000000-0000-4000-8000-0000000000b1','authenticated','authenticated') on conflict do nothing;
create function public.claim_customer_notification(p_job_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare j app.notification_jobs; i public.service_notification_intents; c app.notification_challenges; v_reason text; details public.email_message_details; provider text; account uuid;
begin
 select * into j from app.notification_jobs where (p_job_id is null or id=p_job_id) and ((state='queued' and next_attempt_at<=now()) or (state='sending' and lease_until<now())) order by next_attempt_at for update skip locked limit 1;
 if not found then return null; end if;
 if j.state='sending' then update public.service_notification_attempts set finished_at=now(),outcome='lease_expired' where organization_id=j.organization_id and id=j.lease_id and finished_at is null; end if;
 if j.attempts>=5 or j.first_attempt_at<now()-interval '23 hours' then v_reason:='Retry limit reached; provider idempotency window must not be exceeded';
 elsif j.intent_id is not null then
  select * into i from public.service_notification_intents where organization_id=j.organization_id and id=j.intent_id;
  v_reason:=app.notification_ineligibility(i);
 else
  select * into c from app.notification_challenges where organization_id=j.organization_id and id=j.challenge_id;
  if c.expires_at<=now() or c.confirmed_at is not null then v_reason:='Confirmation expired or already used'; end if;
  if app.notification_suppressed(j.organization_id,c.email_address) then v_reason:='Communications has suppressed this recipient address'; end if;
 end if;
 if not app.email_identity_ready(j.organization_id,j.email_identity_id) then v_reason:='Email identity is not ready; configure Communications'; end if;
 if v_reason is not null then
  update app.notification_jobs set state=case when j.attempts>=5 or j.first_attempt_at<now()-interval '23 hours' or v_reason like 'Email identity%' then 'failed' else 'suppressed' end,reason=v_reason where organization_id=j.organization_id and id=j.id;
  update public.service_notification_intents set state=case when j.attempts>=5 or j.first_attempt_at<now()-interval '23 hours' or v_reason like 'Email identity%' then 'failed' else 'suppressed' end,reason=v_reason where organization_id=j.organization_id and id=j.intent_id;
  update public.messages set status='failed',failure_reason=v_reason where organization_id=j.organization_id and id=j.message_id and status in('queued','sending');
  return jsonb_build_object('held',true);
 end if;
 j.lease_id:=gen_random_uuid();
 update app.notification_jobs set state='sending',attempts=attempts+1,lease_id=j.lease_id,lease_until=now()+interval '5 minutes',first_attempt_at=coalesce(first_attempt_at,now()) where organization_id=j.organization_id and id=j.id;
 update public.messages set status='sending' where organization_id=j.organization_id and id=j.message_id and status in('queued','sending');
 if j.intent_id is not null then insert into public.service_notification_attempts(organization_id,id,intent_id,message_id) values(j.organization_id,j.lease_id,j.intent_id,j.message_id); end if;
 select * into details from public.email_message_details where organization_id=j.organization_id and message_id=j.message_id;
 select b.provider_key,b.provider_account_id into provider,account from public.email_identities e join public.organization_provider_resources r on r.organization_id=e.organization_id and r.id=e.sending_domain_resource_id join public.organization_provider_bindings b on b.organization_id=r.organization_id and b.id=r.binding_id where e.organization_id=j.organization_id and e.id=j.email_identity_id;
 return jsonb_build_object('job_id',j.id,'lease_id',j.lease_id,'organization_id',j.organization_id,'message_id',j.message_id,'provider_key',provider,'provider_account_id',account,'from_address',details.from_address,'from_name',details.from_name,'to',details.to_addresses,'subject',details.subject,'text',(select body from public.messages where organization_id=j.organization_id and id=j.message_id));
end $$;
create function public.finish_customer_notification(p_job_id uuid,p_lease_id uuid,p_outcome text,p_external_id text default null) returns boolean language plpgsql security definer set search_path='' as $$
declare j app.notification_jobs; v_detail text; result text;
begin
 if p_outcome is null or p_outcome not in('accepted','retry','rejected','failed') or (p_outcome='accepted' and nullif(p_external_id,'') is null) then raise exception 'Invalid notification outcome' using errcode='22023'; end if;
 select * into j from app.notification_jobs where id=p_job_id and lease_id=p_lease_id and state='sending' for update;
 if not found then return false; end if;
 result:=case when p_outcome='retry' and j.attempts>=5 then 'failed' else p_outcome end;
 v_detail:=case result when 'retry' then 'Email provider temporarily unavailable' when 'failed' then 'Email delivery failed; inspect delivery attempts' when 'rejected' then 'Email provider refused this message' end;
 perform public.record_email_send_result(j.organization_id,j.message_id,result,p_external_id,v_detail,null);
 update app.notification_jobs set state=case result when 'accepted' then 'accepted' when 'retry' then 'queued' else 'failed' end,reason=v_detail,lease_until=null,next_attempt_at=now()+make_interval(secs=>least(3600,60*(2^j.attempts)::integer)) where organization_id=j.organization_id and id=j.id;
 update public.service_notification_attempts set finished_at=now(),outcome=result,detail=v_detail where organization_id=j.organization_id and id=j.lease_id;
 if result in('failed','rejected') then update public.service_notification_intents set state='failed',reason=v_detail where organization_id=j.organization_id and id=j.intent_id; end if;
 return true;
end $$;

create function public.authorize_customer_notification_send(p_job_id uuid,p_lease_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare j app.notification_jobs; i public.service_notification_intents; v_reason text;
begin
 select * into j from app.notification_jobs where id=p_job_id and lease_id=p_lease_id and state='sending' and lease_until>now() for update;
 if not found then return false; end if;
 if j.intent_id is not null then
  select * into i from public.service_notification_intents where organization_id=j.organization_id and id=j.intent_id;
  v_reason:=app.notification_ineligibility(i);
 elsif not exists(select 1 from app.notification_challenges where organization_id=j.organization_id and id=j.challenge_id and expires_at>now() and confirmed_at is null and not app.notification_suppressed(j.organization_id,email_address)) then v_reason:='Confirmation expired or recipient suppressed'; end if;
 if not app.email_identity_ready(j.organization_id,j.email_identity_id) then v_reason:='Email identity is not ready'; end if;
 if v_reason is null then return true; end if;
 update app.notification_jobs set state=case when v_reason like 'Email identity%' then 'failed' else 'suppressed' end,reason=v_reason,lease_until=null where organization_id=j.organization_id and id=j.id;
 update public.service_notification_intents set state=case when v_reason like 'Email identity%' then 'failed' else 'suppressed' end,reason=v_reason where organization_id=j.organization_id and id=j.intent_id;
 update public.messages set status='rejected',failure_reason=v_reason where organization_id=j.organization_id and id=j.message_id and status='sending';
 update public.service_notification_attempts set finished_at=now(),outcome='suppressed',detail=v_reason where organization_id=j.organization_id and id=j.lease_id;
 return false;
end $$;

-- The ordinary Inbox send endpoint must not circumvent notification eligibility or leases.
alter function public.claim_email_for_send(uuid,uuid) rename to claim_operator_email_for_send;
revoke all on function public.claim_operator_email_for_send(uuid,uuid) from provider_operator;
create function public.claim_email_for_send(p_organization_id uuid,p_message_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from app.notification_jobs where organization_id=p_organization_id and message_id=p_message_id) then return false; end if;
 return public.claim_operator_email_for_send(p_organization_id,p_message_id);
end $$;
revoke all on function public.claim_email_for_send(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_email_for_send(uuid,uuid) to provider_operator;

create function public.retry_service_notification(p_organization_id uuid,p_intent_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare i public.service_notification_intents; j app.notification_jobs;
begin
 if auth.uid() is null or not app.has_capability(p_organization_id,'customer.update') or not app.has_capability(p_organization_id,'message.send') then raise exception 'Customer management and email sending permission required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_intent_id::text,0));
 select * into i from public.service_notification_intents where organization_id=p_organization_id and id=p_intent_id;
 if not found or not app.notification_retry_eligible(i) then raise exception 'This notification cannot be retried safely; check consent, sender readiness and current review/publication' using errcode='PT409'; end if;
 select * into j from app.notification_jobs where organization_id=p_organization_id and intent_id=i.id for update;
 if j.id is null then
  select email_identity_id into i.email_identity_id from public.customer_notification_settings where organization_id=p_organization_id and customer_id=i.customer_id;
  update public.service_notification_intents set email_identity_id=i.email_identity_id where organization_id=p_organization_id and id=i.id;
  perform app.enqueue_service_notification(i);
 else
  update app.notification_jobs set state='queued',next_attempt_at=now(),reason=null where organization_id=p_organization_id and id=j.id;
  update public.messages set status='queued',failure_reason=null where organization_id=p_organization_id and id=j.message_id;
 end if;
 update public.service_notification_intents set state='queued',reason=null where organization_id=p_organization_id and id=i.id;
end $$;

create function public.service_notification_history(p_organization_id uuid,p_customer_id uuid,p_engagement_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not app.has_capability(p_organization_id,'customer.update') then raise exception 'Customer management permission required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(row order by created_at desc),'[]'::jsonb) into result from (
  select i.created_at,jsonb_build_object('id',i.id,'reviewId',i.review_id,'purpose',i.purpose,'recipient',i.email_address,'sender',d.from_address,'messageId',j.message_id,'reason',coalesce(j.reason,i.reason),
   'state',case when i.state in('not_requested','suppressed') then i.state when m.status in('bounced','rejected','failed','delivered') then m.status when i.state='failed' then 'failed' when exists(select 1 from public.message_events where organization_id=i.organization_id and message_id=j.message_id and event_type in('sent','delayed')) then (select event_type from public.message_events where organization_id=i.organization_id and message_id=j.message_id and event_type in('sent','delayed') order by coalesce(provider_event_at,occurred_at) desc,occurred_at desc limit 1) when j.state='accepted' then 'accepted' else 'queued' end,
   'createdAt',i.created_at,'mayRetry',app.notification_retry_eligible(i) and app.has_capability(p_organization_id,'message.send'),
   'attempts',coalesce((select jsonb_agg(jsonb_build_object('at',started_at,'finishedAt',finished_at,'outcome',outcome,'detail',detail) order by started_at) from public.service_notification_attempts where organization_id=i.organization_id and intent_id=i.id),'[]'::jsonb),
   'events',coalesce((select jsonb_agg(jsonb_build_object('type',event_type,'at',coalesce(provider_event_at,occurred_at),'ingestedAt',occurred_at) order by occurred_at) from public.message_events where organization_id=i.organization_id and message_id=j.message_id),'[]'::jsonb)) row
  from public.service_notification_intents i left join app.notification_jobs j on j.organization_id=i.organization_id and j.intent_id=i.id left join public.messages m on m.organization_id=j.organization_id and m.id=j.message_id left join public.email_message_details d on d.organization_id=j.organization_id and d.message_id=j.message_id
  where i.organization_id=p_organization_id and i.customer_id=p_customer_id and i.engagement_id=p_engagement_id order by i.created_at desc limit 50
 ) records;
 return result;
end $$;
create function app.notification_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare i public.service_notification_intents;
begin
 if new.event_type not in('accepted','delivered','bounced','failed','rejected') then return new; end if;
 select n.* into i from public.service_notification_intents n join app.notification_jobs j on j.organization_id=n.organization_id and j.intent_id=n.id where j.organization_id=new.organization_id and j.message_id=new.message_id;
 if found then
  insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload) values(i.organization_id,'00000000-0000-4000-8000-0000000000b1','customer',i.customer_id,'notification.'||new.event_type,jsonb_build_object('intentId',i.id,'messageId',new.message_id,'messageEventId',new.id));
 end if;
 return new;
end $$;
revoke all on function app.notification_activity() from public,anon,authenticated;
create trigger notification_delivery_activity after insert on public.message_events for each row execute function app.notification_activity();

revoke all on function public.set_customer_notification_sender(uuid,uuid,uuid),public.propose_notification_recipient(text,text[]),public.confirm_notification_recipient(uuid,text),public.withdraw_notification_consent(),public.portal_notification_preferences(),public.release_service_review_notification(uuid,uuid,uuid,uuid,uuid,boolean),public.publish_service_disclosure_notification(uuid,uuid,uuid,integer,boolean),public.retry_service_notification(uuid,uuid),public.service_notification_history(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.set_customer_notification_sender(uuid,uuid,uuid),public.propose_notification_recipient(text,text[]),public.confirm_notification_recipient(uuid,text),public.withdraw_notification_consent(),public.portal_notification_preferences(),public.release_service_review_notification(uuid,uuid,uuid,uuid,uuid,boolean),public.publish_service_disclosure_notification(uuid,uuid,uuid,integer,boolean),public.retry_service_notification(uuid,uuid),public.service_notification_history(uuid,uuid,uuid) to authenticated;
revoke all on function public.claim_customer_notification(uuid),public.finish_customer_notification(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_customer_notification(uuid),public.finish_customer_notification(uuid,uuid,text,text) to customer_notification_worker;
revoke all on function public.authorize_customer_notification_send(uuid,uuid) from public,anon,authenticated;
grant execute on function public.authorize_customer_notification_send(uuid,uuid) to customer_notification_worker;
