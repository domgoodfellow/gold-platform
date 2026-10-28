import { notFound } from 'next/navigation';
import { requireOrganization } from '@/lib/route/organization';
import { loadWorkItemDetail } from '@/lib/application/work/work-item-detail';
import { WorkItemDetailScreen } from '@/features/work/work-item-detail-screen';
import { resolveWorkSection } from '@/features/work/work-record-sections';
import { todayInZone } from '@/lib/domain/scheduling/window';

export const dynamic = 'force-dynamic';

/** The Work record; `?section=` chooses its section, and the former `?tab=` links still resolve. */
export default async function WorkItemPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/work/[workItemId]'>) {
  const { organizationId, workItemId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const model = await loadWorkItemDetail(db, { organizationId, workItemId, capabilities: organization.capabilities, timeZone: organization.timezone });
  if (!model) notFound();
  const query = await searchParams;
  return <WorkItemDetailScreen organizationId={organizationId} organization={organization} model={model} section={resolveWorkSection(query)} today={todayInZone(organization.timezone)} />;
}
