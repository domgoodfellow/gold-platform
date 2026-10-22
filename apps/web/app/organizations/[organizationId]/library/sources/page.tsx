import { CollectionHeader } from '@/components/patterns/collection-header';
import { ButtonLink } from '@/components/controls/button';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { LibraryNav } from '@/features/library/library-nav';
import { SourcesTable } from '@/features/integrations/sources/sources-table';
import { ImportRunsTable } from '@/features/integrations/imports/import-runs-table';
import { libraryHref, libraryNewImportHref } from '@/lib/route/library';
import { listResources } from '@/lib/domain/integrations/resources';
import { listConnections } from '@/lib/domain/integrations/connections';
import { listImportRuns } from '@/lib/domain/integrations/import-runs';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * Where data comes from, and what was brought in from it. A source is anything outside GildOps the
 * business reads from; an import is one run that brought a source's rows in. They are one page
 * because each import belongs to a source.
 */
export default async function LibrarySourcesPage({
  params,
}: PageProps<'/organizations/[organizationId]/library/sources'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const [resources, connections, runs] = await Promise.all([
    listResources(db, { organizationId }),
    listConnections(db, { organizationId }),
    listImportRuns(db, { organizationId }),
  ]);

  const connectionLabel = new Map(connections.map((c) => [c.id, c.accountLabel ?? c.connectorKey]));
  const resourceName = new Map(resources.map((r) => [r.id, r.displayName]));
  const connectorLabel = new Map(connections.map((c) => [c.connectorKey, c.accountLabel ?? c.connectorKey]));
  const mayImport = organization.capabilities.includes('integration.manage');

  return (
    <>
      <CollectionHeader
        title="Sources"
        crumbs={[{ label: 'Library', href: libraryHref(organizationId, 'files') }]}
        actions={
          mayImport ? (
            <ButtonLink href={libraryNewImportHref(organizationId)} tone="primary" size="small">
              Upload a file
            </ButtonLink>
          ) : null
        }
      />
      <LibraryNav organizationId={organizationId} active="sources" />

      <Section className="mt-6" aria-labelledby="sources-heading">
        <SectionHeading id="sources-heading">Sources</SectionHeading>
        <div className="mt-2">
          <SourcesTable organizationId={organizationId} resources={resources} mayImport={mayImport} connectionLabel={connectionLabel} />
        </div>
      </Section>

      <Section className="mt-10" aria-labelledby="imports-heading">
        <SectionHeading id="imports-heading">Imports</SectionHeading>
        <div className="mt-2">
          <ImportRunsTable organizationId={organizationId} runs={runs} resourceName={resourceName} connectorLabel={connectorLabel} />
        </div>
      </Section>
    </>
  );
}
