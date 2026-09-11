import { Hint } from '@/components/controls/inputs';
import { ButtonLink } from '@/components/controls/button';
import { DataTable } from '@/components/display/table';
import { Badge } from '@/components/display/data';
import { listConnections } from '@/lib/domain/integrations/connections';
import { listResources } from '@/lib/domain/integrations/resources';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function IntegrationSourcesPage({
  params,
}: PageProps<'/organizations/[organizationId]/integrations/sources'>) {
  const { organizationId } = await params;
  const { db } = await requireOrganization(organizationId);

  const [resources, connections] = await Promise.all([
    listResources(db, { organizationId }),
    listConnections(db, { organizationId }),
  ]);

  const connectionLabel = new Map(
    connections.map((connection) => [connection.id, connection.accountLabel ?? connection.connectorKey]),
  );

  return (
    <>
      <Hint>Every sheet, file or feed selected from a connection, across every connector.</Hint>

      <div className="mt-6">
        <DataTable
          rows={resources}
          rowKey={(resource) => resource.id}
          empty="No data sources yet. Connect an app or upload a file to add one."
          columns={[
            { key: 'name', header: 'Resource', emphasis: 'primary', cell: (r) => r.displayName },
            { key: 'type', header: 'Type', cell: (r) => r.resourceType.replace(/_/g, ' ') },
            {
              key: 'connection',
              header: 'From',
              cell: (r) => connectionLabel.get(r.connectionId) ?? '—',
            },
            {
              key: 'status',
              header: 'Status',
              cell: (r) => (
                <Badge tone={r.status === 'active' ? 'success' : 'neutral'}>
                  {r.status.replace(/_/g, ' ')}
                </Badge>
              ),
            },
            {
              key: 'actions',
              header: 'Import',
              emphasis: 'secondary',
              cell: (r) => (
                <ButtonLink
                  href={`/organizations/${organizationId}/integrations/imports/new?resourceId=${r.id}`}
                  tone="text"
                  size="small"
                >
                  Import →
                </ButtonLink>
              ),
            },
          ]}
        />
      </div>
    </>
  );
}
