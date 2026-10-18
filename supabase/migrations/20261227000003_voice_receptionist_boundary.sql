create or replace function app.ai_capabilities() returns text[] language sql immutable set search_path='' as $$
 select array['operator_assistant','public_assistant','configuration_drafting','voice_receptionist']::text[];
$$;
insert into public.platform_providers(key,label) values('voice_agent','External voice agent') on conflict do nothing;
insert into public.platform_provider_services(provider_key,key,label,family,kind,implementation_state,vendor_status,auth_mode)
 values('voice_agent','voice_session','Voice session adapter','Voice','runtime','available','restricted','api_key') on conflict do nothing;
insert into public.platform_meters(id,label,unit,description,writer) values('ai_voice_seconds','AI voice duration','seconds','Provider-reported AI voice session duration','public.record_voice_agent_event') on conflict do nothing;

alter table public.communication_routes drop constraint communication_routes_destination_type_check;
alter table public.communication_routes add constraint communication_routes_destination_type_check check(destination_type in ('members','external_number','route','ai_receptionist'));

create table public.voice_receptionist_configs (
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 revision integer not null default 1,
 deployment_ref text not null check(length(btrim(deployment_ref)) between 1 and 200),
 enabled boolean not null default false,
 max_session_seconds integer not null check(max_session_seconds between 30 and 3600),
 monthly_budget_seconds integer not null check(monthly_budget_seconds between 0 and 10000000)
);
alter table public.voice_receptionist_configs enable row level security;
alter table public.voice_receptionist_configs force row level security;
create policy voice_config_read on public.voice_receptionist_configs for select to authenticated using(organization_id in(select app.current_tenant_ids()));
revoke all on public.voice_receptionist_configs from public,anon,authenticated;
grant select on public.voice_receptionist_configs to authenticated;
create function public.configure_voice_receptionist(p_organization_id uuid,p_revision integer,p_deployment_ref text,p_enabled boolean,p_max_seconds integer,p_budget_seconds integer)
returns void language plpgsql security definer set search_path='' as $$
declare v_revision integer;
begin
 if not app.has_capability(p_organization_id,'organization.manage') then raise exception 'Organization management required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text,2703));
 select revision into v_revision from public.voice_receptionist_configs where organization_id=p_organization_id;
 if coalesce(v_revision,0)<>p_revision then raise exception 'Voice configuration changed; reload' using errcode='40001';end if;
 insert into public.voice_receptionist_configs values(p_organization_id,coalesce(v_revision,0)+1,p_deployment_ref,p_enabled,p_max_seconds,p_budget_seconds)
 on conflict(organization_id) do update set revision=excluded.revision,deployment_ref=excluded.deployment_ref,enabled=excluded.enabled,max_session_seconds=excluded.max_session_seconds,monthly_budget_seconds=excluded.monthly_budget_seconds;
end $$;
revoke all on function public.configure_voice_receptionist(uuid,integer,text,boolean,integer,integer) from public,anon,authenticated;
grant execute on function public.configure_voice_receptionist(uuid,integer,text,boolean,integer,integer) to authenticated;

create table public.voice_agent_sessions (
 id uuid primary key default gen_random_uuid(),call_id uuid not null unique references public.voice_inbound_contexts(call_id) on delete cascade,
 organization_id uuid not null references public.organizations(id) on delete cascade,route_id uuid not null,
 provider_account_id uuid not null references public.platform_provider_accounts(id),
 deployment_ref text not null,config_revision integer not null,max_seconds integer not null,model text not null,
 external_session_id text,connection_url text,state text not null default 'preparing' check(state in ('preparing','active','ended','failed','transfer_requested','uncertain')),
 reported_seconds integer check(reported_seconds>=0),created_at timestamptz not null default now(),
 foreign key(organization_id,route_id) references public.communication_routes(organization_id,id)
);
alter table public.voice_agent_sessions enable row level security;
alter table public.voice_agent_sessions force row level security;
revoke all on public.voice_agent_sessions from public,anon,authenticated;
create table public.voice_agent_events (
 session_id uuid not null references public.voice_agent_sessions(id) on delete cascade,event_id text not null,
 event_type text not null,received_at timestamptz not null default now(),primary key(session_id,event_id)
);
alter table public.voice_agent_events enable row level security;
alter table public.voice_agent_events force row level security;
revoke all on public.voice_agent_events from public,anon,authenticated;

