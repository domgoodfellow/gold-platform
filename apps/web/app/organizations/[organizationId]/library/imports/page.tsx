import { CollectionHeader } from '@/components/patterns/collection-header';
import { LibraryNav } from '@/features/library/library-nav';
import { libraryNewImportHref } from '@/lib/route/library';
import { ButtonLink } from '@/components/controls/button';
import { ImportRunsTable } from '@/features/integrations/imports/import-runs-table';
import { listImportRuns } from '@/lib/domain/integrations/import-runs';
import { listConnections } from '@/lib/domain/integrations/connections';
import { listResources } from '@/lib/domain/integrations/resources';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function ImportRunsPage({
  params,
}: PageProps<'/organizations/[organizationId]/library/imports'>) {
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
        crumbs={[{ label: 'Library', href: `/organizations/${organizationId}/library` }]}
        actions={
          organization.capabilities.includes('integration.manage') ? (
            <ButtonLink href={libraryNewImportHref(organizationId)} tone="primary" size="small">
              Import file
            </ButtonLink>
          ) : null
        }
      />
      <LibraryNav organizationId={organizationId} active="imports" />
      <div className="mt-6">
        <ImportRunsTable organizationId={organizationId} runs={runs} resourceName={resourceName} connectorLabel={connectorLabel} />
      </div>
    </>
  );
}
