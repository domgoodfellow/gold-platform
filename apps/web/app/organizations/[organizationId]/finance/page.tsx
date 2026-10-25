import { WorkspaceConfigure } from '@/features/settings/workspace-configure';
import { FinanceHome } from '@/features/finance/home/finance-home';
import { loadFinanceOperating } from '@/lib/application/finance/operating';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { requireOrganization } from '@/lib/route/organization';
import { readDashboardLayout } from '@/lib/domain/preferences/dashboard-layouts';
import { FINANCE_WIDGETS } from '@/lib/application/finance/dashboard-widgets';

export const dynamic = 'force-dynamic';
export default async function FinancePage({ params, searchParams }: PageProps<'/organizations/[organizationId]/finance'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const { db, organization } = await requireOrganization(organizationId);
  const today = todayInZone(organization.timezone);
  // The layout is this person's presentation only; it is read beside the data, never instead of a permission check.
  const [data, layout] = await Promise.all([
    loadFinanceOperating(db, { organizationId, today, timezone: organization.timezone, month: typeof query.month === 'string' ? query.month : undefined, canReadReports: organization.capabilities.includes('report.read') }),
    readDashboardLayout(db, { organizationId, workspace: 'finance', registry: FINANCE_WIDGETS }),
  ]);
  return <FinanceHome organizationId={organizationId} today={today} timezone={organization.timezone} data={data} capabilities={organization.capabilities} configure={<WorkspaceConfigure organizationId={organizationId} workspace="finance" />} layout={layout} />;
}
