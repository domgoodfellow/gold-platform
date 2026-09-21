import { requirePlatformArea } from '@/lib/route/platform';

/** Serves this part of the platform only to an operator whose `platform_staff` row names `platform.organizations`. */
export default async function PlatformAreaLayout({ params, children }: LayoutProps<'/organizations/[organizationId]/platform/organizations'>) {
  const { organizationId } = await params;
  await requirePlatformArea(organizationId, 'platform.organizations');
  return children;
}
