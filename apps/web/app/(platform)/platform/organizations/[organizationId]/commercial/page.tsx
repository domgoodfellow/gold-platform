import { redirect } from 'next/navigation';
import { AppPage } from '@/components/containers/app-page';
import { DataTable } from '@/components/display/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@gold/ui/components/card';
import { getDb } from '@/lib/db/server';
import { getTenant } from '@/lib/domain/platform/tenants';
import { listOrganizationTerms, moduleCommercialState } from '@/lib/domain/commercial/terms';
import { listProducts } from '@/lib/domain/commercial/catalogue';
import { TenantWorkspaceHeader } from '@/features/platform/tenant-workspace';
import { RecordCommercialTermForm } from '../forms';

export const dynamic = 'force-dynamic';
export default async function Commercial({ params }: PageProps<'/platform/organizations/[organizationId]/commercial'>) {
  const { organizationId } = await params; const db = await getDb(); const tenant = await getTenant(db, organizationId); if (!tenant) redirect('/platform/organizations');
  const [terms, states, products] = await Promise.all([listOrganizationTerms(db, { organizationId }), moduleCommercialState(db, { organizationId }), listProducts(db)]);
  return <AppPage width="full"><TenantWorkspaceHeader id={organizationId} name={tenant.name} currency={tenant.currency} /><div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]"><section><h2 className="text-lg font-semibold">Commercial terms</h2><p className="mt-1 text-sm text-muted-foreground">These are this tenant’s agreed recurring terms, not GOLD’s global list price.</p><div className="mt-4"><DataTable rows={terms} rowKey={(row) => row.id} empty="No commercial terms." columns={[{ key: 'product', header: 'Product', emphasis: 'primary', cell: (row) => row.productKey }, { key: 'period', header: 'Period', cell: (row) => `${row.periodStart} – ${row.periodEnd}` }, { key: 'price', header: 'Agreed price', cell: (row) => row.currency ? `${row.priceMinor} ${row.currency}` : 'No charge' }]} /></div></section><Card><CardHeader><CardDescription>Tenant-specific agreement</CardDescription><CardTitle>Record term</CardTitle></CardHeader><CardContent><RecordCommercialTermForm organizationId={organizationId} products={products.map((product) => ({ value: product.key, label: product.label }))} /></CardContent></Card></div><section className="mt-8"><h2 className="text-lg font-semibold">Module entitlement</h2><p className="mt-1 text-sm text-muted-foreground">A module remains code-backed. This records what this organization requested and paid for.</p><div className="mt-4"><DataTable rows={states} rowKey={(row) => row.moduleKey} empty="No optional module state." columns={[{ key: 'module', header: 'Module', emphasis: 'primary', cell: (row) => row.moduleKey }, { key: 'wanted', header: 'Wanted', cell: (row) => String(row.wanted) }, { key: 'paid', header: 'Paid', cell: (row) => String(row.paid) }]} /></div></section></AppPage>;
}
