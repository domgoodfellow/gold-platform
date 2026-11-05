import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { DataTable } from '@/components/display/table';
import { TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';
import { listInvoicedAndIncurred } from '@/lib/domain/reporting/financials';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { PricingPlanner } from '@/features/finance/pricing-planner';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { financePeriod } from '@/lib/application/finance/operating';
import { formatMoney } from '@/lib/domain/work-items/consumption';

export default async function FinanceReports({ params, searchParams }: PageProps<'/organizations/[organizationId]/finance/reports'>) {
  const { organizationId } = await params;
  // Enforce report.read, billing availability and features before protected reads.
  const { db, organization } = await requireOperatingArea(organizationId, 'finance-reports');
  const query = await searchParams;
  const period = financePeriod(todayInZone(organization.timezone), typeof query.month === 'string' ? query.month : undefined);
  const [rows, items] = await Promise.all([
    listInvoicedAndIncurred(db, { organizationId, grouping: 'customer', period }),
    listPriceBookItems(db, { organizationId }),
  ]);
  return <AppPage>
    <CollectionHeader title="Financial performance" crumbs={[{ label: 'Finance', href: `/organizations/${organizationId}/finance` }]} />
    <form className="mb-4 flex flex-wrap gap-2">
      <TextInput type="month" name="month" aria-label="Reporting month" defaultValue={period.month} className="w-48" />
      <Button tone="secondary" type="submit">Apply</Button>
    </form>
    <p className="mb-4 text-sm text-muted">Recorded: invoiced and incurred by Customer · {organization.timezone}. Margin uses recorded costs; missing entries do not establish the full cost of delivery.</p>
    <DataTable rows={rows} rowKey={r => `${r.groupId}-${r.currency}`} empty="No financial activity in this period." columns={[
      { key: 'customer', header: 'Customer', emphasis: 'primary', cell: r => r.label ?? 'Unattributed' },
      { key: 'currency', header: 'Currency', cell: r => r.currency },
      { key: 'invoiced', header: 'Invoiced', numeric: true, cell: r => formatMoney(r.invoicedMinor, r.currency) },
      { key: 'cost', header: 'Costs recorded', numeric: true, cell: r => r.incurredMinor === null ? 'Unknown' : formatMoney(r.incurredMinor, r.currency) },
      { key: 'margin', header: 'Margin on recorded costs', numeric: true, cell: r => r.marginMinor === null ? 'Unknown' : formatMoney(r.marginMinor, r.currency) },
    ]} />
    <div className="mt-6"><PricingPlanner key={organizationId} currency={organization.currency} items={items} /></div>
  </AppPage>;
}
