import { Badge } from '@/components/display/data';
import { Disclosure } from '@/components/containers/card';
import { Hint } from '@/components/controls/inputs';
import { SectionHeading } from '@/components/containers/section';
import { DataTable } from '@/components/display/table';
import { CAPABILITY_LABELS } from '@/lib/domain/tenancy/capabilities';
import { listMembers } from '@/lib/domain/tenancy/members';
import { listRoles } from '@/lib/domain/tenancy/roles';
import { requireOrganization } from '@/lib/route/organization';
import { AddMemberForm } from './add-member-form';
import { CreateRoleForm } from './create-role-form';

export const dynamic = 'force-dynamic';

export default async function RolesPage({
  params,
}: PageProps<'/organizations/[organizationId]/roles'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const [roles, members] = await Promise.all([
    listRoles(db, { organizationId }),
    listMembers(db, { organizationId }),
  ]);
  const mayManage = organization.capabilities.includes('role.manage');

  return (
    <>
      <section className="mt-8">
        <SectionHeading>People</SectionHeading>

        {mayManage ? (
          <Disclosure summary="Add somebody" defaultOpen={members.length <= 1} className="mt-2">
            <AddMemberForm organizationId={organizationId} roles={roles} />
          </Disclosure>
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
