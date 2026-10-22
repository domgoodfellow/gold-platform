create function public.mark_voice_agent_uncertain(p_call_id uuid) returns void
language sql security definer set search_path='' as $$
 update public.voice_agent_sessions set state='uncertain' where call_id=p_call_id and state='preparing';
$$;
revoke all on function public.mark_voice_agent_uncertain(uuid) from public,anon,authenticated;
grant execute on function public.mark_voice_agent_uncertain(uuid) to provider_operator;

-- Operational metadata only. Credentials, stream URLs and external callback bodies stay private.
create function public.voice_agent_session_overview() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform app.require_platform_capability('platform.providers');
 return coalesce((select jsonb_agg(to_jsonb(recent)) from (
   select s.id,s.organization_id,s.call_id,s.state,s.reported_seconds,s.max_seconds,s.created_at,
     p.label as provider_account_label
   from public.voice_agent_sessions s join public.platform_provider_accounts p on p.id=s.provider_account_id
   order by s.created_at desc limit 25
 ) recent),'[]'::jsonb);
end $$;
revoke all on function public.voice_agent_session_overview() from public,anon,authenticated;
grant execute on function public.voice_agent_session_overview() to authenticated;