create function public.admit_voice_agent_session(p_call_id uuid,p_route_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_call public.calls;v_config public.voice_receptionist_configs;v_assignment public.platform_ai_runtime_assignments;v_session public.voice_agent_sessions;v_reserved bigint;
begin
 select * into v_call from public.calls where id=p_call_id and direction='inbound' and status in('ringing','in_progress');
 if not found or not exists(select 1 from public.voice_inbound_contexts where call_id=p_call_id) then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(v_call.organization_id::text,2703));
 select * into v_session from public.voice_agent_sessions where call_id=p_call_id;
 if found then return to_jsonb(v_session);end if;
 select * into v_config from public.voice_receptionist_configs where organization_id=v_call.organization_id and enabled;
 if not found or not app.module_entitled(v_call.organization_id,'assistant') or not app.module_entitled(v_call.organization_id,'reception') then return null;end if;
 if not exists(select 1 from public.communication_routes where id=p_route_id and organization_id=v_call.organization_id and enabled and destination_type='ai_receptionist') then return null;end if;
 select a.* into v_assignment from public.platform_ai_runtime_assignments a join public.platform_provider_accounts p on p.id=a.provider_account_id join public.platform_provider_services s on s.id=a.provider_service_id
 where a.capability='voice_receptionist' and p.status='active' and p.secret_id is not null and s.provider_key='voice_agent' and s.key='voice_session';
 if not found then return null;end if;
 select coalesce(sum(coalesce(reported_seconds,max_seconds)),0) into v_reserved from public.voice_agent_sessions where organization_id=v_call.organization_id and created_at>=date_trunc('month',now());
 if v_reserved+v_config.max_session_seconds>v_config.monthly_budget_seconds then return null;end if;
 insert into public.voice_agent_sessions(call_id,organization_id,route_id,provider_account_id,deployment_ref,config_revision,max_seconds,model)
 values(p_call_id,v_call.organization_id,p_route_id,v_assignment.provider_account_id,v_config.deployment_ref,v_config.revision,v_config.max_session_seconds,v_assignment.model) returning * into v_session;
 return to_jsonb(v_session);
end $$;
revoke all on function public.admit_voice_agent_session(uuid,uuid) from public,anon,authenticated;
grant execute on function public.admit_voice_agent_session(uuid,uuid) to provider_operator;

