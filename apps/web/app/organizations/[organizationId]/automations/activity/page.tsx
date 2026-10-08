import { PageHeader } from '@/components/headers/page-header';
import { requireOrganization } from '@/lib/route/organization';
import { listAutomationRuns } from '@/lib/domain/automation/rules';
import { listMessageDeliveries } from '@/lib/domain/automation/templates';
import { automationPeriod } from '@/lib/application/automations/dashboard';
import { workspaceAncestry } from '@/lib/navigation';
import { ActivityView } from '@/features/automations/activity/activity-view';
import { presentAutomationRuleIds } from '@/lib/domain/automation/monitoring';

export const dynamic = 'force-dynamic';
export default async function AutomationActivityPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/automations/activity'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const first = (key: string) => {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const { db, organization } = await requireOrganization(organizationId);
  const period = automationPeriod(organization.timezone, first('when'));
  const filters = {
    when: first('when') === 'all' ? 'all' : period.when,
    q: (first('q') ?? '').slice(0, 100),
    stream: first('stream') === 'deliveries' ? 'deliveries' : 'runs',
    outcome: first('outcome') ?? '',
    state: first('state') ?? '',
    rule: first('rule') ?? '',
    page: Math.min(10000, Math.max(1, Math.floor(Number(first('page')) || 1))),
  };
  const scope = {
    organizationId,
    ...(filters.when === 'all'
      ? {}
      : { since: period.since, until: period.until }),
    offset: (filters.page - 1) * 50,
    limit: 51,
    search: filters.q,
  };
  const [runs, deliveries, selectedRuns, selectedDeliveries] =
    await Promise.all([
      filters.stream === 'runs'
        ? listAutomationRuns(db, {
            ...scope,
            ruleId: filters.rule || undefined,
            failedOnly: filters.outcome === 'failed',
            outcome: filters.outcome,
          })
        : [],
      filters.stream === 'deliveries'
        ? listMessageDeliveries(db, { ...scope, state: filters.state })
        : [],
      first('run')
        ? listAutomationRuns(db, { organizationId, id: first('run'), limit: 1 })
        : [],
      first('delivery')
        ? listMessageDeliveries(db, {
            organizationId,
            id: first('delivery'),
            limit: 1,
          })
        : [],
    ]);
  const presentRuleIds = await presentAutomationRuleIds(db, {
    organizationId,
    ids: [...new Set([filters.rule, selectedRuns[0]?.ruleId].filter((id): id is string => !!id))],
  });
  return (
    <>
      <PageHeader
        title="Run history & deliveries"
        crumbs={workspaceAncestry(organizationId, 'automation-activity')}
      />
      <ActivityView
        organizationId={organizationId}
        timezone={organization.timezone}
        runs={runs.slice(0, 50)}
        deliveries={deliveries.slice(0, 50)}
        selectedRun={selectedRuns[0]}
        selectedDelivery={selectedDeliveries[0]}
        filters={filters}
        presentRuleIds={presentRuleIds}
        next={runs.length > 50 || deliveries.length > 50}
      />
    </>
  );
}
