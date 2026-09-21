import { requirePlatformArea } from '@/lib/route/platform';

/** Serves this part of the platform only to an operator whose `platform_staff` row names `platform.catalogue`. */
export default async function PlatformAreaLayout({ children }: LayoutProps<'/platform/integrations'>) {
  await requirePlatformArea('platform.catalogue');
  return children;
}
