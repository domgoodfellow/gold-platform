-- Phase F: a call is one business fact, and a leg is the carrier's.
--
-- Reception shipped from the carrier inwards and treated the carrier's `CallSid` as the call. A
-- conference has as many of those as it has people in it, so the first leg to report an ending ended
-- the whole business call and charged for it: the agent leaving a cold transfer was "the call
-- completed", and a transfer target who never answered was "the call was not answered". This migration
-- moves the lifecycle where D38 always said it lived: the Call is derived from its participants, and
-- only a participant has a provider identifier.
--
-- Eight things arrive together because each is the other's precondition.
--   1. A call may be from somebody this business has not recorded (the customer is nullable), and may
--      be from nobody it can see (a withheld caller id).
--   2. A call names the number it was on, and when it was answered.
--   3. A leg belongs to a membership, not to a global user, and remembers how long it was connected.
--   4. The call's status is derived from its legs, only ever moves forward, and is billed once, when
--      it ends.
--   5. An inbound call is recorded by the carrier's own callback, with the business derived from the
--      number that was rung.
--   6. A number says what it can do for voice and for text separately, and whether it is ready is
--      read from the provider's state rather than stored.
--   7. The outbound number is chosen by one function.
--   8. What a tenant could write onto a call (its status, its ending, its duration, its provider
--      identifiers) is now written only by the carrier's callbacks and the narrow doors below.

-- ---------------------------------------------------------------------------
-- 1. A call may be from somebody unrecorded
-- ---------------------------------------------------------------------------

alter table public.calls alter column customer_id drop not null;

-- A withheld caller id is a real caller. A call this business received from nobody it can name has a
-- direction and a destination and no origin; an outbound call always has both.
alter table public.calls alter column from_number drop not null;
alter table public.calls
  add constraint calls_only_an_inbound_call_may_withhold_its_origin
    check (from_number is not null or direction = 'inbound');

-- ---------------------------------------------------------------------------
-- 1b. A number says what it can do, separately for calls and for texts
-- ---------------------------------------------------------------------------

-- `inbound_enabled` and `outbound_enabled` were one flag for two channels: a business that wanted
-- its number to take calls but not texts could not say so.
alter table public.phone_numbers rename column inbound_enabled to voice_inbound_enabled;
alter table public.phone_numbers rename column outbound_enabled to voice_outbound_enabled;
alter table public.phone_numbers add column sms_inbound_enabled boolean;
alter table public.phone_numbers add column sms_outbound_enabled boolean;
update public.phone_numbers set sms_inbound_enabled = voice_inbound_enabled, sms_outbound_enabled = voice_outbound_enabled;
alter table public.phone_numbers alter column sms_inbound_enabled set not null, alter column sms_inbound_enabled set default true;
alter table public.phone_numbers alter column sms_outbound_enabled set not null, alter column sms_outbound_enabled set default true;

-- GildOps controls inbound routing only on a number it holds. An external number is a caller id and
-- a browser identity has no number at all, so neither can be said to take a call or a text.
update public.phone_numbers set voice_inbound_enabled = false, sms_inbound_enabled = false where origin <> 'provisioned';
alter table public.phone_numbers
  add constraint phone_numbers_inbound_needs_a_number_we_hold
    check (origin = 'provisioned' or (not voice_inbound_enabled and not sms_inbound_enabled));

-- Business roles, not a catalogue: the label is the business's own word, and the purpose says which
-- of the few things a platform has to know a number is for.
alter table public.phone_numbers drop constraint phone_numbers_purpose_check;
alter table public.phone_numbers
  add constraint phone_numbers_purpose_check
    check (purpose in ('general', 'main', 'reception', 'sales', 'support'));

-- A stored `health` that nothing ever wrote was a second readiness truth waiting to disagree with the
-- provider's. Readiness is read, below, from the state of the resource and the binding behind it.
alter table public.phone_numbers drop column health;
alter table public.phone_numbers drop column health_checked_at;

-- ---------------------------------------------------------------------------
-- 2. The number a call was on, and when somebody answered
-- ---------------------------------------------------------------------------

alter table public.calls add column phone_number_id uuid;
alter table public.calls add column answered_at timestamptz;
alter table public.calls add column recording_available_at timestamptz;

alter table public.calls
  add constraint calls_phone_number_same_org
    foreign key (organization_id, phone_number_id)
    references public.phone_numbers (organization_id, id);

