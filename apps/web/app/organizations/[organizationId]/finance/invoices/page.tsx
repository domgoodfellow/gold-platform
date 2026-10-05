import { AppPage } from '@/components/layout/app-page';
import { Hint } from '@/components/controls/inputs';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { InvoicesTable } from '@/features/finance/collections/finance-tables';
import { loadFinanceInvoices } from '@/lib/application/finance/invoices';
import { areaHref, workspaceLabel } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/** Every invoice this business has issued. Standing is `invoiceStanding`'s; the job's own record is where an invoice is worked on. */
export default async function FinanceInvoicesPage({
  params,
}: PageProps<'/organizations/[organizationId]/finance/invoices'>) {
  const { organizationId } = await params;
  const { db } = await requireOrganization(organizationId);
  const { rows, total } = await loadFinanceInvoices(db, { organizationId });

  return (
    <AppPage>
      <CollectionHeader
        title="Invoices"
        crumbs={[{ label: workspaceLabel('finance'), href: areaHref(organizationId, 'finance') }]}
      />
      <Hint className="mb-3">Standing is worked out from the lines on each invoice and the payments recorded against it.</Hint>
      {total > rows.length ? <Hint className="mb-3">Showing the {rows.length} most recent of {total}.</Hint> : null}
      <InvoicesTable organizationId={organizationId} rows={rows} empty="No invoices yet. Issued invoices will appear here." />
    </AppPage>
  );
}
