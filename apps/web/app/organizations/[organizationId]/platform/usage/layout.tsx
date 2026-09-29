import { requirePlatformArea } from '@/lib/route/platform';

export default async function UsageEconomicsLayout({ params, children }: LayoutProps<'/organizations/[organizationId]/platform/usage'>) {
  const { organizationId } = await params;
  await requirePlatformArea(organizationId, 'platform.commercial');
  return children;
}
