import { Hint } from '@/components/controls/inputs';
import { listPendingInvitations } from '@/lib/domain/tenancy/invitations';
import { listMembers } from '@/lib/domain/tenancy/members';
import { listRoles } from '@/lib/domain/tenancy/roles';
import { requireOrganization } from '@/lib/route/organization';
import { AddMemberSheetProvider, AddMemberTrigger } from './add-member-sheet';
import { CreateRoleSheet } from './create-role-sheet';
import { InvitationsTable } from './invitations-table';
import { MembersTable } from './members-table';
import { RolesTable } from './roles-table';
import { resolveTeamView } from './team-views';
import { TeamViewTabs } from './team-view-tabs';

export const dynamic = 'force-dynamic';

/**
 * The Team workspace. Who works here, and what each role may do — three URL-backed sibling
 * views (Members, Invitations, Roles) rather than one page stacking two inline invite forms and
 * a full capability checklist above a member table. Creating and inviting are each a bounded
 * Sheet; role capabilities are edited in `EditRoleSheet`/`CreateRoleSheet`, never expanded inline
 * in the collection.
 */
export default async function RolesPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/roles'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const rawView = Array.isArray(query.view) ? query.view[0] : query.view;
  const view = resolveTeamView(rawView);

  const { db, organization } = await requireOrganization(organizationId);
  const mayManage = organization.capabilities.includes('role.manage');

  const [roles, members, invitations] = await Promise.all([
    listRoles(db, { organizationId }),
    listMembers(db, { organizationId }),
    listPendingInvitations(db, { organizationId }),
  ]);

  return (
    <AddMemberSheetProvider organizationId={organizationId} roles={roles}>
      <Hint>Who works here, and what each role may do.</Hint>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <TeamViewTabs view={view} invitationCount={invitations.length} />
        {mayManage ? (
          view === 'roles' ? <CreateRoleSheet organizationId={organizationId} /> : <AddMemberTrigger />
        ) : null}
      </div>

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
            emptyAction={mayManage ? <AddMemberTrigger /> : undefined}
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
            mayManage={mayManage}
            emptyAction={mayManage ? <AddMemberTrigger /> : undefined}
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
            emptyAction={mayManage ? <CreateRoleSheet organizationId={organizationId} /> : undefined}
          />
        </div>
      ) : null}
    </AddMemberSheetProvider>
  );
}
