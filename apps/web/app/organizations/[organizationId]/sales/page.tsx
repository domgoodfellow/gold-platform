import { AppPage } from '@/components/layout/app-page';
import { KpiCard, type Kpi } from '@/components/surfaces/kpi-card';
import { PageHeader } from '@/components/headers/page-header';
import { EmptyState } from '@/components/surfaces/section';
import { activeModuleKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listCustomerStages } from '@/lib/domain/customers/stages';
import { areaHref, areaLabel, workspaceLabel } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * Sales Home: Customers and, where this business has it, the Pipeline. Every figure is a count
 * some domain read already owns, one per page, and each links to it — nothing is totalled here.
 */
export default async function SalesPage({ params }: PageProps<'/organizations/[organizationId]/sales'>) {
  const { organizationId } = await params;
  const { db } = await requireOrganization(organizationId);

  const resolvedFeatures = await organizationResolvedFeatureStates(db, { organizationId });
  const reception = activeModuleKeys(resolvedFeatures).has('reception');

  const [customers, stages] = await Promise.all([
    listCustomers(db, { organizationId }),
    reception ? listCustomerStages(db, { organizationId }) : Promise.resolve([]),
  ]);

  const href = (segment: string) => areaHref(organizationId, segment);
  const kpis: Kpi[] = [{ key: 'customers', label: areaLabel('customers'), value: customers.total, href: href('customers') }];
  if (reception) {
    kpis.push({
      key: 'pipeline',
      label: areaLabel('pipeline'),
      value: stages.length,
      note: 'stages named',
      href: href('pipeline'),
    });
  }

  const empty = customers.total === 0;

  return (
    <AppPage>
      <PageHeader
        title={workspaceLabel('sales')}
        description="Who this business works for, and where each relationship has got to."
      />
      {empty ? (
        <EmptyState>Nothing has been recorded in Sales yet.</EmptyState>
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
