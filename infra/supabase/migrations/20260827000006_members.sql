-- A second person can join an organization.
--
-- Until now `create_organization` was the only thing that wrote a `memberships` row and the
-- table had no insert policy, so every organization had exactly one member permanently. M1's
-- "each with its own users" was not untested -- it was impossible -- and roles and
-- capabilities have never been exercised in their real form, because every multi-member
-- scenario in the suite is one member reassigning their own role.
--
-- D19 constrains what this may invent. Adding a person is a `memberships` row against an
-- existing `auth.users` id. It is not an invitation system, not a profile, and not a link
-- between a person and a Resource.
--
-- No new capability. `role.manage` already governs what roles exist and who holds which one;
-- who is *in* the organization is the same administrative concern, and a capability with no
-- operation distinct from another is vocabulary nobody can act on differently. A business
-- that wants "may add staff but may not redefine roles" is asking for a split this one
-- business has not asked for yet.

-- ---------------------------------------------------------------------------
-- What this tenant calls this person
-- ---------------------------------------------------------------------------

-- D19 named the trigger for this exactly: "the first screen that must render an actor's
-- name", and predicted the answer would be a per-tenant name on `memberships` rather than a
-- global profile. That screen is the people list this migration makes possible, so the
-- prediction is now a column.
--
-- Per-tenant on purpose. It is what THIS organization calls this person, not who they are;
-- the same account can be "Sam" to one tenant and "S. Okafor, Contractor" to another, and
-- neither tenant learns anything about the other. Nothing here mirrors `auth.users`.
alter table public.memberships add column display_name text;

-- Existing rows predate the column. 'Member' rather than anything cleverer: a founder who
-- wants to be called something else can be, once an edit path exists, and inventing one now
-- would be a column nothing reads.
update public.memberships set display_name = 'Member' where display_name is null;

alter table public.memberships alter column display_name set not null;

alter table public.memberships
  add constraint memberships_display_name_length
  check (length(btrim(display_name)) between 1 and 120);

-- ---------------------------------------------------------------------------
-- The founder names themselves
-- ---------------------------------------------------------------------------

-- Dropped and recreated rather than replaced: adding a parameter changes the signature, and
-- CREATE OR REPLACE would leave the three-argument version behind as an overload.
drop function public.create_organization(text, text, text[]);

create function public.create_organization(
  p_name         text,
  p_role         text,
  p_capabilities text[],
  p_display_name text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
  v_role  uuid;
begin
  if v_actor is null then
    raise exception 'create_organization requires an authenticated caller'
      using errcode = '42501';
  end if;

  insert into public.organizations (name, created_by)
  values (p_name, v_actor)
  returning id into v_org;

  insert into public.roles (organization_id, name, capabilities, created_by)
  values (v_org, p_role, p_capabilities, v_actor)
  returning id into v_role;

  insert into public.memberships
    (organization_id, user_id, role_id, display_name, created_by)
  values (v_org, v_actor, v_role, p_display_name, v_actor);

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'organization', v_org, 'organization.created',
     jsonb_build_object('name', p_name, 'role', p_role));

  return v_org;
end;
$fn$;

revoke all on function public.create_organization(text, text, text[], text) from public;
grant execute on function public.create_organization(text, text, text[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- Adding a member
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER, and the only function here that genuinely needs to be. `auth.users` is
-- not readable by `authenticated`, deliberately, so resolving an address to an account
-- cannot happen under the caller's own rights.
--
-- That makes the capability check below load-bearing rather than decorative: DEFINER bypasses
-- RLS, so nothing else is standing between a caller and a `memberships` insert. A definer
-- function that forgets to re-assert the permission its policies would have applied is a hole
-- with a friendly name on it. This is why there is still no `memberships` insert policy --
-- there is no second path to guard.
--
-- KNOWN DISCLOSURE, recorded rather than discovered later: a caller holding `role.manage`
-- can learn whether an address has an account here, because "no account for that address"
-- has to be distinguishable from "added" for the screen to be usable at all. The blast
-- radius is one organization's administrators, and the alternative -- an invitation system
-- that emails a stranger -- is the thing D19 says this slice may not invent. Revisit when
-- invitations arrive.
create function public.add_member_by_email(
  p_organization_id uuid,
  p_email           text,
  p_display_name    text,
  p_role_id         uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_user  uuid;
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'add_member_by_email requires an authenticated caller'
      using errcode = '42501';
  end if;

  if not app.has_capability(p_organization_id, 'role.manage') then
    raise exception 'add_member_by_email requires role.manage'
      using errcode = '42501';
  end if;

  -- Normalised the same way identity normalises a sign-in address, so "Sam@X.com" finds the
  -- account registered as "sam@x.com" rather than reporting it absent.
  select u.id into v_user
    from auth.users u
   where lower(u.email) = lower(btrim(p_email))
   limit 1;

  if v_user is null then
    raise exception 'no account for that address'
      using errcode = 'P0002';
  end if;

  -- The composite foreign key memberships_role_same_org is what refuses a role belonging to
  -- another organization. Nothing here checks it, because nothing here needs to (I18).
  insert into public.memberships
    (organization_id, user_id, role_id, display_name, created_by)
  values (p_organization_id, v_user, p_role_id, p_display_name, v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'membership', v_id, 'membership.created',
     jsonb_build_object('display_name', p_display_name, 'role_id', p_role_id));

  return v_id;
end;
$fn$;

revoke all on function public.add_member_by_email(uuid, text, text, uuid) from public;
grant execute on function public.add_member_by_email(uuid, text, text, uuid) to authenticated;
