import { OrganizationShell } from '@/features/shell/organization-shell';

/**
 * The operator shell for one business. Every organization page renders inside `OrganizationShell`,
 * Platform Administration (`platform/`, beneath GOLD's own organization) included; see it for what
 * the shell projects and why it is not the authorization boundary.
 */
export default async function OrganizationLayout({
  params,
  children,
}: LayoutProps<'/organizations/[organizationId]'>) {
  const { organizationId } = await params;
  return <OrganizationShell organizationId={organizationId}>{children}</OrganizationShell>;
}
