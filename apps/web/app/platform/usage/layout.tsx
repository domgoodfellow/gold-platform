import { platformParams } from '@/lib/route/platform';
import { requirePlatformArea } from '@/lib/route/platform';

export default async function UsageEconomicsLayout({ params, children }: LayoutProps<'/platform/usage'>) {
  const { organizationId } = await platformParams(params);
  await requirePlatformArea(organizationId, 'platform.commercial');
  return children;
}
