import { CollectionHeader } from '@/components/patterns/collection-header';
import { areaLabel } from '@/lib/navigation';
import { IntegrationsNav } from '@/features/integrations/integrations-nav';
import { SourcesTable } from '@/features/integrations/sources/sources-table';
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
      <CollectionHeader
        title="Resource Library"
        crumbs={[{ label: areaLabel('integrations'), href: `/organizations/${organizationId}/settings/connections` }]}
      />
      <IntegrationsNav organizationId={organizationId} current="sources" />
      <div className="mt-6">
        <SourcesTable organizationId={organizationId} resources={resources} connectionLabel={connectionLabel} />
      </div>
    </>
  );
}
