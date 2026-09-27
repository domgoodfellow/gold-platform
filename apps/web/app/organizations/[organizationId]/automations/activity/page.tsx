import { PageHeader } from '@/components/containers/page-header';
import { requireOrganization } from '@/lib/route/organization';
import { listAutomationRuns } from '@/lib/domain/automation/rules';
import { listMessageDeliveries } from '@/lib/domain/automation/templates';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { ActivityView } from '@/features/automations/activity/activity-view';

export const dynamic = 'force-dynamic';

/** Activity, a page of the Automations workspace: what ran and what was sent, most recent first. */
export default async function AutomationActivityPage({
  params,
}: PageProps<'/organizations/[organizationId]/automations/activity'>) {
  const { organizationId } = await params;
  const { db } = await requireOrganization(organizationId);

  const [runs, deliveries] = await Promise.all([
    listAutomationRuns(db, { organizationId, limit: 50 }),
    listMessageDeliveries(db, { organizationId, limit: 50 }),
  ]);

  return (
    <>
      <PageHeader title={areaLabel('automation-activity')} crumbs={workspaceAncestry('automation-activity')} />
      <ActivityView runs={runs} deliveries={deliveries} />
    </>
  );
}
