-- Renewing an invitation hands out its role again, even when role_id is unchanged.
-- Keep revocation available regardless of the permissions in that role.
drop trigger organization_invitations_grant_guard on public.organization_invitations;
create trigger organization_invitations_grant_guard
  before insert or update of role_id, token_hash on public.organization_invitations
  for each row execute function app.check_role_assignment_grant();
