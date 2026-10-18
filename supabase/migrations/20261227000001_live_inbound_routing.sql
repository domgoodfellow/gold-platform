alter table public.communication_routes add column fallback_message text check (length(fallback_message) <= 2000);

create table public.voice_inbound_contexts (
  call_id uuid primary key references public.calls(id) on delete cascade,
  external_id text not null unique,
  account_sid text not null,
  context jsonb not null
);
alter table public.voice_inbound_contexts enable row level security;
alter table public.voice_inbound_contexts force row level security;
revoke all on public.voice_inbound_contexts from public, anon, authenticated;

create table public.voice_inbound_cursors (
  call_id uuid references public.voice_inbound_contexts(call_id) on delete cascade,
  route_id uuid references public.communication_routes(id) on delete cascade,
  cursor_value integer not null,
  primary key(call_id, route_id)
);
alter table public.voice_inbound_cursors enable row level security;
alter table public.voice_inbound_cursors force row level security;
revoke all on public.voice_inbound_cursors from public, anon, authenticated;

create function public.begin_inbound_routing(p_external_id text, p_to_number text, p_from_number text, p_account_sid text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_number uuid; v_call uuid; v_from text; v_context jsonb; v_account text;
begin
  if nullif(btrim(p_external_id),'') is null or nullif(btrim(p_account_sid),'') is null then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_external_id, 2701));
  select context, account_sid into v_context, v_account from public.voice_inbound_contexts where external_id=p_external_id;
  if found then
    if v_account <> p_account_sid or v_context->>'to_number' <> p_to_number then return null; end if;
    return v_context;
  end if;
  select organization_id, phone_number_id into v_org,v_number from app.voice_number_owner(p_to_number);
  if v_org is null then return null; end if;
  if exists(select 1 from public.organization_provider_bindings b where b.organization_id=v_org and b.provider_key='twilio'
    and (b.status <> 'active' or b.external_account_id is distinct from p_account_sid)) then return null; end if;
  if exists(select 1 from public.call_participants where external_id=p_external_id) then return null; end if;
  v_from := case when p_from_number ~ '^\+[1-9][0-9]{7,14}$' then p_from_number end;
  insert into public.calls(organization_id,direction,status,from_number,to_number,phone_number_id,created_by)
    values(v_org,'inbound','ringing',v_from,p_to_number,v_number,'00000000-0000-4000-8000-0000000000a2') returning id into v_call;
  insert into public.call_participants(organization_id,call_id,party,external_id,status)
    values(v_org,v_call,'customer',p_external_id,'ringing');
  v_context := jsonb_build_object('call_id',v_call,'organization_id',v_org,'number_id',v_number,'to_number',p_to_number,
    'open_now',public.organization_open_now(v_org,now()),
    'communication_routes',coalesce((select jsonb_agg(to_jsonb(r)) from public.communication_routes r where r.organization_id=v_org),'[]'::jsonb),
    'communication_route_targets',coalesce((select jsonb_agg(to_jsonb(t) order by t.position) from public.communication_route_targets t where t.organization_id=v_org),'[]'::jsonb),
    'memberships',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'organization_id',m.organization_id,'role',jsonb_build_object('capabilities',r.capabilities))) from public.memberships m join public.roles r on r.id=m.role_id and r.organization_id=m.organization_id where m.organization_id=v_org),'[]'::jsonb),
    'calls',coalesce((select jsonb_agg(to_jsonb(c)) from (select created_by,to_number,direction,organization_id from public.calls where organization_id=v_org and direction='outbound' and to_number=v_from order by started_at desc limit 1)c),'[]'::jsonb));
  insert into public.voice_inbound_contexts values(v_call,p_external_id,p_account_sid,v_context);
  return v_context;
end $$;
revoke all on function public.begin_inbound_routing(text,text,text,text) from public,anon,authenticated;
grant execute on function public.begin_inbound_routing(text,text,text,text) to voice_webhook;

create function public.claim_inbound_route_cursor(p_call_id uuid,p_route_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_cursor integer; v_org uuid;
begin
  perform 1 from public.voice_inbound_contexts where call_id=p_call_id for update;
  if not found then raise exception 'unknown inbound call' using errcode='42501'; end if;
  select cursor_value into v_cursor from public.voice_inbound_cursors where call_id=p_call_id and route_id=p_route_id;
  if found then return v_cursor; end if;
  select organization_id into v_org from public.calls where id=p_call_id;
  update public.communication_routes set round_robin_cursor=round_robin_cursor+1
    where id=p_route_id and organization_id=v_org returning round_robin_cursor-1 into v_cursor;
  if not found then raise exception 'foreign route' using errcode='42501'; end if;
  insert into public.voice_inbound_cursors values(p_call_id,p_route_id,v_cursor);
  return v_cursor;
end $$;
revoke all on function public.claim_inbound_route_cursor(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_inbound_route_cursor(uuid,uuid) to voice_webhook;
