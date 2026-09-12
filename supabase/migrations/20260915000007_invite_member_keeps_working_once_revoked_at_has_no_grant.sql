-- 20260915000005 removed `authenticated`'s grant on `organization_invitations.revoked_at` so
-- nothing could set it back to null or touch an already-accepted row. It missed that
-- `invite_member` itself writes that column -- the auto-expire step that closes a stale pending
-- invitation before issuing a fresh one is a direct `update ... set revoked_at = now()`, and
-- `invite_member` was `security invoker`, running as the calling admin. Postgres checks column
-- UPDATE privilege at parse time, before any row is evaluated, so every call started failing
-- with a missing privilege -- including the ordinary case where nothing was actually expired.
--
-- Corrected by making `invite_member` `security definer`, the same shape `accept_invitation` and
-- `revoke_invitation` already use, with the capability check that used to be implicit in the
-- insert policy now explicit in the body -- security definer bypasses RLS entirely, so nothing
-- upstream is checking `role.manage` for this function any more except this line.

drop function if exists public.invite_member(uuid, text, uuid);

create function public.invite_member(
  p_organization_id uuid,
  p_email           text,
  p_role_id         uuid
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_email text := lower(btrim(p_email));
  v_token text;
  v_hash  text;
begin
  if v_actor is null then
    raise exception 'invite_member requires an authenticated caller'
      using errcode = '42501';
  end if;

  if not app.has_capability(p_organization_id, 'role.manage') then
    raise exception 'you cannot invite people here'
      using errcode = '42501';
  end if;

  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'that is not an email address'
      using errcode = '22023';
  end if;

  -- Close out a stale pending invitation to the same address first, so re-inviting after
  -- expiry needs no manual revoke -- `for update` makes this safe against a concurrent call
  -- doing the same thing.
  perform 1
    from public.organization_invitations
   where organization_id = p_organization_id
     and email = v_email
     and accepted_at is null
     and revoked_at is null
     and expires_at <= now()
     for update;

  update public.organization_invitations
     set revoked_at = now()
   where organization_id = p_organization_id
     and email = v_email
     and accepted_at is null
     and revoked_at is null
     and expires_at <= now();

  if exists (
    select 1 from public.organization_invitations
     where organization_id = p_organization_id
       and email = v_email
       and accepted_at is null
       and revoked_at is null
  ) then
    raise exception 'there is already a pending invitation to that address'
      using errcode = '23505';
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');
  v_hash  := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');

  insert into public.organization_invitations
    (organization_id, email, role_id, token_hash, created_by)
  values
    (p_organization_id, v_email, p_role_id, v_hash, v_actor);

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'organization', p_organization_id, 'organization.member_invited',
     jsonb_build_object('email', v_email, 'role_id', p_role_id));

  return v_token;
end;
$fn$;

comment on function public.invite_member(uuid, text, uuid) is
  'Invites somebody who may not have an account yet. Plaintext token returned once to build a link/email; only its hash is stored. security definer as of 20260915000007 (its own auto-expire step writes revoked_at, which no longer carries a grant to authenticated) -- role.manage is now checked explicitly in the body rather than implicitly by the insert policy.';

revoke all on function public.invite_member(uuid, text, uuid) from public;
grant execute on function public.invite_member(uuid, text, uuid) to authenticated;
