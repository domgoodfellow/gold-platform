import { requireOrganization } from '@/lib/route/organization';
import { MarketingPage } from '@/lib/application/marketing/page';
export default async function Page({ params, searchParams }: { params: Promise<{ organizationId: string; campaignId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { organizationId, campaignId } = await params;
  await requireOrganization(organizationId);
  return <MarketingPage organizationId={organizationId} campaignId={campaignId} view="detail" query={await searchParams} />;
}
