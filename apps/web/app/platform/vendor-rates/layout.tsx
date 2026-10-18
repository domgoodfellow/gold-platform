import { platformParams } from '@/lib/route/platform';
import { requirePlatformArea } from '@/lib/route/platform';

export default async function VendorRatesLayout({ params, children }: LayoutProps<'/platform/vendor-rates'>) {
  const { organizationId } = await platformParams(params);
  await requirePlatformArea(organizationId, 'platform.commercial');
  return children;
}
