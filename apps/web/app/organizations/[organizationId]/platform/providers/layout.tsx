import { requirePlatformArea } from '@/lib/route/platform';

/** Serves this part of the platform only to an operator whose `platform_staff` row names `platform.providers`. */
export default async function PlatformAreaLayout({ params, children }: LayoutProps<'/organizations/[organizationId]/platform/providers'>) {
  const { organizationId } = await params;
  await requirePlatformArea(organizationId, 'platform.providers');
  return children;
}
