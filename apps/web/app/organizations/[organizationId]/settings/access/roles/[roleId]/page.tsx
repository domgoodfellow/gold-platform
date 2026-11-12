import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/headers/page-header';
import { RoleEditor } from '@/features/team/role-editor';
import { teamViewHref } from '@/features/team/team-views';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { listMembers } from '@/lib/domain/tenancy/members';
import { listRoles } from '@/lib/domain/tenancy/roles';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * One role: its name, its permissions and who holds it. Visibility only: `update_role` and
 * `delete_role` are what require `role.manage`, and a role in another business is not found.
 */
export default async function RolePage({
  params,
}: PageProps<'/organizations/[organizationId]/settings/access/roles/[roleId]'>) {
  const { organizationId, roleId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  if (!organization.capabilities.includes('role.manage')) notFound();

  const [roles, members] = await Promise.all([
    listRoles(db, { organizationId }),
    listMembers(db, { organizationId }),
  ]);
  const role = roles.find((candidate) => candidate.id === roleId);
  if (!role) notFound();

  return (
    <SettingsPageFrame width="fluid">
      <PageHeader title={role.name} crumbs={[{ label: 'Roles & permissions', href: teamViewHref(organizationId, 'roles') }]} />
      <RoleEditor
        organizationId={organizationId}
        role={role}
        grantable={organization.capabilities}
        members={members.filter((member) => member.role.id === role.id).map((member) => member.displayName)}
      />
    </SettingsPageFrame>
  );
}
