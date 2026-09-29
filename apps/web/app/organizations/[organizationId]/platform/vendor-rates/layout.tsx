import { requirePlatformArea } from '@/lib/route/platform';

export default async function VendorRatesLayout({ params, children }: LayoutProps<'/organizations/[organizationId]/platform/vendor-rates'>) {
  const { organizationId } = await params;
  await requirePlatformArea(organizationId, 'platform.commercial');
  return children;
}
