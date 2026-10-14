import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/headers/page-header';
import { areaLabel } from '@/lib/navigation';
import { getImportRun, listStagingRows, type StagingRowStatus } from '@/lib/domain/integrations/import-runs';
import { requireOrganization } from '@/lib/route/organization';
import { ImportRunDetail } from '@/features/integrations/imports/import-run-detail';
import { ErrorText } from '@/components/controls/inputs';

export const dynamic = 'force-dynamic';

export default async function ImportRunPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/integrations/imports/[runId]'>) {
  const { organizationId, runId } = await params;
  const { status: statusParam, stageError } = await searchParams;
  const { db } = await requireOrganization(organizationId);

  const run = await getImportRun(db, { organizationId, runId });
  if (!run) notFound();

  const status = typeof statusParam === 'string' ? (statusParam as StagingRowStatus) : undefined;
  const rows = await listStagingRows(db, { organizationId, runId, status });
  const readyRows = status === 'ready' ? rows : await listStagingRows(db, { organizationId, runId, status: 'ready' });

  return (
    <>
      <PageHeader title="Import" crumbs={[{ label: areaLabel('integrations'), href: `/organizations/${organizationId}/settings/connections` }]} />
      {typeof stageError === 'string' ? <ErrorText>{stageError}</ErrorText> : null}
      <ImportRunDetail
        organizationId={organizationId}
        runId={runId}
        run={run}
        rows={rows}
        readyCount={readyRows.length}
        status={status}
      />
    </>
  );
}
