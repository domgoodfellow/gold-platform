import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { DataTable } from '@/components/display/table';
import { TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { requireOrganization } from '@/lib/route/organization';
import { listInvoicedAndIncurred } from '@/lib/domain/reporting/financials';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { financePeriod } from '@/lib/application/finance/operating';
import { formatMoney } from '@/lib/domain/work-items/consumption';

export default async function FinanceReports({ params, searchParams }: PageProps<'/organizations/[organizationId]/finance/reports'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const query = await searchParams;
  const period = financePeriod(todayInZone(organization.timezone), typeof query.month === 'string' ? query.month : undefined);
  const allowed = organization.capabilities.includes('report.read');
  const rows = allowed ? await listInvoicedAndIncurred(db,{organizationId,grouping:'customer',period}) : [];
  return <AppPage><CollectionHeader title="Financial performance" crumbs={[{label:'Finance',href:`/organizations/${organizationId}/finance`}]} /><form className="mb-4 flex gap-2"><TextInput type="month" name="month" aria-label="Reporting month" defaultValue={period.month} className="w-48" /><Button tone="secondary" type="submit">Apply</Button></form><p className="mb-4 text-sm text-muted">Invoiced and incurred by Customer · {organization.timezone}. Payments received are shown separately in Finance. Margin uses recorded costs.</p>{allowed ? <DataTable rows={rows} rowKey={r=>`${r.groupId}-${r.currency}`} empty="No financial activity in this period." columns={[{key:'customer',header:'Customer',emphasis:'primary',cell:r=>r.label??'Unattributed'},{key:'currency',header:'Currency',cell:r=>r.currency},{key:'invoiced',header:'Invoiced',numeric:true,cell:r=>formatMoney(r.invoicedMinor,r.currency)},{key:'cost',header:'Costs recorded',numeric:true,cell:r=>r.incurredMinor===null?'Unknown':formatMoney(r.incurredMinor,r.currency)},{key:'margin',header:'Margin on recorded costs',numeric:true,cell:r=>r.marginMinor===null?'Unknown':formatMoney(r.marginMinor,r.currency)}]} /> : <p>Your role cannot read financial reports.</p>}</AppPage>;
}
