import { platformParams } from '@/lib/route/platform';
import { requirePlatformArea } from '@/lib/route/platform';

/** Serves this part of the platform only to an operator whose `platform_staff` row names `platform.health`. */
export default async function PlatformAreaLayout({ params, children }: LayoutProps<'/organizations/[organizationId]/administration/billing-deliveries'>) {
  const { organizationId } = await platformParams(params);
  await requirePlatformArea(organizationId, 'platform.health');
  return children;
}
