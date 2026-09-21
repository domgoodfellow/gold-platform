import { requirePlatformArea } from '@/lib/route/platform';

/** Serves this part of the platform only to an operator whose `platform_staff` row names `platform.commercial`. */
export default async function PlatformAreaLayout({ children }: LayoutProps<'/platform/billing'>) {
  await requirePlatformArea('platform.commercial');
  return children;
}
