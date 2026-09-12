-- `invite_member` writes `organization.member_invited` and `accept_invitation` writes
-- `organization.member_invitation_accepted` -- `revoke_invitation` (20260915000005) wrote
-- neither, so half of an invitation's life had no audit trail and the other half did.
--
-- Written only when a row actually moved. `revoke_invitation` is already correctly a safe no-op
-- on an already-revoked or already-accepted invitation (that is the whole point of
-- 20260915000005) -- `FOUND` after the update is what tells the two apart, so calling it twice
-- writes exactly one event, not two, and calling it on a row it cannot touch writes none.
--
-- No secret in the payload: the invitation id, the address it named, and the role it would have
-- granted -- everything a person reading the timeline needs to understand what happened, nothing
-- a token or its hash would add.

create or replace function public.revoke_invitation(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
  v_email text;
  v_role  uuid;
begin
  if v_actor is null then
    raise exception 'revoke_invitation requires an authenticated caller'
      using errcode = '42501';
  end if;

  select organization_id, email, role_id into v_org, v_email, v_role
    from public.organization_invitations
   where id = p_id;

  -- No such row: nothing to revoke, and not distinguished from "you may not revoke this one" --
  -- the same "one message, don't tell them apart" reasoning accept_invitation already uses.
  if v_org is null or not app.has_capability(v_org, 'role.manage') then
    raise exception 'you cannot revoke that invitation'
      using errcode = '42501';
  end if;

  update public.organization_invitations
     set revoked_at = now()
   where id = p_id
     and revoked_at is null
     and accepted_at is null;

  if found then
    insert into public.events
      (organization_id, actor_id, entity_type, entity_id, action, payload)
    values
      (v_org, v_actor, 'organization', v_org, 'organization.member_invitation_revoked',
       jsonb_build_object('invitation_id', p_id, 'email', v_email, 'role_id', v_role));
  end if;
end;
$fn$;

comment on function public.revoke_invitation(uuid) is
  'The only way to revoke an invitation: revoked_at moves from null to now() and never back, and never on a row already accepted. Writes organization.member_invitation_revoked, and only when the update actually matched a row (20260915000009) -- an already-revoked or already-accepted call is a safe no-op with no second event.';

revoke all on function public.revoke_invitation(uuid) from public;
grant execute on function public.revoke_invitation(uuid) to authenticated;
