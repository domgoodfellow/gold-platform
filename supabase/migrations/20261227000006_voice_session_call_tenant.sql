-- A call already belongs to exactly one organization. Pin that identity on its session too.
alter table public.voice_agent_sessions
  drop constraint voice_agent_sessions_call_id_key,
  add constraint voice_agent_sessions_organization_call_unique unique(organization_id,call_id),
  add constraint voice_agent_sessions_call_same_org foreign key(organization_id,call_id)
    references public.calls(organization_id,id) on delete cascade;
