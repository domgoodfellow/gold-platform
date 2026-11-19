import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/headers/page-header';
import { getImportRun, listStagingRows, type StagingRowStatus } from '@/lib/domain/integrations/import-runs';
import { libraryHref } from '@/lib/route/library';
import { LibraryNav } from '@/features/library/library-nav';
import { requireOrganization } from '@/lib/route/organization';
import { ImportRunDetail, summarizeStaging } from '@/features/integrations/imports/import-run-detail';
import { ImportSteps } from '@/features/integrations/imports/import-steps';
import { ErrorText } from '@/components/controls/inputs';
import { listContactCurrentValues } from '@/lib/domain/contacts/contacts';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';

export const dynamic = 'force-dynamic';

export default async function ImportRunPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/library/imports/[runId]'>) {
  const { organizationId, runId } = await params;
  const { status: statusParam, stageError } = await searchParams;
  const { db, organization } = await requireOrganization(organizationId);

  const run = await getImportRun(db, { organizationId, runId });
  if (!run) notFound();

  const status = typeof statusParam === 'string' ? (statusParam as StagingRowStatus) : undefined;
  // The summary counts every staged row; the table shows the chosen filter.
  const allRows = await listStagingRows(db, { organizationId, runId });
  const rows = status ? allRows.filter((row) => row.status === status) : allRows;
  const readyCount = allRows.filter((row) => row.status === 'ready').length;
  const finished = run.status === 'completed' || run.status === 'completed_with_errors';
  const prices = run.targetEntity === 'price_book_item';
  // Choosing between existing contacts is viewing them, so only `customer.read` reviews contact rows;
  // a price book row is decided under `price.manage`. The database refuses a decision without it.
  const mayReview = organization.capabilities.includes(prices ? 'price.manage' : 'customer.read');
  // The existing contacts named by the rows shown, with the values an update would change; for a price book import, its items.
  const [contacts, definitions, priceItems] = await Promise.all([
    !prices && mayReview ? listContactCurrentValues(db, { organizationId, ids: rows.flatMap((row) => [...row.candidateIds, ...(row.matchedCustomerId ? [row.matchedCustomerId] : [])]) }) : new Map(),
    prices ? Promise.resolve([]) : listFieldDefinitions(db, { organizationId, entityType: 'customer' }),
    prices ? listPriceBookItems(db, { organizationId }) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader title={prices ? 'Import into the price book' : 'Import into Contacts'} crumbs={[{ label: 'Imports', href: libraryHref(organizationId, 'sources') }]} />
      <LibraryNav organizationId={organizationId} active="sources" />
      <ImportSteps organizationId={organizationId} current={finished ? 4 : 2} resourceId={finished ? null : run.resourceId} into={prices ? 'price_book' : 'contacts'} />
      {typeof stageError === 'string' ? <ErrorText role="alert" className="mb-4">{stageError}</ErrorText> : null}
      <ImportRunDetail
        organizationId={organizationId}
        runId={runId}
        run={run}
        rows={rows}
        summary={summarizeStaging(allRows)}
        readyCount={readyCount}
        status={status}
        contacts={contacts}
        fieldLabels={Object.fromEntries(definitions.map((definition) => [definition.key, definition.label]))}
        mayReview={mayReview}
        priceItems={new Map(priceItems.map((item) => [item.id, item]))}
      />
    </>
  );
}
