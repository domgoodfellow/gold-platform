import { WorkspaceHome } from '@/components/patterns/workspace-home';
import { KpiCard, type Kpi } from '@/components/surfaces/kpi-card';
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
  const kpis: Kpi[] = [
    { key: 'customers', label: areaLabel('customers'), value: customers.total, href: href('customers') },
    {
      key: 'pipeline',
      label: areaLabel('pipeline'),
      value: reception ? stages.length : '—',
      note: reception ? 'stages named' : 'Communications/Voice is off',
      href: href('pipeline'),
    },
  ];

  const empty = customers.total === 0;

  return (
    <WorkspaceHome title={workspaceLabel('sales')}>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.key} kpi={kpi} />
        ))}
      </div>
      {empty ? (
        <EmptyState
          className="mt-8"
          title="Nothing recorded in Sales yet"
          description="Customers you add, and the Pipeline tracking where each one has got to, will show here."
        />
      ) : null}
    </WorkspaceHome>
  );
}
