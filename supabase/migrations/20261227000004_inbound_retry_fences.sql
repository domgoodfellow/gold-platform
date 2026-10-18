-- Retries retain their route/cursor snapshot but re-check live human authority and call state.
create function public.refresh_inbound_routing(p_external_id text,p_to_number text,p_from_number text,p_account_sid text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_context jsonb;v_call public.calls;v_members jsonb;
begin
 v_context:=public.begin_inbound_routing(p_external_id,p_to_number,p_from_number,p_account_sid);
 if v_context is null then return null;end if;
 select * into strict v_call from public.calls where id=(v_context->>'call_id')::uuid;
 if v_call.status not in('ringing','in_progress') or v_call.from_number is distinct from (case when p_from_number ~ '^\+[1-9][0-9]{7,14}$' then p_from_number end) then return null;end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'organization_id',m.organization_id,'role',jsonb_build_object('capabilities',r.capabilities))),'[]'::jsonb) into v_members from public.memberships m join public.roles r on r.id=m.role_id and r.organization_id=m.organization_id where m.organization_id=v_call.organization_id;
 return jsonb_set(v_context,'{memberships}',v_members);
end $$;
revoke all on function public.refresh_inbound_routing(text,text,text,text) from public,anon,authenticated;
grant execute on function public.refresh_inbound_routing(text,text,text,text) to voice_webhook;

create function public.inbound_voice_agent_state(p_external_id text,p_account_sid text) returns text
language sql stable security definer set search_path='' as $$
 select s.state from public.voice_agent_sessions s join public.voice_inbound_contexts c on c.call_id=s.call_id where c.external_id=p_external_id and c.account_sid=p_account_sid;
$$;
revoke all on function public.inbound_voice_agent_state(text,text) from public,anon,authenticated;
grant execute on function public.inbound_voice_agent_state(text,text) to voice_webhook;

create or replace function public.record_voice_agent_event(p_session_id uuid,p_event_id text,p_external_id text,p_type text,p_seconds integer,p_input_tokens bigint default null,p_output_tokens bigint default null)
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
 update public.voice_agent_sessions set external_session_id=coalesce(external_session_id,p_external_id),reported_seconds=coalesce(reported_seconds,p_seconds),state=case when p_type='ended' then 'ended' when p_type='failed' then 'failed' when p_type='transfer_requested' and state not in('ended','failed','uncertain') then 'transfer_requested' when p_type='connected' and state='preparing' then 'active' else state end where id=p_session_id;
 if p_seconds>0 and v_session.reported_seconds is null then perform app.record_usage(v_session.organization_id,'ai_voice_seconds',p_seconds,'voice_agent',now(),null,null,null,'voice-session:'||p_session_id::text,'voice_receptionist','platform_account');end if;
 if p_input_tokens is not null then perform public.record_ai_usage(v_session.organization_id,'voice_receptionist','voice_agent',p_input_tokens,p_output_tokens,'voice-session:'||p_session_id::text);end if;
 return to_jsonb(v_session);
end $$;

CREATE OR REPLACE FUNCTION public.record_ai_runtime_assignment(p_capability text, p_provider_service_id uuid, p_provider_account_id uuid, p_model text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff        text := app.require_platform_capability('platform.providers');
  v_service_key  text;
  v_service_provider  text;
  v_implemented  text;
  v_account_provider  text;
  v_account_status    text;
  v_account_secret    uuid;
begin
  if not (p_capability = any (app.ai_capabilities())) then
    raise exception 'unknown AI capability: %', p_capability using errcode = '22023';
  end if;

  if btrim(coalesce(p_model, '')) = '' or length(p_model) > 200 then
    raise exception 'a model is required' using errcode = '22023';
  end if;

  select key, provider_key, implementation_state
    into v_service_key, v_service_provider, v_implemented
    from public.platform_provider_services
   where id = p_provider_service_id;

  if v_service_key is null then
    raise exception 'no such provider service' using errcode = '22023';
  end if;
  if v_implemented <> 'available' then
    raise exception 'that provider service has no runtime implementation yet' using errcode = '22023';
  end if;

  if (p_capability='voice_receptionist') is distinct from (v_service_provider='voice_agent' and v_service_key='voice_session') then
    raise exception 'Service does not implement this capability' using errcode='22023';
  end if;

  select provider_key, status, secret_id
    into v_account_provider, v_account_status, v_account_secret
    from public.platform_provider_accounts
   where id = p_provider_account_id;

  if v_account_provider is null then
    raise exception 'no such provider account' using errcode = '22023';
  end if;
  if v_account_provider <> v_service_provider then
    raise exception 'that provider account belongs to a different provider than the service' using errcode = '22023';
  end if;
  if v_account_status <> 'active' then
    raise exception 'that provider account is not active' using errcode = '22023';
  end if;
  if v_account_secret is null then
    raise exception 'that provider account has no credential stored' using errcode = '22023';
  end if;

  insert into public.platform_ai_runtime_assignments
    (capability, provider_service_id, provider_account_id, model, updated_at, updated_by)
  values
    (p_capability, p_provider_service_id, p_provider_account_id, btrim(p_model), now(), auth.uid())
  on conflict (capability) do update
    set provider_service_id = excluded.provider_service_id,
        provider_account_id = excluded.provider_account_id,
        model                = excluded.model,
        updated_at           = now(),
        updated_by           = auth.uid();
end;
$function$;
