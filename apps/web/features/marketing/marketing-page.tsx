import { notFound } from 'next/navigation';
import { requireOrganization } from '@/lib/route/organization';
import { readMarketing } from '@/lib/domain/marketing/marketing';
import { MarketingWorkspace } from '@/features/marketing/workspace';
import { getManagedHostname } from '@/lib/domain/domains/domains';

export async function MarketingPage({ organizationId, view, query, campaignId }: { organizationId: string; view: 'home' | 'campaigns' | 'audiences' | 'leads' | 'performance' | 'detail'; query: Record<string, string | string[] | undefined>; campaignId?: string }) {
  const { db, organization } = await requireOrganization(organizationId);
  if (!organization.capabilities.some(c => c === 'marketing.read' || c === 'marketing.manage')) notFound();
  const filters = Object.fromEntries(Object.entries(query).filter((entry): entry is [string,string] => typeof entry[1] === 'string'));
  if (campaignId) filters.campaign = campaignId;
  const [data, address] = await Promise.all([readMarketing(db, organizationId, view, filters), getManagedHostname(db, { slug: organization.slug })]);
  data.public_hostname = address.state === 'ready' ? address.hostname : null;
  if(campaignId && !data.campaigns.length) notFound();
  return <MarketingWorkspace organizationId={organizationId} timezone={organization.timezone} data={data} view={view} campaignId={campaignId} mayManage={organization.capabilities.includes('marketing.manage')} mayStudio={organization.capabilities.includes('organization.manage')} mayCreateCustomer={organization.capabilities.includes('customer.create')} />;
}