alter table public.calls
  add constraint calls_answered_between_start_and_end
    check (answered_at is null or (answered_at >= started_at and (ended_at is null or answered_at <= ended_at)));

update public.calls c
   set phone_number_id = n.id
  from public.phone_numbers n
 where n.organization_id = c.organization_id
   and n.e164 = case c.direction when 'outbound' then c.from_number else c.to_number end;

update public.calls
   set recording_available_at = coalesce(ended_at, started_at)
 where recording_url is not null;

create index calls_org_number_started_idx
  on public.calls (organization_id, phone_number_id, started_at desc);

-- A call has no provider identifier of its own. A conference has as many as it has people, so the
-- identifier belongs to the participant, and a column here would invite the next reader to treat one
-- leg as the call.
drop index public.calls_org_external_id_unique;
alter table public.calls drop column external_id;

-- A call whose customer is unknown is associated with one only when the number names exactly one,
-- by the rule a conversation already uses. Nothing is ever created here.
create function app.resolve_new_call_customer() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.customer_id is null then
    new.customer_id := app.resolve_customer(
      new.organization_id, 'phone',
      case new.direction when 'inbound' then new.from_number else new.to_number end);
  end if;
  return new;
end $$;
revoke all on function app.resolve_new_call_customer() from public;

create trigger calls_resolve_customer
  before insert on public.calls
  for each row execute function app.resolve_new_call_customer();

-- ---------------------------------------------------------------------------
-- 3. A leg belongs to a membership
-- ---------------------------------------------------------------------------

alter table public.call_participants add column membership_id uuid;
alter table public.call_participants add column duration_seconds integer
  check (duration_seconds is null or duration_seconds >= 0);

update public.call_participants p
   set membership_id = m.id
  from public.memberships m
 where p.member_id is not null
   and m.organization_id = p.organization_id
   and m.user_id = p.member_id;

alter table public.call_participants
  add constraint call_participants_membership_same_org
    foreign key (organization_id, membership_id)
    references public.memberships (organization_id, id);

alter table public.call_participants drop column member_id;

create or replace function app.open_call_legs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.call_participants (organization_id, call_id, party, membership_id)
  values (new.organization_id, new.id, 'agent',
          (select m.id from public.memberships m
            where m.organization_id = new.organization_id and m.user_id = new.created_by)),
         (new.organization_id, new.id, 'customer', null);
  return new;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Status only moves forward, for a call and for a leg
-- ---------------------------------------------------------------------------

create function app.call_status_rank(p_status text) returns integer
language sql immutable set search_path = '' as $$
  select case p_status
           when 'ringing' then 0
           when 'in_progress' then 1
           else 2
         end
$$;

create function app.check_status_forward() returns trigger
language plpgsql set search_path = '' as $$
begin
  if app.call_status_rank(new.status) <= app.call_status_rank(old.status) then
    raise exception 'a call status only moves forward: % cannot become %', old.status, new.status
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger calls_status_only_moves_forward
  before update of status on public.calls
  for each row when (old.status is distinct from new.status)
  execute function app.check_status_forward();

create trigger call_participants_status_only_moves_forward
  before update of status on public.call_participants
  for each row when (old.status is distinct from new.status)
  execute function app.check_status_forward();

-- ---------------------------------------------------------------------------
-- 5. A call ends when its last leg leaves, and is billed once
-- ---------------------------------------------------------------------------

