-- Roles could be created and reassigned but never edited — a name typed wrong or a capability
-- set that needed one more line meant creating a second role and reassigning every member off
-- the first. This closes that gap the same way every other narrow write in this schema closes
-- one: a grant on the two columns that may change, an RLS policy requiring the capability, and
-- the one invariant `assign_role` already enforces at assignment time, now enforced at edit time
-- too — an organization must always retain someone who can manage roles.

-- ---------------------------------------------------------------------------
-- The grant and the policy
-- ---------------------------------------------------------------------------

-- Only `name` and `capabilities` — never `organization_id` (I2's tenant column is not somewhere
-- a row moves) and never `created_by`/`created_at` (who made the row and when is not an edit).
grant update (name, capabilities) on public.roles to authenticated;

create policy roles_update on public.roles
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'role.manage')
  )
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'role.manage')
  );

-- ---------------------------------------------------------------------------
-- The invariant, at edit time
-- ---------------------------------------------------------------------------

-- The same question `assign_role` asks before it lets a reassignment through, asked here before
-- an edit is allowed to land: after this write, does some membership in the organization still
-- resolve to a role holding `role.manage`? The `case` substitutes the row's *new* capabilities
-- for itself and every other role's capabilities as already stored, so a role with no members at
-- all can lose the capability freely, and the one role standing between an organization and
-- nobody being able to manage it cannot.
create function app.check_role_capabilities_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not exists (
    select 1
      from public.memberships m
      join public.roles r on r.id = m.role_id
     where m.organization_id = new.organization_id
       and 'role.manage' = any (case when r.id = new.id then new.capabilities else r.capabilities end)
  ) then
    raise exception 'that would leave the organization with nobody who can manage roles'
      using errcode = '23514';
  end if;

  return new;
end;
$fn$;

comment on function app.check_role_capabilities_update() is
  'The same invariant public.assign_role checks before a reassignment, checked here before an '
  'edit to a role''s own capabilities lands. SECURITY DEFINER for the same reason app.has_capability '
  'is: the trigger must see every membership and role in the organization regardless of the '
  'caller''s own RLS-visible rows.';

create trigger roles_capabilities_update_guard
  before update of capabilities on public.roles
  for each row
  when (old.capabilities is distinct from new.capabilities)
  execute function app.check_role_capabilities_update();

-- ---------------------------------------------------------------------------
-- update_role
-- ---------------------------------------------------------------------------

-- SECURITY INVOKER, mirroring create_role: the caller is already a member, and `roles_update`
-- decides whether this write is allowed. Name length and the known-capability list are both
-- still the table's own constraints — this function adds nothing beyond the transaction boundary
-- and the event.
create function public.update_role(
  p_role_id      uuid,
  p_name         text,
  p_capabilities text[]
)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
begin
  update public.roles
     set name = p_name,
         capabilities = p_capabilities
   where id = p_role_id
  returning organization_id into v_org;

  -- Null means the row was invisible or the update was refused — RLS or the trigger above.
  -- Not distinguished from each other, the same way `assign_role` does not distinguish "no
  -- such membership" from "not yours to change".
  if v_org is null then
    raise exception 'no such role, or you may not change it'
      using errcode = '42501';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'role', p_role_id, 'role.updated',
     jsonb_build_object('name', p_name, 'capabilities', p_capabilities));
end;
$fn$;

revoke all on function public.update_role(uuid, text, text[]) from public;
grant execute on function public.update_role(uuid, text, text[]) to authenticated;
