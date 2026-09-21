import { requirePlatformArea } from '@/lib/route/platform';

/** Serves this part of the platform only to an operator whose `platform_staff` row names `platform.health`. */
export default async function PlatformAreaLayout({ children }: LayoutProps<'/platform/failures'>) {
  await requirePlatformArea('platform.health');
  return children;
}
