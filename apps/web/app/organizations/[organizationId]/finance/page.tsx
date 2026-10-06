import { ButtonLink } from '@/components/controls/button';
import { WorkspaceHome } from '@/components/patterns/workspace-home';
import { FinanceHomeBody } from '@/features/finance/home/finance-home';
import { financeOverview } from '@/lib/application/finance/finance-overview';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { workspaceLabel } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * Finance Home: this business's own money with its own customers — what is owed, what is quoted
 * and not yet billed, what was recently invoiced and paid. Acquires from `financeOverview` and
 * draws; every figure is a domain read's. What this business buys from GildOps is Settings → Plan &
 * usage, and GildOps' own commercial control plane is Platform — neither is read here.
 */
export default async function FinancePage({
  params,
}: PageProps<'/organizations/[organizationId]/finance'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const canReadReports = organization.capabilities.includes('report.read');

  const overview = await financeOverview(db, {
    organizationId,
    today: todayInZone(organization.timezone),
    canReadReports,
  });

  return (
    <WorkspaceHome
      title={workspaceLabel('finance')}
      actions={
        <div className="flex flex-wrap gap-2">
          {organization.capabilities.includes('price.manage') ? (
            <ButtonLink href={`/organizations/${organizationId}/settings/pricing`} tone="secondary">Pricing</ButtonLink>
          ) : null}
        </div>
      }
    >
      <FinanceHomeBody organizationId={organizationId} overview={overview} />
    </WorkspaceHome>
  );
}
