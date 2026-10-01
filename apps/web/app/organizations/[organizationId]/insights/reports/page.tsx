import { Lock } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@gold/ui/components/alert';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { Hint } from '@/components/controls/inputs';
import {
  InsightsViewNav,
  ReportFilters,
  ReportManagement,
  ReportNavigation,
  ReportResultView,
} from '@/features/reporting/report-view';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listLocations } from '@/lib/domain/locations/locations';
import { listTimeCommitted } from '@/lib/domain/reporting/commitment';
import { listWorkMarkedComplete } from '@/lib/domain/reporting/completion';
import {
  getReportDefinition,
  listReportDefinitions,
  listReportRoles,
} from '@/lib/domain/reporting/definitions';
import { listInvoicedAndIncurred } from '@/lib/domain/reporting/financials';
import {
  GROUPINGS_FOR,
  MEASURES,
  PERIODS,
  periodFor,
  type Filters,
  type Grouping,
  type Measure,
  type PeriodPreset,
} from '@/lib/domain/reporting/shape';
import { listResources } from '@/lib/domain/resources/resources';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { listRoles } from '@/lib/domain/tenancy/roles';
import { areaLabel } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/** Route authority and server composition. Presentation belongs to the reporting feature. */
export default async function ReportsPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/insights/reports'>) {
  const { organizationId } = await params;
  const { by, of: ofMeasure, period, customer, resource, location, report } =
    await searchParams;
  const { db, organization } = await requireOrganization(organizationId);
  const one = (value: string | string[] | undefined) =>
    typeof value === 'string' && value.length > 0 ? value : null;

  if (!organization.capabilities.includes('report.read')) {
    return (
      <AppPage>
        <PageHeader title={areaLabel('insights')} />
        <Alert className="mt-8">
          <Lock aria-hidden />
          <AlertTitle>Your role, {organization.role}, cannot see this business&apos;s figures</AlertTitle>
          <AlertDescription>
            Reading a total is a different thing from reading the rows behind it — anybody here
            can open one invoice on the job it belongs to, and this page adds a year of them up.
          </AlertDescription>
        </Alert>
      </AppPage>
    );
  }

  const savedId = one(report);
  const saved = savedId ? await getReportDefinition(db, { organizationId, id: savedId }) : null;
  const measure: Measure =
    saved?.measure ??
    (typeof ofMeasure === 'string' && (MEASURES as readonly string[]).includes(ofMeasure)
      ? (ofMeasure as Measure)
      : 'invoiced_and_incurred');
  const answerable = GROUPINGS_FOR[measure];
  const grouping: Grouping =
    saved?.grouping ??
    (typeof by === 'string' && (answerable as readonly string[]).includes(by)
      ? (by as Grouping)
      : answerable[0]);
  const preset: PeriodPreset =
    saved?.period ??
    (typeof period === 'string' && (PERIODS as readonly string[]).includes(period)
      ? (period as PeriodPreset)
      : 'year');
  const filters: Filters = saved?.filters ?? {
    customerId: one(customer),
    resourceId: one(resource),
    locationId: one(location),
  };
  const mayManage = organization.capabilities.includes('report.manage');
  const today = todayInZone(organization.timezone);
  const args = { organizationId, grouping, period: periodFor(preset, today), filters };

  const [result, customers, resources, locations, definitions, roles] =
    await Promise.all([
      measure === 'work_marked_complete'
        ? listWorkMarkedComplete(db, args).then((groups) => ({ measure, groups }) as const)
        : measure === 'time_committed'
          ? listTimeCommitted(db, args).then((groups) => ({ measure, groups }) as const)
          : listInvoicedAndIncurred(db, args).then(
              (groups) => ({ measure: 'invoiced_and_incurred' as const, groups }),
            ),
      listCustomers(db, { organizationId }),
      listResources(db, { organizationId }),
      listLocations(db, { organizationId }),
      listReportDefinitions(db, { organizationId }),
      mayManage ? listRoles(db, { organizationId }) : Promise.resolve([]),
    ]);

  const shared = mayManage
    ? await Promise.all(
        definitions.map(async (definition) => ({
          id: definition.id,
          roleIds: await listReportRoles(db, { organizationId, reportId: definition.id }),
        })),
      )
    : [];

  const navigation = (
    <ReportNavigation
      organizationId={organizationId}
      measure={measure}
      grouping={grouping}
      period={preset}
      filters={filters}
      answerable={answerable}
      definitions={definitions}
      savedId={saved?.id}
    />
  );

  return (
    <AppPage>
      <PageHeader title={areaLabel('insights')} />
      <InsightsViewNav organizationId={organizationId} current="reports" />
      {navigation}
      <Hint className="mb-4 block">
        Dated by the day on the invoice and the day the cost was incurred — not the day either was
        typed in. Times read in {organization.timezone}.
      </Hint>
      <ReportFilters
        grouping={grouping}
        period={preset}
        filters={filters}
        customers={customers}
        resources={resources}
        locations={locations}
      />
      <ReportResultView result={result} grouping={grouping} filters={filters} />
      <ReportManagement
        organizationId={organizationId}
        measure={measure}
        grouping={grouping}
        period={preset}
        filters={filters}
        definitions={definitions}
        roles={roles.map(({ id, name }) => ({ id, name }))}
        shared={shared}
        mayManage={mayManage}
        role={organization.role}
      />
    </AppPage>
  );
}
