import { Hint } from '@/components/controls/inputs';
import { PageHeader } from '@/components/headers/page-header';
import { ViewNav } from '@/components/navigation/view-nav';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { listInvitationDeliveryStatus, listPendingInvitations } from '@/lib/domain/tenancy/invitations';
import { listMembers } from '@/lib/domain/tenancy/members';
import { listRoles } from '@/lib/domain/tenancy/roles';
import { requireOrganization } from '@/lib/route/organization';
import { settingsLandingHref, settingsScopeHref } from '@/lib/route/settings';
import { AddMemberSheetProvider, AddMemberTrigger } from '@/features/team/add-member-sheet';
import { CreateRoleSheet } from '@/features/team/create-role-sheet';
import { InvitationsTable } from '@/features/team/invitations-table';
import { MembersTable } from '@/features/team/members-table';
import { RolesTable } from '@/features/team/roles-table';
import { teamViewHref, type TeamView } from '@/features/team/team-views';

export const dynamic = 'force-dynamic';

/**
 * The Team workspace. Who works here, and what each role may do — three URL-backed sibling
 * views (Members, Invitations, Roles) rather than one page stacking two inline invite forms and
 * a full capability checklist above a member table. Creating and inviting are each a bounded
 * Sheet; role capabilities are edited in `EditRoleSheet`/`CreateRoleSheet`, never expanded inline
 * in the collection.
 */
type OrganizationAccess = Awaited<ReturnType<typeof requireOrganization>>;

export async function AccessPage({
  organizationId,
  view,
  context,
}: {
  organizationId: string;
  view: TeamView;
  context: OrganizationAccess;
}) {
  const { db, organization } = context;
  const mayManage = organization.capabilities.includes('role.manage');

  const [roles, members, invitations, deliveryStatus] = await Promise.all([
    listRoles(db, { organizationId }),
    listMembers(db, { organizationId }),
    listPendingInvitations(db, { organizationId }),
    listInvitationDeliveryStatus(db, { organizationId }),
  ]);

  return (
    <SettingsPageFrame>
      <AddMemberSheetProvider organizationId={organizationId} roles={roles}>
      <PageHeader
        title={view === 'members' ? 'Members' : view === 'invitations' ? 'Invitations' : 'Roles'}
        crumbs={[
          { label: 'Settings', href: settingsLandingHref(organizationId) },
          { label: 'Access', href: settingsScopeHref('access', organizationId) },
        ]}
        actions={
          mayManage ? (
            view === 'roles' ? <CreateRoleSheet organizationId={organizationId} /> : <AddMemberTrigger />
          ) : null
        }
      />
      <ViewNav
        label="Access views"
        current={view}
        views={[
          { key: 'members', label: 'Members', href: teamViewHref(organizationId, 'members') },
          {
            key: 'invitations',
            label: `Invitations${invitations.length ? ` (${invitations.length})` : ''}`,
            href: teamViewHref(organizationId, 'invitations'),
          },
          { key: 'roles', label: 'Roles', href: teamViewHref(organizationId, 'roles') },
        ]}
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
          />
        </div>
      ) : null}

      {view === 'roles' ? (
        <div className="mt-4">
          {!mayManage ? (
            <Hint className="mb-3">Your role, {organization.role}, cannot manage roles here.</Hint>
          ) : null}
          <RolesTable
            organizationId={organizationId}
            roles={roles}
            mayManage={mayManage}
          />
        </div>
      ) : null}
      </AddMemberSheetProvider>
    </SettingsPageFrame>
  );
}
