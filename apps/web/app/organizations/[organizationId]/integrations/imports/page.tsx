import { PageHeader } from '@/components/containers/page-header';
import { areaLabel } from '@/lib/navigation';
import { ButtonLink } from '@/components/controls/button';
import { DataTable } from '@/components/display/table';
import { Badge } from '@/components/display/data';
import { listImportRuns } from '@/lib/domain/integrations/import-runs';
import { listConnections } from '@/lib/domain/integrations/connections';
import { listResources } from '@/lib/domain/integrations/resources';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, 'success' | 'neutral'> = {
  completed: 'success',
  pending: 'neutral',
  running: 'neutral',
  completed_with_errors: 'neutral',
  failed: 'neutral',
};

export default async function ImportRunsPage({
  params,
}: PageProps<'/organizations/[organizationId]/integrations/imports'>) {
  const { organizationId } = await params;
  const { db } = await requireOrganization(organizationId);

  const [runs, resources, connections] = await Promise.all([
    listImportRuns(db, { organizationId }),
    listResources(db, { organizationId }),
    listConnections(db, { organizationId }),
  ]);

  const resourceName = new Map(resources.map((r) => [r.id, r.displayName]));
  const connectorLabel = new Map(connections.map((c) => [c.connectorKey, c.accountLabel ?? c.connectorKey]));

  return (
    <>
      <PageHeader
        title="Imports"
        crumbs={[{ label: areaLabel('integrations'), href: `/organizations/${organizationId}/integrations` }]}
        description="Every import this business has run, newest first."
        actions={
          <ButtonLink href={`/organizations/${organizationId}/integrations/imports/new`} tone="primary" size="small">
            Import file
          </ButtonLink>
        }
      />

      <div>
        <DataTable
          rows={runs}
          rowKey={(run) => run.id}
          empty="No imports yet."
          columns={[
            {
              key: 'source',
              header: 'Source',
              emphasis: 'primary',
              cell: (run) => (
                <a
                  href={`/organizations/${organizationId}/integrations/imports/${run.id}`}
                  className="underline-offset-4 hover:underline"
                >
                  {(run.resourceId && resourceName.get(run.resourceId)) ?? connectorLabel.get(run.connectorKey) ?? run.connectorKey}
                </a>
              ),
            },
            { key: 'started', header: 'Started', cell: (run) => new Date(run.startedAt).toLocaleString('en-GB') },
            {
              key: 'status',
              header: 'Status',
              cell: (run) => (
                <Badge tone={STATUS_TONE[run.status] ?? 'neutral'}>{run.status.replace(/_/g, ' ')}</Badge>
              ),
            },
            { key: 'created', header: 'Created', numeric: true, cell: (run) => run.rowsCreated },
            { key: 'updated', header: 'Updated', numeric: true, cell: (run) => run.rowsUpdated },
            { key: 'skipped', header: 'Skipped', numeric: true, emphasis: 'secondary', cell: (run) => run.rowsSkipped },
            { key: 'failed', header: 'Failed', numeric: true, emphasis: 'secondary', cell: (run) => run.rowsFailed },
          ]}
        />
      </div>
    </>
  );
}
