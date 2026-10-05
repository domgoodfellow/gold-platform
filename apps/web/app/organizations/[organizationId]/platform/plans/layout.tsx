import { requirePlatformArea } from '@/lib/route/platform';

/** Serves this part of the platform only to an operator whose `platform_staff` row names `platform.commercial`. */
export default async function PlatformPlansLayout({ params, children }: LayoutProps<'/organizations/[organizationId]/platform/plans'>) {
  const { organizationId } = await params;
  await requirePlatformArea(organizationId, 'platform.commercial');
  return children;
}
