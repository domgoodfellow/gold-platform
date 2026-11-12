import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/headers/page-header';
import { RoleEditor } from '@/features/team/role-editor';
import { teamViewHref } from '@/features/team/team-views';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { listRoleSuggestions } from '@/lib/domain/tenancy/role-suggestions';
import { listRoles } from '@/lib/domain/tenancy/roles';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/** A new role, on its own page. Visibility only: `create_role` is what requires `role.manage`. */
export default async function NewRolePage({
  params,
}: PageProps<'/organizations/[organizationId]/settings/access/roles/new'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  if (!organization.capabilities.includes('role.manage')) notFound();
  const roles = await listRoles(db, { organizationId });
  const suggestions = await listRoleSuggestions(db, { organizationId, existingRoleNames: roles.map((role) => role.name) });

  return (
    <SettingsPageFrame width="fluid">
      <PageHeader title="New role" crumbs={[{ label: 'Roles & permissions', href: teamViewHref(organizationId, 'roles') }]} />
      <RoleEditor organizationId={organizationId} grantable={organization.capabilities} suggestions={suggestions} />
    </SettingsPageFrame>
  );
}
