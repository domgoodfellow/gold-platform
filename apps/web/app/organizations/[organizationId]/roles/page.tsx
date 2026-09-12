import { Badge } from '@/components/display/data';
import { Disclosure } from '@/components/containers/card';
import { Hint } from '@/components/controls/inputs';
import { SectionHeading } from '@/components/containers/section';
import { DataTable } from '@/components/display/table';
import { CAPABILITY_LABELS } from '@/lib/domain/tenancy/capabilities';
import { listPendingInvitations } from '@/lib/domain/tenancy/invitations';
import { listMembers } from '@/lib/domain/tenancy/members';
import { listRoles } from '@/lib/domain/tenancy/roles';
import { requireOrganization } from '@/lib/route/organization';
import { AddMemberForm } from './add-member-form';
import { CreateRoleForm } from './create-role-form';
import { InviteMemberForm } from './invite-member-form';
import { PendingInvitations } from './pending-invitations';

export const dynamic = 'force-dynamic';

export default async function RolesPage({
  params,
}: PageProps<'/organizations/[organizationId]/roles'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const [roles, members, invitations] = await Promise.all([
    listRoles(db, { organizationId }),
    listMembers(db, { organizationId }),
    listPendingInvitations(db, { organizationId }),
  ]);
  const mayManage = organization.capabilities.includes('role.manage');

  return (
    <>
      <section className="mt-8">
        <SectionHeading>People</SectionHeading>

        {mayManage ? (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Disclosure summary="Add somebody" defaultOpen={members.length <= 1} className="flex-1">
                <AddMemberForm organizationId={organizationId} roles={roles} />
              </Disclosure>
              <Disclosure summary="Invite by email" className="flex-1">
                <InviteMemberForm organizationId={organizationId} roles={roles} />
              </Disclosure>
            </div>
            {invitations.length > 0 ? (
              <div className="mt-4">
                <Hint weight="subtle" className="mb-2">
                  Pending invitations
                </Hint>
                <PendingInvitations organizationId={organizationId} invitations={invitations} />
              </div>
            ) : null}
          </>
        ) : (
          <Hint className="mt-2">
            Your role, {organization.role}, cannot add people here.
          </Hint>
        )}

        <div className="mt-4">
          <DataTable
            rows={members}
            rowKey={(member) => member.id}
            empty="Nobody here yet."
            columns={[
              {
                key: 'name',
                header: 'Name',
                emphasis: 'primary',
                // The name this organization gave them. No email and no account detail,
                // because nothing here mirrors auth.users (D19).
                cell: (member) => member.displayName,
              },
              {
                key: 'role',
                header: 'Role',
                // A badge, and a neutral one: the tenant's own word for the job, and the
                // platform does not know whether *Dispatcher* outranks *Fitter* (§7).
                cell: (member) => <Badge>{member.role.name}</Badge>,
              },
            ]}
          />
        </div>
      </section>

      <section className="mt-10">
        <SectionHeading>Roles</SectionHeading>

        {/*
          Hiding the form is a courtesy, not the guard. `roles_insert` requires role.manage in
          the database, so a caller who reaches the action anyway is refused there
          (constraints.md: hiding a UI element is not authorization).
        */}
        {mayManage ? (
          <Disclosure summary="Add a role" className="mt-2">
            <CreateRoleForm organizationId={organizationId} />
          </Disclosure>
        ) : (
          <Hint className="mt-2">
            Your role, {organization.role}, cannot manage roles here.
          </Hint>
        )}

        <div className="mt-4">
          <DataTable
            rows={roles}
            rowKey={(role) => role.id}
            empty="No roles yet."
            columns={[
              { key: 'name', header: 'Role', emphasis: 'primary', cell: (role) => role.name },
              {
                key: 'capabilities',
                header: 'May do',
                cell: (role) =>
                  role.capabilities.length === 0 ? (
                    // Application state, not advice: this role can do nothing yet, which is a
                    // legitimate role and not a mistake to be corrected (§8).
                    <span className="text-subtle">Nothing yet</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {role.capabilities.map((capability) => (
                        <Badge key={capability}>{CAPABILITY_LABELS[capability]}</Badge>
                      ))}
                    </div>
                  ),
              },
            ]}
          />
        </div>
      </section>

    </>
  );
}