create function public.voice_agent_session_context(p_session_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(s) from public.voice_agent_sessions s where id=p_session_id;
$$;
revoke all on function public.voice_agent_session_context(uuid) from public,anon,authenticated;
grant execute on function public.voice_agent_session_context(uuid) to provider_operator;

create function public.bind_voice_agent_session(p_session_id uuid,p_external_id text,p_connection_url text)
returns void language plpgsql security definer set search_path='' as $$
declare v_session public.voice_agent_sessions;
begin
 select * into strict v_session from public.voice_agent_sessions where id=p_session_id for update;
 if v_session.external_session_id is not null and v_session.external_session_id<>p_external_id then raise exception 'Session binding conflict' using errcode='23505';end if;
 if p_external_id is null or p_connection_url is null or length(p_external_id) not between 1 and 200 or p_connection_url!~'^wss://' or length(p_connection_url)>2000 then raise exception 'Invalid voice connection' using errcode='22023';end if;
 update public.voice_agent_sessions set external_session_id=p_external_id,connection_url=p_connection_url,state=case when state='preparing' then 'active' else state end where id=p_session_id;
end $$;
revoke all on function public.bind_voice_agent_session(uuid,text,text) from public,anon,authenticated;
grant execute on function public.bind_voice_agent_session(uuid,text,text) to provider_operator;

create function public.record_voice_agent_event(p_session_id uuid,p_event_id text,p_external_id text,p_type text,p_seconds integer,p_input_tokens bigint default null,p_output_tokens bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session public.voice_agent_sessions;v_inserted integer;
begin
 select * into strict v_session from public.voice_agent_sessions where id=p_session_id for update;
 if p_event_id is null or p_external_id is null or length(p_external_id) not between 1 and 200 or p_type is null or length(p_event_id) not between 1 and 200 or p_type<>all(array['connected','ended','failed','usage','transfer_requested']) or (p_seconds is not null and (p_seconds<0 or p_seconds>604800)) then raise exception 'Invalid voice event' using errcode='22023';end if;
 if v_session.external_session_id is not null and v_session.external_session_id<>p_external_id then raise exception 'Foreign session' using errcode='42501';end if;
 if v_session.reported_seconds is not null and p_seconds is not null and v_session.reported_seconds<>p_seconds then raise exception 'Usage conflict' using errcode='23505';end if;
 if (p_input_tokens is null)<>(p_output_tokens is null) or p_input_tokens<0 or p_output_tokens<0 then raise exception 'Invalid token usage' using errcode='22023';end if;
 insert into public.voice_agent_events values(p_session_id,p_event_id,p_type,now()) on conflict do nothing;
 get diagnostics v_inserted=row_count;
 if v_inserted=0 then return null;end if;
 update public.voice_agent_sessions set external_session_id=coalesce(external_session_id,p_external_id),reported_seconds=coalesce(reported_seconds,p_seconds),state=case when p_type='ended' then 'ended' when p_type='failed' then 'failed' when p_type='transfer_requested' and state not in('ended','failed') then 'transfer_requested' when p_type='connected' and state='preparing' then 'active' else state end where id=p_session_id;
 if p_seconds>0 and v_session.reported_seconds is null then perform app.record_usage(v_session.organization_id,'ai_voice_seconds',p_seconds,'voice_agent',now(),null,null,null,'voice-session:'||p_session_id::text,'voice_receptionist','platform_account');end if;
 if p_input_tokens is not null then perform public.record_ai_usage(v_session.organization_id,'voice_receptionist','voice_agent',p_input_tokens,p_output_tokens,'voice-session:'||p_session_id::text);end if;
 return to_jsonb(v_session);
end $$;
revoke all on function public.record_voice_agent_event(uuid,text,text,text,integer,bigint,bigint) from public,anon,authenticated;
grant execute on function public.record_voice_agent_event(uuid,text,text,text,integer,bigint,bigint) to provider_operator;

-- A signed provider event can request only a route's configured human fallback.
create function public.claim_voice_agent_transfer(p_session_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_session public.voice_agent_sessions;v_context public.voice_inbound_contexts;v_members jsonb;
begin
 select * into strict v_session from public.voice_agent_sessions where id=p_session_id for update;
 if v_session.state<>'transfer_requested' then return null;end if;
 select * into strict v_context from public.voice_inbound_contexts where call_id=v_session.call_id;
 select jsonb_agg(t.member_id order by t.position) into v_members
 from public.communication_route_targets t join public.memberships m on m.id=t.member_id and m.organization_id=t.organization_id
 join public.roles r on r.id=m.role_id and r.organization_id=m.organization_id
 join public.communication_routes cr on cr.id=t.route_id and cr.organization_id=t.organization_id
 where t.organization_id=v_session.organization_id and t.route_id=v_session.route_id and t.slot='fallback' and cr.enabled and cr.fallback_type='members' and 'call.place'=any(r.capabilities);
 if v_members is null then return null;end if;
 -- Reserve the external effect once. A timeout stays uncertain until carrier evidence arrives.
 update public.voice_agent_sessions set state='uncertain' where id=p_session_id;
 return jsonb_build_object('external_id',v_context.external_id,'account_sid',v_context.account_sid,'member_ids',v_members);
end $$;
revoke all on function public.claim_voice_agent_transfer(uuid) from public,anon,authenticated;
grant execute on function public.claim_voice_agent_transfer(uuid) to provider_operator;
