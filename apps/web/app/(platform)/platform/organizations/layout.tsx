import { requirePlatformArea } from '@/lib/route/platform';

/** Serves this part of the platform only to an operator whose `platform_staff` row names `platform.organizations`. */
export default async function PlatformAreaLayout({ children }: LayoutProps<'/platform/organizations'>) {
  await requirePlatformArea('platform.organizations');
  return children;
}
