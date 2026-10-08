import { notFound } from 'next/navigation';
import { requireOrganization } from '@/lib/route/organization';
import { loadWorkItemDetail } from '@/lib/application/work/work-item-detail';
import { WorkItemDetailScreen } from '@/features/work/work-item-detail-screen';

export const dynamic = 'force-dynamic';

export default async function WorkItemPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/work/[workItemId]'>) {
  const { organizationId, workItemId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const model = await loadWorkItemDetail(db, { organizationId, workItemId, capabilities: organization.capabilities, timeZone: organization.timezone });
  if (!model) notFound();
  const query = await searchParams;
  return <WorkItemDetailScreen organizationId={organizationId} organization={organization} model={model} defaultTab={query.tab === 'financials' ? 'financials' : 'overview'} />;
}
