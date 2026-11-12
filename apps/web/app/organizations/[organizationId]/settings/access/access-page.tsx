import { Hint } from '@/components/controls/inputs';
import { Plus } from 'lucide-react';
import { ButtonLink } from '@/components/controls/button';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-frame';
import { listInvitationDeliveryStatus, listPendingInvitations } from '@/lib/domain/tenancy/invitations';
import { listMembers } from '@/lib/domain/tenancy/members';
import { listRoles } from '@/lib/domain/tenancy/roles';
import { requireOrganization } from '@/lib/route/organization';
import { AddMemberDialogProvider, AddMemberTrigger } from '@/features/team/add-member-dialog';
import { InvitationsTable } from '@/features/team/invitations-table';
import { MembersTable } from '@/features/team/members-table';
import { RolesTable } from '@/features/team/roles-table';
import { teamViewHref, type TeamView } from '@/features/team/team-views';

export const dynamic = 'force-dynamic';

/**
 * Access: who works here and what each role may do. Members, Invitations and Roles & permissions
 * are three Settings destinations, each its own address in the sidebar, sharing this page's data
 * loading. Adding and inviting are a focused dialog; a role is created and edited on its own page.
 */
type OrganizationAccess = Awaited<ReturnType<typeof requireOrganization>>;

export async function AccessPage({
  organizationId,
  view,
  context,
  roleDeleted = false,
}: {
  organizationId: string;
  view: Exclude<TeamView, 'history'>;
  context: OrganizationAccess;
  roleDeleted?: boolean;
}) {
  const { db, organization } = context;
  const mayManage = organization.capabilities.includes('role.manage');

  const [roles, members, invitations, deliveryStatus] = await Promise.all([
    listRoles(db, { organizationId }),
    listMembers(db, { organizationId }),
    listPendingInvitations(db, { organizationId }),
    listInvitationDeliveryStatus(db, { organizationId }),
  ]);

  // A manager can only put people on a role whose permissions they hold; the database refuses the rest.
  const held = new Set<string>(organization.capabilities);
  const assignable = roles.filter((role) => role.capabilities.every((capability) => held.has(capability)));

  return (
    <SettingsPageFrame width="fluid">
      <AddMemberDialogProvider organizationId={organizationId} roles={assignable}>
      <SettingsPageHeader
        title={view === 'members' ? 'Members' : view === 'invitations' ? 'Invitations' : 'Roles & permissions'}
        actions={
          mayManage ? (
            view === 'roles' ? <ButtonLink tone="primary" href={`${teamViewHref(organizationId, 'roles')}/new`}><Plus aria-hidden className="size-4" /> New role</ButtonLink> : <AddMemberTrigger />
          ) : null
        }
      />
      {view === 'members' ? (
        <div className="mt-4">
          {!mayManage ? (
            <Hint className="mb-3">Your role, {organization.role}, cannot add people here.</Hint>
          ) : null}
          <MembersTable
            organizationId={organizationId}
            members={members}
            roles={roles}
            assignableRoleIds={new Set(assignable.map((role) => role.id))}
            mayManage={mayManage}
          />
        </div>
      ) : null}

      {view === 'invitations' ? (
        <div className="mt-4">
          {!mayManage ? (
            <Hint className="mb-3">Your role, {organization.role}, cannot invite people here.</Hint>
          ) : null}
          <InvitationsTable
            organizationId={organizationId}
            invitations={invitations}
            deliveryStatus={deliveryStatus}
            mayManage={mayManage}
            assignableRoleIds={new Set(assignable.map((role) => role.id))}
          />
        </div>
      ) : null}

      {view === 'roles' ? (
        <div className="mt-4">
          {!mayManage ? (
            <Hint className="mb-3">Your role, {organization.role}, cannot manage roles here.</Hint>
          ) : null}
          <RolesTable
            deleted={roleDeleted}
            organizationId={organizationId}
            roles={roles}
            memberCounts={new Map(roles.map((role) => [role.id, members.filter((member) => member.role.id === role.id).length]))}
            mayManage={mayManage}
          />
        </div>
      ) : null}
      </AddMemberDialogProvider>
    </SettingsPageFrame>
  );
}
