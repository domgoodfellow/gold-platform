import { requirePlatformScope } from '@/lib/route/platform';

/**
 * Administration is a context of GildOps' own organization, drawn by the organization shell
 * around it like every workspace. This layout only guards the scope; each area guards its own
 * permission again.
 */
export default async function AdministrationLayout({ params, children }: LayoutProps<'/organizations/[organizationId]/administration'>) {
  const { organizationId } = await params;
  await requirePlatformScope(organizationId);
  return children;
}
