import { AppPage } from '@/components/layout/app-page';
import { Hint } from '@/components/controls/inputs';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { QuotesTable } from '@/features/finance/collections/finance-tables';
import { loadFinanceQuotes } from '@/lib/application/finance/quotes';
import { areaHref, workspaceLabel } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/** Quoted work: every job with something priced on it, as `priceWorkItem` totals it. A projection — the work record owns the job. */
export default async function FinanceQuotesPage({
  params,
}: PageProps<'/organizations/[organizationId]/finance/quotes'>) {
  const { organizationId } = await params;
  const { db } = await requireOrganization(organizationId);
  const { rows, total } = await loadFinanceQuotes(db, { organizationId });

  return (
    <AppPage>
      <CollectionHeader
        title="Quotes"
        crumbs={[{ label: workspaceLabel('finance'), href: areaHref(organizationId, 'finance') }]}
      />
      <Hint className="mb-3">A quote is a job with priced lines. Open one to change what is priced on it.</Hint>
      {total > rows.length ? <Hint className="mb-3">Showing the {rows.length} most recent of {total}.</Hint> : null}
      <QuotesTable organizationId={organizationId} rows={rows} empty="No quoted work yet. Price a work item and it will appear here." />
    </AppPage>
  );
}
