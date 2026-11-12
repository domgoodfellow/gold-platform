-- A role could be created, edited and reassigned but never removed, so a role made by mistake or
-- no longer wanted stayed in every role list for good. This adds the one removal that is safe: a
-- role nobody holds and nobody has been invited into.
--
-- A role in use is never deleted and nobody is moved off it silently: the caller reassigns its
-- members (and revokes or lets lapse its open invitations) first, then deletes. That also keeps
-- the last-manager invariant intact without a second check here, because a role with no members
-- cannot be the one role standing between a business and nobody being able to manage it.

create function public.delete_role(p_role_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
  v_name  text;
begin
  select r.organization_id, r.name
    into v_org, v_name
    from public.roles r
   where r.id = p_role_id
     for update;

  -- Not distinguished: a role that does not exist, one in another business, and one the caller
  -- may not manage all answer the same way, as `update_role` does.
  if v_org is null
     or v_org not in (select app.current_tenant_ids())
     or not app.has_capability(v_org, 'role.manage') then
    raise exception 'no such role, or you may not delete it'
      using errcode = '42501';
  end if;

  if exists (select 1 from public.memberships m where m.organization_id = v_org and m.role_id = p_role_id) then
    raise exception 'role is assigned to members'
      using errcode = '23503', detail = 'members';
  end if;

  if exists (
    select 1
      from public.organization_invitations i
     where i.organization_id = v_org
       and i.role_id = p_role_id
       and i.accepted_at is null
       and i.revoked_at is null
       and i.expires_at > now()
  ) then
    raise exception 'role is named on an open invitation'
      using errcode = '23503', detail = 'invitations';
  end if;

  -- Closed invitations (accepted, revoked or expired) still point at the role and would block the
  -- delete. They grant nothing any more, so they go with the role; the event below records it.
  delete from public.organization_invitations i
   where i.organization_id = v_org
     and i.role_id = p_role_id;

  -- Report audiences for this role are removed by their own `on delete cascade`.
  delete from public.roles r where r.id = p_role_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'role', p_role_id, 'role.deleted', jsonb_build_object('name', v_name));
end;
$fn$;

comment on function public.delete_role(uuid) is
  'Deletes a role that no member holds and no open invitation names. Requires role.manage. '
  'SECURITY DEFINER because authenticated has no delete grant on roles or invitations; the '
  'tenant and capability checks are made here instead.';

revoke all on function public.delete_role(uuid) from public, anon;
grant execute on function public.delete_role(uuid) to authenticated;
