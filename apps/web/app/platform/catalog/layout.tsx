import { platformParams } from '@/lib/route/platform';
import { requirePlatformArea } from '@/lib/route/platform';

/** Serves this part of the platform only to an operator whose `platform_staff` row names `platform.catalogue`. */
export default async function PlatformAreaLayout({ params, children }: LayoutProps<'/platform/catalog'>) {
  const { organizationId } = await platformParams(params);
  await requirePlatformArea(organizationId, 'platform.catalogue');
  return children;
}
