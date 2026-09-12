-- Two gaps in the invitation lifecycle, both found by review after 20260915000007 shipped.
--
-- **First: an anonymous Supabase session could reach `accept_invitation` at all.** D22 gives a
-- booking/portal visitor a real `auth.uid()` so RLS stays the boundary, which also means such a
-- session satisfies `accept_invitation`'s existing "an authenticated caller" check exactly as a
-- registered one does. `auth.users.email` is null for an anonymous account, so the existing
-- email-match check already refused one incidentally -- but incidentally is not the same as on
-- purpose, and the same reasoning `20260830000001` already gave for `create_organization` applies
-- here without change: a session that exists to be scoped to one booking has no business
-- accepting a role anywhere. The check is added explicitly, the same shape and the same
-- `coalesce(..., true)` (null reads as "not established anonymous", never as "not anonymous").
--
-- **Second: accepting could silently do nothing to membership while still marking itself
-- accepted.** `insert ... on conflict (organization_id, user_id) do nothing` was written for
-- retry-safety against a *repeated* accept of the same token -- but it just as happily swallows
-- the case where the invitee became a member through a *different* path (`add_member_by_email`,
-- or simply already belonged before anyone invited them) before they accepted. The invitation
-- would still record `accepted_at`, the row's own role would be silently left alone, and the
-- audit trail would say something happened that did not: an invitation is for adding somebody who
-- is not yet a member, never a role-change mechanism in disguise.
--
-- Corrected two ways, matching the "narrow door" shape this schema already uses everywhere else:
-- `invite_member` now refuses to create an invitation to an address that already has an account
-- and is already a member of that organization (the ordinary case, given a clear message rather
-- than a constraint violation) -- and `accept_invitation` drops the silent `on conflict do
-- nothing` in favour of a plain insert whose `unique_violation` is caught and turned into a
-- refusal, with `accepted_at` only ever written *after* that insert succeeds (the race case: a
-- membership appearing between the invitation being sent and being accepted). Both paths surface
-- the same message, since both describe the same fact from two different moments in the same
-- invitation's life.

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
  v_existing_user uuid;
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

  -- An invitation adds somebody who is not yet a member -- a role change for somebody who
  -- already is one goes through member/role management instead, same reasoning as
  -- `add_member_by_email`'s own `23505` refusal for the same shape, just reached from the other
  -- direction (that function is handed a role id; this one is handed an address to resolve).
  select u.id into v_existing_user
    from auth.users u
   where lower(u.email) = v_email
   limit 1;

  if v_existing_user is not null and exists (
    select 1 from public.memberships
     where organization_id = p_organization_id
       and user_id = v_existing_user
  ) then
    raise exception 'that person is already a member of this organization'
      using errcode = 'GD004';
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
  'Invites somebody who may not have an account yet. Refuses an address that already belongs to a member of this organization (20260915000008) -- an invitation is not a role-change mechanism. Plaintext token returned once; only its hash is stored. security definer since 20260915000007, role.manage checked explicitly in the body.';

revoke all on function public.invite_member(uuid, text, uuid) from public;
grant execute on function public.invite_member(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Accepting: refuse an anonymous caller, and never mark accepted without a real membership
-- ---------------------------------------------------------------------------

create or replace function public.accept_invitation(
  p_token        text,
  p_display_name text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor       uuid := (select auth.uid());
  v_actor_email text;
  v_hash        text := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  v_invite      public.organization_invitations;
  v_display     text := btrim(p_display_name);
begin
  if v_actor is null then
    raise exception 'accept_invitation requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- Same reasoning and the same coalesce as `create_organization` (20260830000001): an
  -- anonymous session is a real, RLS-visible `auth.uid()`, and it is still not a person who may
  -- hold an organizational role. Checked here rather than left to the email-mismatch branch
  -- below, which only refused this incidentally (an anonymous account's `auth.users.email` is
  -- null) -- incidental is not the same guarantee as a check that says what it means.
  if coalesce((select u.is_anonymous from auth.users u where u.id = v_actor), true) then
    raise exception 'an anonymous session may not accept an invitation'
      using errcode = '42501';
  end if;

  if v_display = '' then
    raise exception 'a name is required'
      using errcode = '22023';
  end if;

  select * into v_invite
    from public.organization_invitations
   where token_hash = v_hash
     for update;

  -- One message for unknown, revoked, expired and already-accepted. Telling them apart would
  -- let somebody holding a dead link learn that it was once real (the same reasoning
  -- claim_portal_invite's own comment gives).
  if v_invite.id is null
     or v_invite.revoked_at is not null
     or v_invite.accepted_at is not null
     or v_invite.expires_at <= now()
  then
    raise exception 'that invitation is not valid'
      using errcode = '42501';
  end if;

  select lower(u.email) into v_actor_email from auth.users u where u.id = v_actor;

  -- Higher stakes than the portal's view-only link: this grants a role, so a forwarded link
  -- must not let a different person than the one invited claim it.
  if v_actor_email is distinct from v_invite.email then
    raise exception 'that invitation was sent to a different address'
      using errcode = '42501';
  end if;

  -- The membership insert is what actually joins them -- and it is attempted before
  -- `accepted_at` is ever written, not after, so a race that loses (somebody else made this
  -- caller a member of this organization between the invitation being sent and being accepted)
  -- leaves the invitation exactly as it was: not accepted, and not silently swallowed. Unlike
  -- 20260915000003's `on conflict (organization_id, user_id) do nothing`, a genuine conflict here
  -- is surfaced and turned into the same refusal a caller who was already a member would get from
  -- `invite_member` on the way in.
  begin
    insert into public.memberships (organization_id, user_id, role_id, display_name, created_by)
    values (v_invite.organization_id, v_actor, v_invite.role_id, v_display, v_actor);
  exception when unique_violation then
    raise exception 'you are already a member of this organization'
      using errcode = 'GD004';
  end;

  update public.organization_invitations
     set accepted_at = now()
   where id = v_invite.id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_invite.organization_id, v_actor, 'organization', v_invite.organization_id,
     'organization.member_invitation_accepted', jsonb_build_object('email', v_invite.email));

  return v_invite.organization_id;
end;
$fn$;

comment on function public.accept_invitation(text, text) is
  'Claims an invitation by its plaintext token, hashed and looked up the same way it was stored. Refuses an anonymous session (20260915000008) and refuses unless the accepting user''s own email matches the invited address. The membership insert runs before accepted_at is written, so a membership created through another path in between is a refusal, never a silent no-op with a false accepted state.';

revoke all on function public.accept_invitation(text, text) from public;
grant execute on function public.accept_invitation(text, text) to authenticated;
