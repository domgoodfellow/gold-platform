import { redirect } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { KpiCard, type Kpi } from '@/components/surfaces/kpi-card';
import { PageHeader } from '@/components/headers/page-header';
import { EmptyState } from '@/components/surfaces/section';
import { requireOrganization } from '@/lib/route/organization';
import { listAutomationRules, listAutomationRuns } from '@/lib/domain/automation/rules';
import { listMessageDeliveries } from '@/lib/domain/automation/templates';
import { areaHref, areaLabel, workspaceLabel } from '@/lib/navigation';
import { resolveAutomationsView } from '@/features/automations/workspace/views';

export const dynamic = 'force-dynamic';

/**
 * Automations Home: Rules, Messages and Activity, the workspace's three pages. Every figure is a
 * count some domain read already owns, one per page, and each links to it — nothing is totalled
 * here.
 *
 * The old `?view=messages` and `?view=activity` addresses still resolve, to the pages that
 * replaced them, so a bookmark or an email link is not a dead end.
 */
export default async function AutomationsPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/automations'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const view = resolveAutomationsView(Array.isArray(query.view) ? query.view[0] : query.view);
  if (view === 'messages') redirect(areaHref(organizationId, 'automation-messages'));
  if (view === 'activity') redirect(areaHref(organizationId, 'automation-activity'));

  const { db } = await requireOrganization(organizationId);

  const [rules, runs, deliveries] = await Promise.all([
    listAutomationRules(db, { organizationId }),
    listAutomationRuns(db, { organizationId, limit: 50 }),
    listMessageDeliveries(db, { organizationId, limit: 50 }),
  ]);

  const href = (segment: string) => areaHref(organizationId, segment);
  const kpis: Kpi[] = [
    { key: 'rules', label: areaLabel('automation-rules'), value: rules.length, href: href('automation-rules') },
    { key: 'messages', label: areaLabel('automation-messages'), value: deliveries.length, note: 'recent', href: href('automation-messages') },
    { key: 'activity', label: areaLabel('automation-activity'), value: runs.length, note: 'recent runs', href: href('automation-activity') },
  ];

  const empty = kpis.every((kpi) => kpi.value === 0);

  return (
    <AppPage>
      <PageHeader
        title={workspaceLabel('automations')}
        description="Rules this business writes: when something happens, if a job looks a certain way, do this."
      />
      {empty ? (
        <EmptyState>Nothing has been recorded in Automations yet.</EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.key} kpi={kpi} />
          ))}
        </div>
      )}
    </AppPage>
  );
}
