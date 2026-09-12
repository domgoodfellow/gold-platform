-- Inviting somebody who does not have an account yet — the gap `add_member_by_email`'s own
-- migration comment named: "requires an account already exist ... revisit when invitations
-- arrive." This is that arrival (D45).
--
-- **Modeled on `customer_portal_invites` (20260829000007), with one deliberate difference.** The
-- portal invite stores its token in plaintext because it grants *viewing* — a shared-document-
-- link security model, stated as such in that migration. Granting an organizational *role* is
-- higher-stakes, so this table stores only a hash. The plaintext is generated the identical way
-- (two concatenated `gen_random_uuid()`s — 256 bits, no `pgcrypto` dependency, for the same
-- `search_path = ''` reason the portal invite's own comment gives) and returned exactly once, to
-- the caller who made it, to build a link or send an email — never stored, never selectable
-- back out.
--
-- **`role.manage` is reused, not a new capability.** Inviting someone is the same authority
-- `add_member_by_email` already requires; a business that could add a colleague directly could
-- always invite one instead.

create table public.organization_invitations (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  email           text        not null check (email = lower(btrim(email)) and length(email) > 0),
  role_id         uuid        not null,

  -- sha256 hex digest (64 chars) of the plaintext token. `sha256` is a core pg_catalog builtin
  -- since PG 14 -- no extension, so it resolves under this file's own pinned empty search_path.
  token_hash      text        not null check (length(token_hash) = 64),

  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),
  expires_at      timestamptz not null default (now() + interval '7 days'),
  accepted_at     timestamptz,
  revoked_at      timestamptz,

  constraint organization_invitations_role_same_org
    foreign key (organization_id, role_id) references public.roles (organization_id, id)
);

comment on table public.organization_invitations is
  'A link a business sends someone to join it, with a role attached. Token is hashed at rest -- unlike customer_portal_invites, this grants a role rather than a view, so plaintext never touches a stored row.';

create unique index organization_invitations_token_hash_unique
  on public.organization_invitations (token_hash);

-- One pending invitation per email per organization at a time -- `invite_member` closes an
-- expired one automatically before inserting a fresh one, rather than loosening this to admit
-- two live invitations to the same address.
create unique index organization_invitations_org_email_pending_unique
  on public.organization_invitations (organization_id, email)
  where accepted_at is null and revoked_at is null;

create index organization_invitations_org_idx
  on public.organization_invitations (organization_id);

alter table public.organization_invitations enable row level security;
alter table public.organization_invitations force row level security;

create policy organization_invitations_select on public.organization_invitations
  for select to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'role.manage')
  );

create policy organization_invitations_insert on public.organization_invitations
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'role.manage')
  );

-- Revoking only, same shape as customer_portal_invites: nothing may move an invitation to a
-- different organization or address, or un-revoke or un-accept it.
create policy organization_invitations_update on public.organization_invitations
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'role.manage')
  )
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'role.manage')
  );

grant select, insert on public.organization_invitations to authenticated;
grant update (revoked_at) on public.organization_invitations to authenticated;

-- ---------------------------------------------------------------------------
-- Inviting
-- ---------------------------------------------------------------------------

create function public.invite_member(
  p_organization_id uuid,
  p_email           text,
  p_role_id         uuid
)
returns text
language plpgsql
volatile
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

  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'that is not an email address'
      using errcode = '22023';
  end if;

  -- Close out a stale pending invitation to the same address first, so re-inviting after
  -- expiry needs no manual revoke -- `for update` makes this safe against a concurrent call
  -- doing the same thing. A still-live pending invitation is left alone and refused below by
  -- the partial unique index, with a clearer message than a raw constraint violation would give.
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

  -- Returned once, to the caller who made it. Never stored, and never selectable back out --
  -- storing only the hash is what makes that true regardless of who might later read this row.
  return v_token;
end;
$fn$;

comment on function public.invite_member(uuid, text, uuid) is
  'Invites somebody who may not have an account yet. Plaintext token returned once to build a link/email; only its hash is stored. Authorization is RLS (role.manage) on the insert, same as add_member_by_email.';

revoke all on function public.invite_member(uuid, text, uuid) from public;
grant execute on function public.invite_member(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Accepting
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER, same reason claim_portal_invite is: the accepting caller has no membership
-- yet, so there is nothing for RLS to key on until this function writes one.
create function public.accept_invitation(
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

  update public.organization_invitations
     set accepted_at = now()
   where id = v_invite.id;

  insert into public.memberships (organization_id, user_id, role_id, display_name, created_by)
  values (v_invite.organization_id, v_actor, v_invite.role_id, v_display, v_actor)
  on conflict (organization_id, user_id) do nothing;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_invite.organization_id, v_actor, 'organization', v_invite.organization_id,
     'organization.member_invitation_accepted', jsonb_build_object('email', v_invite.email));

  return v_invite.organization_id;
end;
$fn$;

comment on function public.accept_invitation(text, text) is
  'Claims an invitation by its plaintext token, hashed and looked up the same way it was stored. Refuses unless the accepting user''s own email matches the invited address. Idempotent against a retried call via the memberships upsert.';

revoke all on function public.accept_invitation(text, text) from public;
grant execute on function public.accept_invitation(text, text) to authenticated;
