-- Invitation revocation was one-way in this migration's own words and not in its grants.
--
-- `grant update (revoked_at) on organization_invitations to authenticated` plus an RLS
-- `with check` that only re-asserts organization membership and `role.manage` admits a caller
-- setting `revoked_at` to *anything*, including back to `null` after it was already set, or on a
-- row that was already accepted. The application only ever sends `revoked_at = now()`, so nothing
-- observable was wrong -- but the database was not actually the thing holding the invariant this
-- schema otherwise insists on holding in Postgres rather than in a client's good behaviour.
--
-- Corrected the way `app.check_status_transition` corrects an update no single-column grant can
-- express: the column grant is removed, and the only door is a function that performs exactly
-- one transition -- `revoked_at = now() where revoked_at is null and accepted_at is null` -- so a
-- revoked or already-accepted row cannot be touched again, and nothing can set the column back to
-- null at all, from any path.

drop policy organization_invitations_update on public.organization_invitations;
revoke update (revoked_at) on public.organization_invitations from authenticated;

create function public.revoke_invitation(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
begin
  if v_actor is null then
    raise exception 'revoke_invitation requires an authenticated caller'
      using errcode = '42501';
  end if;

  select organization_id into v_org
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
end;
$fn$;

comment on function public.revoke_invitation(uuid) is
  'The only way to revoke an invitation: revoked_at moves from null to now() and never back, and never on a row already accepted. security definer because the column grant that used to let this happen is gone -- the check that org.role.manage is required is now here instead of in RLS.';

revoke all on function public.revoke_invitation(uuid) from public;
grant execute on function public.revoke_invitation(uuid) to authenticated;