-- Settles a call from what its legs say. Called by every writer of a leg's state, after the leg is
-- written, and holding the call's row so two callbacks for two legs cannot both decide it ended.
--
--   answered   two legs connected at once. One person on a line is not a conversation, and the
--              first leg in is always alone.
--   ended      no leg is left in the room (a ringing leg is still a leg).
--   status     `completed` if it was answered; otherwise the carrier's own word for why the other
--              party never came (busy, no answer, failed), and `no_answer` when nobody said.
--   duration   the longest any one leg was connected, from the carrier; the time since it was
--              answered only when the carrier said nothing.
create function app.settle_call(p_organization_id uuid, p_call_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor    constant uuid := '00000000-0000-4000-8000-0000000000a2';
  v_call     public.calls;
  v_present  integer;
  v_connected integer;
  v_legs     integer;
  v_status   text;
  v_duration integer;
begin
  select * into v_call from public.calls
   where organization_id = p_organization_id and id = p_call_id
   for update;
  if not found or app.call_status_rank(v_call.status) = 2 then
    return;
  end if;

  select count(*) filter (where left_at is null),
         count(*) filter (where left_at is null and status = 'in_progress'),
         count(*)
    into v_present, v_connected, v_legs
    from public.call_participants
   where organization_id = p_organization_id and call_id = p_call_id;

  if v_legs = 0 then
    return;
  end if;

  if v_connected >= 2 and v_call.answered_at is null then
    update public.calls
       set status = 'in_progress', answered_at = now()
     where organization_id = p_organization_id and id = p_call_id;
    return;
  end if;

  if v_present > 0 then
    return;
  end if;

  if v_call.answered_at is not null then
    v_status := 'completed';
  else
    select p.status into v_status
      from public.call_participants p
     where p.organization_id = p_organization_id and p.call_id = p_call_id
       and p.party = 'customer' and p.status in ('busy', 'no_answer', 'failed')
     order by p.created_at
     limit 1;
    v_status := coalesce(v_status, 'no_answer');
  end if;

  if v_status = 'completed' then
    select max(duration_seconds) into v_duration
      from public.call_participants
     where organization_id = p_organization_id and call_id = p_call_id;
    v_duration := coalesce(v_duration, greatest(ceil(extract(epoch from (now() - v_call.answered_at)))::integer, 0));
  end if;

  update public.calls
     set status = v_status,
         ended_at = greatest(now(), started_at),
         duration_seconds = v_duration
   where organization_id = p_organization_id and id = p_call_id;

  -- Once, and here: the transition into an ending happens exactly once, whichever callback caused it.
  if v_status = 'completed' then
    perform app.charge_for_call(p_call_id, v_duration);
  end if;

  if v_call.customer_id is not null then
    insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
    values (p_organization_id, v_actor, 'customer', v_call.customer_id, 'call.ended',
            jsonb_build_object('call_id', p_call_id, 'status', v_status, 'duration', v_duration));
  end if;
end;
$fn$;
revoke all on function app.settle_call(uuid, uuid) from public;

-- The carrier's callback. **One leg's word about itself** and nothing about the call: the call is
-- settled from all of its legs. The caller names no organization and no call; both come from the leg
-- the carrier's identifier already belongs to.
drop function public.record_call_event(text, text, text, text, integer, text, jsonb, text);

create function public.record_call_event(
  p_external_id   text,
  p_source        text,
  p_raw_status    text,
  p_status        text,
  p_duration      integer,
  p_recording_url text,
  p_payload       jsonb,
  p_payload_hash  text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_leg     public.call_participants;
  v_matches integer;
  v_id      uuid;
begin
  -- Exactly one leg. An identifier that names none, or (impossibly, for a carrier) two, is not
  -- evidence about any business's call and is dropped rather than guessed at.
  select count(*) into v_matches from public.call_participants where external_id = p_external_id;
  if v_matches <> 1 then
    return null;
  end if;
  select * into v_leg from public.call_participants where external_id = p_external_id;

  insert into public.call_events
    (organization_id, call_id, source, raw_status, payload, payload_hash)
  values
    (v_leg.organization_id, v_leg.call_id, p_source, p_raw_status,
     coalesce(p_payload, '{}'::jsonb), p_payload_hash)
  on conflict (organization_id, payload_hash) do nothing
  returning id into v_id;

  if v_id is null then
    return null;
  end if;

  -- Forward only: a late `ringing` after `in_progress`, or a second ending, changes nothing.
  if p_status is not null and app.call_status_rank(p_status) > app.call_status_rank(v_leg.status) then
    update public.call_participants
       set status = p_status,
           joined_at = case when p_status = 'in_progress' then coalesce(joined_at, now()) else joined_at end,
           left_at = case when app.call_status_rank(p_status) = 2 then coalesce(left_at, now()) else left_at end,
           duration_seconds = case when app.call_status_rank(p_status) = 2 and p_duration is not null
                                   then p_duration else duration_seconds end
     where id = v_leg.id;
  end if;

  if p_recording_url is not null then
    update public.calls
       set recording_url = coalesce(recording_url, p_recording_url),
           recording_available_at = coalesce(recording_available_at, now())
     where organization_id = v_leg.organization_id and id = v_leg.call_id;
  end if;

  perform app.settle_call(v_leg.organization_id, v_leg.call_id);
  return v_id;
end;
$fn$;

comment on function public.record_call_event(text, text, text, text, integer, text, jsonb, text) is
  'The carrier reporting on one leg. The leg is found by the carrier''s identifier and the call is settled from all of its legs; one leg ending is not the call ending. A repeated payload is a no-op.';
revoke all on function public.record_call_event(text, text, text, text, integer, text, jsonb, text) from public;
grant execute on function public.record_call_event(text, text, text, text, integer, text, jsonb, text) to voice_webhook;

-- The agent's browser joins a room this platform named; the carrier hands that leg its identifier
-- only then, so the TwiML request that carries both is where the leg learns it. Derived from the
-- room, which a business cannot guess; written once.
create function public.record_call_leg(p_conference_name text, p_external_id text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_call public.calls;
  v_leg  uuid;
begin
  if (select count(*) from public.calls where conference_name = p_conference_name) <> 1 then
    return null;
  end if;
  select * into v_call from public.calls where conference_name = p_conference_name;

  update public.call_participants
     set external_id = p_external_id
   where id = (select p.id from public.call_participants p
                where p.organization_id = v_call.organization_id and p.call_id = v_call.id
                  and p.party = 'agent' and p.external_id is null and p.left_at is null
                order by p.created_at limit 1)
  returning id into v_leg;
  return v_leg;
end;
$fn$;
revoke all on function public.record_call_leg(text, text) from public;
grant execute on function public.record_call_leg(text, text) to voice_webhook;

-- ---------------------------------------------------------------------------
-- 6. An inbound call is recorded by the carrier, for the business whose number rang
-- ---------------------------------------------------------------------------

-- Which business a called number belongs to: exactly one, active, and taking calls on it.
create function app.voice_number_owner(p_e164 text)
returns table (organization_id uuid, phone_number_id uuid)
language sql stable security definer set search_path = '' as $$
  select (array_agg(n.organization_id))[1], (array_agg(n.id))[1]
    from public.phone_numbers n
   where n.e164 = p_e164 and n.lifecycle = 'active' and n.voice_inbound_enabled
  having count(*) = 1
$$;
revoke all on function app.voice_number_owner(text) from public;

-- Written as the platform *not answering*, because that is what it does until a route is wired to
-- the carrier's request: a business learns it was rung and by whom, and is never shown a call that
-- connected. The caller is matched to a customer only when exactly one holds the number, and never
-- created.
create function public.record_inbound_call(
  p_external_id  text,
  p_to_number    text,
  p_from_number  text,
  p_payload      jsonb,
  p_payload_hash text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor  constant uuid := '00000000-0000-4000-8000-0000000000a2';
  v_org    uuid;
  v_number uuid;
  v_from   text;
  v_call   uuid;
begin
  select o.organization_id, o.phone_number_id into v_org, v_number from app.voice_number_owner(p_to_number) o;
  if v_org is null then
    return null;
  end if;

  if exists (select 1 from public.call_participants where external_id = p_external_id) then
    return null;
  end if;

  -- A caller id that is not a number (withheld, restricted) is a caller nobody can name.
  v_from := case when p_from_number ~ '^\+[1-9][0-9]{7,14}$' then p_from_number end;

  insert into public.calls
    (organization_id, direction, status, from_number, to_number, phone_number_id, ended_at, created_by)
  values
    (v_org, 'inbound', 'no_answer', v_from, p_to_number, v_number, now(), v_actor)
  returning id into v_call;

  insert into public.call_participants
    (organization_id, call_id, party, external_id, status, left_at)
  values
    (v_org, v_call, 'customer', p_external_id, 'no_answer', now());

  insert into public.call_events (organization_id, call_id, source, raw_status, payload, payload_hash)
  values (v_org, v_call, 'inbound', 'ringing', coalesce(p_payload, '{}'::jsonb), p_payload_hash)
  on conflict (organization_id, payload_hash) do nothing;

  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  select v_org, v_actor, 'customer', c.customer_id, 'call.ended',
         jsonb_build_object('call_id', v_call, 'status', 'no_answer', 'duration', null)
    from public.calls c where c.id = v_call and c.customer_id is not null;

  return v_call;
end;
$fn$;
revoke all on function public.record_inbound_call(text, text, text, jsonb, text) from public;
grant execute on function public.record_inbound_call(text, text, text, jsonb, text) to voice_webhook;

-- ---------------------------------------------------------------------------
-- 7. A tenant no longer writes what the carrier says
-- ---------------------------------------------------------------------------

-- The status, the ending and the duration of a call are the carrier's word. They were granted to
-- every member who may place a call, which let anyone with that capability mark their own call
-- completed; the only caller was the failed-dial path, which gets its own door below.
revoke update on public.calls from authenticated;

-- The provider's address for a recording is not for a member to read: it is the carrier's reference,
-- needs the carrier's credentials, and is reached only through `call_recording_reference`.
revoke select on public.calls from authenticated;
grant select (id, organization_id, customer_id, direction, status, from_number, to_number, outcome_id,
              note, started_at, answered_at, ended_at, duration_seconds, created_at, created_by,
              conference_name, phone_number_id, recording_available_at)
  on public.calls to authenticated;
grant insert (phone_number_id) on public.calls to authenticated;

-- A leg's provider identifier is learned after the carrier is asked, by the web runtime that asked.
-- Written once, to a leg still waiting for it, by a member who may place the call.
create function public.set_call_leg_provider_id(
  p_organization_id uuid,
  p_participant_id  uuid,
  p_external_id     text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  if p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'call.place') then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  update public.call_participants
     set external_id = p_external_id
   where organization_id = p_organization_id and id = p_participant_id
     and external_id is null and left_at is null;
  if not found then
    raise exception 'that leg is not waiting for a provider identifier' using errcode = '42501';
  end if;
end;
$fn$;
revoke all on function public.set_call_leg_provider_id(uuid, uuid, text) from public, anon;
grant execute on function public.set_call_leg_provider_id(uuid, uuid, text) to authenticated;

-- The carrier refused to ring anybody. Only a call nobody has been connected to can fail this way,
-- and only by the person who placed it.
create function public.fail_call_attempt(p_organization_id uuid, p_call_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  if p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'call.place') then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.calls
     where organization_id = p_organization_id and id = p_call_id and status = 'ringing' and answered_at is null
  ) then
    raise exception 'that call is not waiting to connect' using errcode = '42501';
  end if;
  update public.call_participants
     set status = 'failed', left_at = coalesce(left_at, now())
   where organization_id = p_organization_id and call_id = p_call_id and left_at is null;
  update public.calls
     set status = 'failed', ended_at = greatest(now(), started_at)
   where organization_id = p_organization_id and id = p_call_id;
end;
$fn$;
revoke all on function public.fail_call_attempt(uuid, uuid) from public, anon;
grant execute on function public.fail_call_attempt(uuid, uuid) to authenticated;

-- Wrapping up says how it went, in the business's words. It does not say how the network went: the
-- previous version forced every call it touched to `completed` and wiped the carrier's duration.
-- A duration may be typed only for a call that never had a leg, which is one written down by hand.
drop function public.record_call_outcome(uuid, uuid, uuid, text, integer, text);

create function public.record_call_outcome(
  p_organization_id  uuid,
  p_call_id          uuid,
  p_outcome_id       uuid,
  p_note             text,
  p_duration_seconds integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_call  public.calls;
begin
  if v_actor is null
     or p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'call.place') then
    raise exception 'that call is not yours to write up' using errcode = '42501';
  end if;

  update public.calls c
     set outcome_id = p_outcome_id,
         note = coalesce(p_note, ''),
         duration_seconds = case
           when p_duration_seconds is not null
                and not exists (select 1 from public.call_participants p
                                 where p.organization_id = c.organization_id and p.call_id = c.id)
             then p_duration_seconds
           else c.duration_seconds end
   where c.organization_id = p_organization_id and c.id = p_call_id
   returning * into v_call;

  if not found then
    raise exception 'that call is not yours to write up' using errcode = '42501';
  end if;

  if v_call.customer_id is not null then
    insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
    values (p_organization_id, v_actor, 'customer', v_call.customer_id, 'call.wrapped_up',
            jsonb_build_object('call_id', v_call.id, 'outcome_id', p_outcome_id));
  end if;

  return jsonb_build_object('id', v_call.id, 'outcome_id', v_call.outcome_id, 'status', v_call.status);
end;
$fn$;
revoke all on function public.record_call_outcome(uuid, uuid, uuid, text, integer) from public, anon;
grant execute on function public.record_call_outcome(uuid, uuid, uuid, text, integer) to authenticated;

-- An unknown caller becomes a known one when a person says who it was. Only an unlinked call, only to
-- a customer of this business.
create function public.link_call_customer(p_organization_id uuid, p_call_id uuid, p_customer_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null
     or p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'call.place') then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  if not exists (select 1 from public.customers where organization_id = p_organization_id and id = p_customer_id) then
    raise exception 'no such customer here' using errcode = '42501';
  end if;
  update public.calls set customer_id = p_customer_id
   where organization_id = p_organization_id and id = p_call_id and customer_id is null;
  if not found then
    raise exception 'that call already has a customer, or is not here' using errcode = '42501';
  end if;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'customer', p_customer_id, 'call.linked',
          jsonb_build_object('call_id', p_call_id));
end;
$fn$;
revoke all on function public.link_call_customer(uuid, uuid, uuid) from public, anon;
grant execute on function public.link_call_customer(uuid, uuid, uuid) to authenticated;

-- The carrier's reference to a recording, for the person who may play it and for nobody else.
create function public.call_recording_reference(p_organization_id uuid, p_call_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if p_organization_id not in (select app.current_tenant_ids())
     or not (app.has_capability(p_organization_id, 'call.place') or app.has_capability(p_organization_id, 'organization.manage')) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  return (select c.recording_url from public.calls c
           where c.organization_id = p_organization_id and c.id = p_call_id);
end;
$fn$;
revoke all on function public.call_recording_reference(uuid, uuid) from public, anon;
grant execute on function public.call_recording_reference(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Placing a call, and the participants of one that is live
-- ---------------------------------------------------------------------------

-- Recreated in full (D15). The customer is optional (a number nobody has recorded is still dialled),
-- and the call names the number it was placed from. The credit gate is unchanged.
drop function public.open_call(uuid, uuid, text, text, text);

create function public.open_call(
  p_organization_id uuid,
  p_customer_id     uuid,
  p_conference_name text,
  p_from_number     text,
  p_to_number       text
)
returns uuid
language plpgsql
set search_path = ''
as $fn$
declare
  v_id     uuid;
  v_number uuid;
  v_customer uuid;
  d        record;
begin
  select * into d from app.spend_decision(p_organization_id, 'voice_minutes', 1);

  if not d.allowed then
    if d.reason = 'allowance_hard_limit' then
      raise exception 'this account has used all the calling its plan allows: %', coalesce(d.detail, 'the included minutes are used up')
        using errcode = '23514';
    else
      raise exception 'there is no calling credit left on this account'
        using errcode = '23514';
    end if;
  end if;

  select n.id into v_number from public.phone_numbers n
   where n.organization_id = p_organization_id and n.e164 = p_from_number;

  insert into public.calls
    (organization_id, customer_id, direction, status, from_number, to_number,
     conference_name, phone_number_id, created_by)
  values
    (p_organization_id, p_customer_id, 'outbound', 'ringing', p_from_number, p_to_number,
     p_conference_name, v_number, (select auth.uid()))
  returning id into v_id;

  select customer_id into v_customer from public.calls where id = v_id;
  if v_customer is not null then
    insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
    values (p_organization_id, (select auth.uid()), 'customer', v_customer, 'call.placed',
            jsonb_build_object('call_id', v_id, 'direction', 'outbound', 'to_number', p_to_number));
  end if;

  return v_id;
end;
$fn$;

comment on function public.open_call(uuid, uuid, text, text, text) is
  'A room, the credit check that guards it, and the event. security invoker: the calls policies decide whether the caller may, and this adds no authority of its own. The legs are written by a trigger; the customer, when not given, is the one the number names.';
revoke all on function public.open_call(uuid, uuid, text, text, text) from public;
grant execute on function public.open_call(uuid, uuid, text, text, text) to authenticated;

-- A party cannot be added to a call that is over.
create or replace function public.add_call_participant(
  p_organization_id uuid,
  p_call_id uuid,
  p_party text,
  p_external_id text default null
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_organization_id not in (select app.current_tenant_ids()) or not app.has_capability(p_organization_id, 'call.place') then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  if not exists (select 1 from public.calls where organization_id = p_organization_id and id = p_call_id) then
    raise exception 'no such call in this organization' using errcode = '42501';
  end if;
  if exists (select 1 from public.calls where organization_id = p_organization_id and id = p_call_id and app.call_status_rank(status) = 2) then
    raise exception 'that call has ended' using errcode = '23514';
  end if;
  insert into public.call_participants (organization_id, call_id, party, external_id, status)
    values (p_organization_id, p_call_id, p_party, p_external_id, 'ringing')
    returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 9. A number says what it can do, and whether it is ready is not stored
-- ---------------------------------------------------------------------------

create index phone_numbers_e164_idx on public.phone_numbers (e164);

-- Whether a number can be used right now, in the four words a tenant needs. Derived on every read
-- from the provider resource and binding, under the reader's own rights.
create view public.phone_number_readiness with (security_invoker = true) as
select n.organization_id,
       n.id as phone_number_id,
       case
         when n.lifecycle <> 'active' then 'unavailable'
         when n.origin = 'provisioned' then
           case r.status
             when 'active' then
               case b.status
                 when 'active' then 'ready'
                 when 'provisioning' then 'setup_required'
                 when 'failed' then 'degraded'
                 else 'unavailable'
               end
             when 'pending' then 'setup_required'
             when 'failed' then 'degraded'
             else 'unavailable'
           end
         when n.origin in ('external', 'browser') then 'ready'
         else 'unavailable'
       end as readiness
  from public.phone_numbers n
  left join public.organization_provider_resources r
    on r.organization_id = n.organization_id and r.id = n.provider_resource_id
  left join public.organization_provider_bindings b
    on b.organization_id = r.organization_id and b.id = r.binding_id;

grant select on public.phone_number_readiness to authenticated;

-- A tenant configures how its number is used. It does not own where the number came from, which
-- provider resource stands behind it, or whether it exists.
create function public.configure_phone_number(
  p_organization_id uuid,
  p_phone_number_id uuid,
  p_label           text,
  p_purpose         text,
  p_voice_inbound   boolean,
  p_voice_outbound  boolean,
  p_sms_inbound     boolean,
  p_sms_outbound    boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_origin text;
begin
  if p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'organization.manage') then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  select origin into v_origin from public.phone_numbers
   where organization_id = p_organization_id and id = p_phone_number_id;
  if not found then
    raise exception 'no such number here' using errcode = '42501';
  end if;
  if v_origin <> 'provisioned' and (p_voice_inbound or p_sms_inbound) then
    raise exception 'this number does not take inbound traffic through GildOps' using errcode = '23514';
  end if;
  update public.phone_numbers
     set label = nullif(btrim(p_label), ''),
         purpose = p_purpose,
         voice_inbound_enabled = p_voice_inbound,
         voice_outbound_enabled = p_voice_outbound,
         sms_inbound_enabled = p_sms_inbound,
         sms_outbound_enabled = p_sms_outbound,
         updated_at = now()
   where organization_id = p_organization_id and id = p_phone_number_id;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'phone_number', p_phone_number_id, 'phone_number.configured',
          jsonb_build_object('purpose', p_purpose));
end;
$fn$;
revoke all on function public.configure_phone_number(uuid, uuid, text, text, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.configure_phone_number(uuid, uuid, text, text, boolean, boolean, boolean, boolean) to authenticated;

-- Staff syncing a number from the carrier must not erase the name a business gave it.
create or replace function public.sync_phone_number(
  p_organization_id uuid,
  p_provider_resource_id uuid,
  p_e164 text,
  p_label text default null,
  p_status text default 'active'
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_actor uuid := auth.uid();
begin
  perform app.require_platform_staff();
  if not exists (
    select 1 from public.organization_provider_resources
     where organization_id = p_organization_id and id = p_provider_resource_id and resource_type = 'twilio_phone_number'
  ) then
    raise exception 'provider resource is not a phone number in this organization' using errcode = '23503';
  end if;
  insert into public.phone_numbers (organization_id, provider_resource_id, e164, label, lifecycle, created_by)
    values (p_organization_id, p_provider_resource_id, p_e164, nullif(btrim(p_label), ''), p_status, v_actor)
    on conflict (organization_id, e164) do update
      set provider_resource_id = excluded.provider_resource_id,
          label = coalesce(excluded.label, public.phone_numbers.label),
          lifecycle = excluded.lifecycle,
          updated_at = now()
    returning id into v_id;
  return v_id;
end $$;

-- A number belongs to a member once. Assigning it again is choosing whether it is their default.
create or replace function public.assign_phone_number(
  p_organization_id uuid,
  p_phone_number_id uuid,
  p_member_id uuid default null,
  p_resource_id uuid default null,
  p_default boolean default false
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_id uuid;
begin
  if p_organization_id not in (select app.current_tenant_ids()) or not app.has_capability(p_organization_id, 'organization.manage') then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  if p_default and p_member_id is null then
    raise exception 'a default identity belongs to a member' using errcode = '23514';
  end if;
  if p_default then
    update public.phone_number_assignments set is_default = false
     where organization_id = p_organization_id and member_id = p_member_id and released_at is null;
  end if;
  select id into v_id from public.phone_number_assignments
   where organization_id = p_organization_id and phone_number_id = p_phone_number_id and released_at is null
     and member_id is not distinct from p_member_id and resource_id is not distinct from p_resource_id;
  if v_id is not null then
    update public.phone_number_assignments set is_default = p_default where id = v_id;
    return v_id;
  end if;
  insert into public.phone_number_assignments (organization_id, phone_number_id, member_id, resource_id, is_default, created_by)
    values (p_organization_id, p_phone_number_id, p_member_id, p_resource_id, p_default, v_actor)
    returning id into v_id;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
    values (p_organization_id, v_actor, 'phone_number', p_phone_number_id, 'phone_number.assigned', jsonb_build_object('assignment_id', v_id));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 10. One answer to "which number does this person dial from"
-- ---------------------------------------------------------------------------

drop function public.resolve_effective_outbound_identity(uuid);

-- Preference, then the member's default, then the business's. An explicit number is honoured only if
-- it is one of those the caller may use. Every candidate must be active, enabled for outbound calls,
-- a number GildOps holds or one the business owned (a caller id), and ready.
create function public.resolve_outbound_number(p_organization_id uuid, p_phone_number_id uuid default null)
returns table (phone_number_id uuid, e164 text, source text)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select m.id from public.memberships m
     where m.organization_id = p_organization_id and m.user_id = (select auth.uid())
       and p_organization_id in (select app.current_tenant_ids())
  ),
  usable as (
    select n.id, n.e164 from public.phone_numbers n
      join public.phone_number_readiness r on r.organization_id = n.organization_id and r.phone_number_id = n.id
     where n.organization_id = p_organization_id and n.lifecycle = 'active' and n.voice_outbound_enabled
       and n.origin in ('provisioned', 'external') and r.readiness = 'ready'
  ),
  candidates as (
    select u.id, u.e164, 'preference'::text as source, 0 as rank
      from public.user_phone_number_preferences p
      join me on me.id = p.member_id
      join usable u on u.id = p.phone_number_id
     where p.organization_id = p_organization_id
    union all
    select u.id, u.e164, 'member_default', 1
      from public.phone_number_assignments a
      join me on me.id = a.member_id
      join usable u on u.id = a.phone_number_id
     where a.organization_id = p_organization_id and a.released_at is null and a.outbound_allowed and a.is_default
    union all
    select u.id, u.e164, 'member', 2
      from public.phone_number_assignments a
      join me on me.id = a.member_id
      join usable u on u.id = a.phone_number_id
     where a.organization_id = p_organization_id and a.released_at is null and a.outbound_allowed and not a.is_default
    union all
    select u.id, u.e164, 'organization_default', 3
      from public.telephony_settings t
      join usable u on u.e164 = t.calling_number
     where t.organization_id = p_organization_id
       and exists (select 1 from me)
  )
  select c.id, c.e164, c.source from candidates c
   where p_phone_number_id is null or c.id = p_phone_number_id
   order by c.rank, c.e164
   limit 1
$$;
revoke all on function public.resolve_outbound_number(uuid, uuid) from public, anon;
grant execute on function public.resolve_outbound_number(uuid, uuid) to authenticated;

create or replace function public.set_user_phone_number_preference(p_organization_id uuid, p_phone_number_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_member uuid;
begin
  select id into v_member from public.memberships where organization_id = p_organization_id and user_id = auth.uid();
  if v_member is null then
    raise exception 'not a member here' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.phone_number_assignments a
      join public.phone_numbers n on n.organization_id = a.organization_id and n.id = a.phone_number_id
     where a.organization_id = p_organization_id and a.member_id = v_member and a.phone_number_id = p_phone_number_id
       and a.released_at is null and a.outbound_allowed and n.lifecycle = 'active' and n.voice_outbound_enabled
  ) then
    raise exception 'that number is not a permitted outbound identity' using errcode = '42501';
  end if;
  insert into public.user_phone_number_preferences (organization_id, member_id, phone_number_id)
    values (p_organization_id, v_member, p_phone_number_id)
    on conflict (organization_id, member_id) do update set phone_number_id = excluded.phone_number_id, updated_at = now();
end $$;

-- Texts are taken on the number that says it takes texts, not the one that says it takes calls.
create or replace function app.sms_number_owner(p_e164 text, p_require_inbound boolean)
returns table (organization_id uuid, phone_number_id uuid)
language sql stable security definer set search_path = '' as $$
  select (array_agg(n.organization_id))[1], (array_agg(n.id))[1]
    from public.phone_numbers n
   where n.e164 = p_e164 and n.lifecycle = 'active' and (not p_require_inbound or n.sms_inbound_enabled)
  having count(*) = 1
$$;
