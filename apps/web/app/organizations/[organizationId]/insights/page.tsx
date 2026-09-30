import { Lock } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@gold/ui/components/alert';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { EmptyState } from '@/components/surfaces/section';
import {
  DashboardManagement,
  DashboardNavigation,
  DashboardView,
  InsightsViewNav,
} from '@/features/reporting/report-view';
import { listDashboards, readDashboard } from '@/lib/domain/reporting/dashboards';
import { listReportDefinitions } from '@/lib/domain/reporting/definitions';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { areaLabel } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * Insights' overview: the business's own saved dashboards. The platform seeds none — which numbers
 * a business watches is its configuration — so a business with none sees that plainly and the
 * Reports view. Workspace-local figures live in their workspaces; this is the cross-workspace one.
 */
export default async function InsightsPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/insights'>) {
  const { organizationId } = await params;
  const { dashboard } = await searchParams;
  const { db, organization } = await requireOrganization(organizationId);

  if (!organization.capabilities.includes('report.read')) {
    return (
      <AppPage>
        <PageHeader title={areaLabel('insights')} description="Saved dashboards and reports across this business." />
        <Alert className="mt-8">
          <Lock aria-hidden />
          <AlertTitle>Your role, {organization.role}, cannot see this business&apos;s figures</AlertTitle>
          <AlertDescription>
            Reading a total is a different thing from reading the rows behind it — anybody here
            can open one invoice on the job it belongs to, and a dashboard adds a year of them up.
          </AlertDescription>
        </Alert>
      </AppPage>
    );
  }

  const mayManage = organization.capabilities.includes('report.manage');
  const today = todayInZone(organization.timezone);
  const [dashboards, definitions] = await Promise.all([
    listDashboards(db, { organizationId }),
    listReportDefinitions(db, { organizationId }),
  ]);
  const requested = typeof dashboard === 'string' ? dashboard : null;
  const open = dashboards.find((entry) => entry.id === requested) ?? dashboards[0] ?? null;
  const tiles = open ? await readDashboard(db, { organizationId, dashboardId: open.id, today }) : [];

  const pinnedByDashboard = new Map<string, string[]>();
  if (mayManage && dashboards.length > 0) {
    const { data: pins } = await db
      .from('dashboard_reports')
      .select('dashboard_id, report_id')
      .eq('organization_id', organizationId);

    for (const pin of pins ?? []) {
      pinnedByDashboard.set(pin.dashboard_id, [...(pinnedByDashboard.get(pin.dashboard_id) ?? []), pin.report_id]);
    }
  }

  return (
    <AppPage>
      <PageHeader
        title={areaLabel('insights')}
        description={
          open ? (
            <>{open.name} · figures worked out now, in {organization.timezone}.</>
          ) : (
            'Saved dashboards and reports across this business.'
          )
        }
      />
      <InsightsViewNav organizationId={organizationId} current="overview" />
      <DashboardNavigation organizationId={organizationId} dashboards={dashboards} openDashboardId={open?.id} />
      {open ? <DashboardView tiles={tiles} /> : <EmptyState className="mt-6">No dashboards have been built yet.</EmptyState>}
      <DashboardManagement
        organizationId={organizationId}
        definitions={definitions}
        dashboards={dashboards}
        pinnedByDashboard={pinnedByDashboard}
        mayManage={mayManage}
      />
    </AppPage>
  );
}
