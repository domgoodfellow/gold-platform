import { CollectionHeader } from '@/components/patterns/collection-header';
import { areaLabel } from '@/lib/navigation';
import { ButtonLink } from '@/components/controls/button';
import { IntegrationsNav } from '@/features/integrations/integrations-nav';
import { ImportRunsTable } from '@/features/integrations/imports/import-runs-table';
import { listImportRuns } from '@/lib/domain/integrations/import-runs';
import { listConnections } from '@/lib/domain/integrations/connections';
import { listResources } from '@/lib/domain/integrations/resources';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function ImportRunsPage({
  params,
}: PageProps<'/organizations/[organizationId]/integrations/imports'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const [runs, resources, connections] = await Promise.all([
    listImportRuns(db, { organizationId }),
    listResources(db, { organizationId }),
    listConnections(db, { organizationId }),
  ]);

  const resourceName = new Map(resources.map((r) => [r.id, r.displayName]));
  const connectorLabel = new Map(connections.map((c) => [c.connectorKey, c.accountLabel ?? c.connectorKey]));

  return (
    <>
      <CollectionHeader
        title="Imports"
        crumbs={[{ label: areaLabel('integrations'), href: `/organizations/${organizationId}/settings/connections` }]}
        actions={
          organization.capabilities.includes('integration.manage') ? (
            <ButtonLink href={`/organizations/${organizationId}/integrations/imports/new`} tone="primary" size="small">
              Import file
            </ButtonLink>
          ) : null
        }
      />
      <IntegrationsNav organizationId={organizationId} current="imports" />
      <div className="mt-6">
        <ImportRunsTable organizationId={organizationId} runs={runs} resourceName={resourceName} connectorLabel={connectorLabel} />
      </div>
    </>
  );
}
