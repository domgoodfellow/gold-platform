-- Personal identity belongs to the account. Organization names are optional overrides.
create table public.account_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  given_name text not null default '' check (length(given_name) <= 100),
  family_name text not null default '' check (length(family_name) <= 100),
  preferred_name text not null default '' check (length(preferred_name) <= 100),
  avatar text check (avatar is null or (length(avatar) <= 2048 and avatar ~ '^https://')),
  locale text not null default 'en' check (length(locale) between 2 and 64),
  timezone text not null default 'UTC' check (length(timezone) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.account_profiles enable row level security;
grant select, insert, update on public.account_profiles to authenticated;
create policy account_profiles_read on public.account_profiles for select to authenticated
  using (user_id = (select auth.uid()) and not coalesce((select (auth.jwt()->>'is_anonymous')::boolean), false));
create policy account_profiles_insert on public.account_profiles for insert to authenticated
  with check (user_id = (select auth.uid()) and not coalesce((select (auth.jwt()->>'is_anonymous')::boolean), false));
create policy account_profiles_update on public.account_profiles for update to authenticated
  using (user_id = (select auth.uid()) and not coalesce((select (auth.jwt()->>'is_anonymous')::boolean), false))
  with check (user_id = (select auth.uid()) and not coalesce((select (auth.jwt()->>'is_anonymous')::boolean), false));

-- Auth metadata initializes cosmetic fields only; it never grants permissions.
create function app.initialize_account_profile() returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if not coalesce(new.is_anonymous, false) then
    insert into public.account_profiles(user_id, given_name, family_name, preferred_name, avatar)
    values (new.id,
      left(coalesce(new.raw_user_meta_data->>'given_name', ''), 100),
      left(coalesce(new.raw_user_meta_data->>'family_name', ''), 100),
      left(coalesce(new.raw_user_meta_data->>'preferred_name', new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), 100),
      case when coalesce(new.raw_user_meta_data->>'avatar_url', '') ~ '^https://' then left(new.raw_user_meta_data->>'avatar_url', 2048) end)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$fn$;
revoke all on function app.initialize_account_profile() from public, anon, authenticated;
create trigger initialize_account_profile after insert or update of is_anonymous on auth.users
  for each row execute function app.initialize_account_profile();
insert into public.account_profiles(user_id, given_name, family_name, preferred_name, avatar)
select id, left(coalesce(raw_user_meta_data->>'given_name', ''), 100),
  left(coalesce(raw_user_meta_data->>'family_name', ''), 100),
  left(coalesce(raw_user_meta_data->>'preferred_name', raw_user_meta_data->>'display_name', raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', ''), 100),
  case when coalesce(raw_user_meta_data->>'avatar_url', '') ~ '^https://' then left(raw_user_meta_data->>'avatar_url', 2048) end
from auth.users where not coalesce(is_anonymous, false);

-- An empty string means no organization override, preserving existing RPC signatures.
alter table public.memberships drop constraint memberships_display_name_length;
alter table public.memberships alter column display_name set default '';
alter table public.memberships add constraint memberships_display_name_length check (length(btrim(display_name)) <= 120);
comment on column public.memberships.display_name is 'Optional organization name override. Empty uses the account profile.';

-- Only the public name is shared with colleagues; account locale, timezone and avatar remain private.
create function app.member_display_names(p_organization_id uuid)
returns table(membership_id uuid, display_name text)
language sql stable security definer set search_path = '' as $fn$
  select m.id, coalesce(nullif(btrim(m.display_name), ''), nullif(p.preferred_name, ''),
    nullif(btrim(concat_ws(' ', p.given_name, p.family_name)), ''), 'Member')
  from public.memberships m left join public.account_profiles p on p.user_id = m.user_id
  where m.organization_id = p_organization_id and (select auth.uid()) is not null
    and p_organization_id in (select app.current_tenant_ids());
$fn$;
revoke all on function app.member_display_names(uuid) from public, anon;
grant execute on function app.member_display_names(uuid) to authenticated;
create function public.member_display_names(p_organization_id uuid)
returns table(membership_id uuid, display_name text)
language sql stable security invoker set search_path = '' as $fn$
  select * from app.member_display_names(p_organization_id);
$fn$;
revoke all on function public.member_display_names(uuid) from public, anon;
grant execute on function public.member_display_names(uuid) to authenticated;

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
  v_display     text := btrim(coalesce(p_display_name, ''));
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

  if not exists (select 1 from auth.users where id = v_actor and email_confirmed_at is not null) then
    raise exception 'verify your email before accepting an invitation' using errcode = '42501';
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
