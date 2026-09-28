-- Work Order 4: conference participant operations. D38 already gave a call its conference and
-- participant rows; this is the one thing that still did not exist — an operation on a
-- participant. Every write here is `security definer`, exactly `record_call_event`'s own reason
-- restated for a caller-initiated write rather than a carrier one: `call_participants` carries no
-- insert/update/delete grant for `authenticated` at all (the comment on that table says
-- "everything that writes here goes through record_call_event" — this migration adds the second,
-- caller-initiated door beside it, never a table grant).

alter table public.call_participants
  add column muted boolean not null default false;

comment on column public.call_participants.muted is
  'Whether this leg is muted in the conference. Written only by set_participant_muted, mirroring on_hold.';

-- `transfer_target` is the fourth party a warm or cold transfer needs: the destination being
-- added while the conference is live. Not `agent` (an operator did not answer this leg) and not
-- `customer` (the platform did not originate it as the party being served) and not `supervisor`
-- (nobody is listening in silently) -- a fourth, distinct role, exactly as D38's own diagram names
-- "additional agent" and "voice agent" as further conference roles this schema must be able to
-- hold even where only `transfer_target` has a caller in this change.
alter table public.call_participants
  drop constraint call_participants_party_check;
alter table public.call_participants
  add constraint call_participants_party_check
    check (party in ('agent', 'customer', 'supervisor', 'transfer_target'));

-- ---------------------------------------------------------------------------
-- add_call_participant: ring a fourth (or fifth) party into a conference that already exists.
-- ---------------------------------------------------------------------------
create function public.add_call_participant(
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
  -- The same organization-ownership proof `record_call_event`'s composite FK gives the carrier
  -- path; a caller-initiated write proves it explicitly instead, since there is no FK to lean on
  -- for an argument nobody has inserted yet.
  if not exists (select 1 from public.calls where organization_id = p_organization_id and id = p_call_id) then
    raise exception 'no such call in this organization' using errcode = '42501';
  end if;
  insert into public.call_participants (organization_id, call_id, party, external_id, status)
    values (p_organization_id, p_call_id, p_party, p_external_id, 'ringing')
    returning id into v_id;
  return v_id;
end $$;
revoke all on function public.add_call_participant(uuid, uuid, text, text) from public;
grant execute on function public.add_call_participant(uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- remove_call_participant: end one leg without ending the conference (D38's own point).
-- ---------------------------------------------------------------------------
create function public.remove_call_participant(
  p_organization_id uuid,
  p_participant_id uuid
) returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_organization_id not in (select app.current_tenant_ids()) or not app.has_capability(p_organization_id, 'call.place') then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  update public.call_participants
     set status = 'completed', left_at = coalesce(left_at, now())
   where organization_id = p_organization_id and id = p_participant_id and left_at is null;
  if not found then
    raise exception 'no active participant here' using errcode = '42501';
  end if;
end $$;
revoke all on function public.remove_call_participant(uuid, uuid) from public;
grant execute on function public.remove_call_participant(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- set_participant_hold / set_participant_muted: the two conference-state toggles a screen offers.
-- ---------------------------------------------------------------------------
create function public.set_participant_hold(
  p_organization_id uuid,
  p_participant_id uuid,
  p_hold boolean
) returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_organization_id not in (select app.current_tenant_ids()) or not app.has_capability(p_organization_id, 'call.place') then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  update public.call_participants set on_hold = p_hold
   where organization_id = p_organization_id and id = p_participant_id and left_at is null;
  if not found then
    raise exception 'no active participant here' using errcode = '42501';
  end if;
end $$;
revoke all on function public.set_participant_hold(uuid, uuid, boolean) from public;
grant execute on function public.set_participant_hold(uuid, uuid, boolean) to authenticated;

create function public.set_participant_muted(
  p_organization_id uuid,
  p_participant_id uuid,
  p_muted boolean
) returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_organization_id not in (select app.current_tenant_ids()) or not app.has_capability(p_organization_id, 'call.place') then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  update public.call_participants set muted = p_muted
   where organization_id = p_organization_id and id = p_participant_id and left_at is null;
  if not found then
    raise exception 'no active participant here' using errcode = '42501';
  end if;
end $$;
revoke all on function public.set_participant_muted(uuid, uuid, boolean) from public;
grant execute on function public.set_participant_muted(uuid, uuid, boolean) to authenticated;
