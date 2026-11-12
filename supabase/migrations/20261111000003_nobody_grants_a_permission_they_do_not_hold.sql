-- `role.manage` let its holder give any permission at all: add `billing.manage` to their own
-- role, or move themselves onto Admin. Managing roles was therefore every permission in practice.
-- This closes that: a member can only hand out what they hold themselves.
--
-- The rule, in one place (`app.assert_may_grant`), asked wherever a permission can reach a person:
--   * a role gaining permissions (created, or edited to add some);
--   * a person being put on a role (added, or reassigned);
--   * an invitation naming a role.
-- Taking permissions away is never refused here, and neither is renaming a role.
--
-- It binds members who manage roles, acting inside their own business. It does not bind a write with no signed-in
-- person (migrations, the server's own jobs) or a person who is not yet a member of the business:
-- founding a business, accepting an invitation and platform provisioning all write a first role or
-- membership for someone who holds nothing yet, and each of those paths is already decided by its
-- own SECURITY DEFINER function. A non-member has no other way to reach these tables.

create function app.assert_may_grant(p_organization_id uuid, p_capabilities text[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_held  text[];
begin
  if v_actor is null then
    return;
  end if;

  select r.capabilities
    into v_held
    from public.memberships m
    join public.roles r on r.id = m.role_id
   where m.user_id = v_actor
     and m.organization_id = p_organization_id;

  -- Not a member, or a member who cannot manage roles at all: this rule has nothing to add. The
  -- table policies and each function's own check refuse the second, with their own message.
  if not found or not ('role.manage' = any (v_held)) then
    return;
  end if;

  if not (coalesce(p_capabilities, '{}') <@ v_held) then
    raise exception 'you can only give permissions you hold yourself'
      using errcode = '42501', detail = 'grant_beyond_own';
  end if;
end;
$fn$;

comment on function app.assert_may_grant(uuid, text[]) is
  'Refuses (42501, detail grant_beyond_own) when the signed-in role manager of the organization does '
  'not hold every listed capability. No-op with no signed-in person, for a non-member, and for a '
  'member without role.manage (refused elsewhere); see the migration that created it for why.';

revoke all on function app.assert_may_grant(uuid, text[]) from public, anon;

-- A role gaining permissions.
create function app.check_role_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT' then
    perform app.assert_may_grant(new.organization_id, new.capabilities);
  else
    perform app.assert_may_grant(
      new.organization_id,
      array(select unnest(new.capabilities) except select unnest(old.capabilities))
    );
  end if;
  return new;
end;
$fn$;

create trigger roles_grant_guard
  before insert or update of capabilities on public.roles
  for each row execute function app.check_role_grant();

-- A person being put on a role, or an invitation naming one.
create function app.check_role_assignment_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_capabilities text[];
begin
  select r.capabilities into v_capabilities
    from public.roles r
   where r.id = new.role_id and r.organization_id = new.organization_id;
  perform app.assert_may_grant(new.organization_id, v_capabilities);
  return new;
end;
$fn$;

create trigger memberships_grant_guard
  before insert or update of role_id on public.memberships
  for each row execute function app.check_role_assignment_grant();

create trigger organization_invitations_grant_guard
  before insert or update of role_id on public.organization_invitations
  for each row execute function app.check_role_assignment_grant();
