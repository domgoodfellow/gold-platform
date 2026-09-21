import { requirePlatformArea } from '@/lib/route/platform';

/** Serves this part of the platform only to an operator whose `platform_staff` row names `platform.providers`. */
export default async function PlatformAreaLayout({ children }: LayoutProps<'/platform/providers'>) {
  await requirePlatformArea('platform.providers');
  return children;
}
