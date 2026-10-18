import { platformParams } from '@/lib/route/platform';
import { requirePlatformArea } from '@/lib/route/platform';

/** Serves this part of the platform only to an operator whose `platform_staff` row names `platform.providers`. */
export default async function PlatformAreaLayout({ params, children }: LayoutProps<'/platform/providers'>) {
  const { organizationId } = await platformParams(params);
  await requirePlatformArea(organizationId, 'platform.providers');
  return children;
}
