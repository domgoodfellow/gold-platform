import { AppPage } from '@/components/layout/app-page';
import { Hint } from '@/components/controls/inputs';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { PaymentsTable } from '@/features/finance/collections/finance-tables';
import { loadFinancePayments } from '@/lib/application/finance/payments';
import { areaHref, workspaceLabel } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/** Money customers have paid this business, as recorded. What this business pays GildOps is Settings → Plan & usage. */
export default async function FinancePaymentsPage({
  params,
}: PageProps<'/organizations/[organizationId]/finance/payments'>) {
  const { organizationId } = await params;
  const { db } = await requireOrganization(organizationId);
  const { rows, total } = await loadFinancePayments(db, { organizationId });

  return (
    <AppPage>
      <CollectionHeader
        title="Payments"
        crumbs={[{ label: workspaceLabel('finance'), href: areaHref(organizationId, 'finance') }]}
      />
      <Hint className="mb-3">Money customers have paid this business. What this business pays GildOps is under Settings → Plan &amp; usage.</Hint>
      {total > rows.length ? <Hint className="mb-3">Showing the {rows.length} most recent of {total}.</Hint> : null}
      <PaymentsTable organizationId={organizationId} rows={rows} empty="No payments recorded yet. Payments appear here when an invoice is paid or a payment is recorded." />
    </AppPage>
  );
}
