import { FinanceHome } from '@/features/finance/home/finance-home';
import { loadFinanceOperating } from '@/lib/application/finance/operating';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';
export default async function FinancePage({ params, searchParams }: PageProps<'/organizations/[organizationId]/finance'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const { db, organization } = await requireOrganization(organizationId);
  const today = todayInZone(organization.timezone);
  const data = await loadFinanceOperating(db, { organizationId, today, timezone: organization.timezone, month: typeof query.month === 'string' ? query.month : undefined, canReadReports: organization.capabilities.includes('report.read') });
  return <FinanceHome organizationId={organizationId} today={today} timezone={organization.timezone} data={data} capabilities={organization.capabilities} />;
}
