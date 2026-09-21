import { requirePlatformScope } from '@/lib/route/platform';

/**
 * Platform Administration is a privileged sub-scope of GOLD's own organization, so it is drawn by
 * the organization layout above this one — the same shell, the same GOLD identity in the switcher.
 * This layout is only the door: the requested organization must be GOLD's own, the caller a member
 * of it, and the caller must hold at least one platform permission (`requirePlatformScope`).
 *
 * A layout can be reused across client navigations and can render beside its page, so this is a
 * first refusal and not the boundary: each area's layout checks the one permission it takes
 * (`requirePlatformArea`), and every read below goes through a narrow door that checks
 * `platform_staff` itself. Nothing here filters platform data by this organization — the URL names
 * the context the operator is working in, not who owns the records.
 */
export default async function PlatformLayout({
  params,
  children,
}: LayoutProps<'/organizations/[organizationId]/platform'>) {
  const { organizationId } = await params;
  await requirePlatformScope(organizationId);
  return children;
}
