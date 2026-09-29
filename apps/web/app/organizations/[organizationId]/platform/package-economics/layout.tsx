import { requirePlatformArea } from '@/lib/route/platform';

export default async function PackageEconomicsLayout({ params, children }: LayoutProps<'/organizations/[organizationId]/platform/package-economics'>) {
  const { organizationId } = await params;
  await requirePlatformArea(organizationId, 'platform.commercial');
  return children;
}
