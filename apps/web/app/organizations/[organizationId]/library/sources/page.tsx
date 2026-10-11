import {CollectionHeader} from '@/components/patterns/collection-header';
import {LibraryNav} from '@/features/library/library-nav';
import {SourcesTable} from '@/features/integrations/sources/sources-table';
import {listResources} from '@/lib/domain/integrations/resources';
import {listConnections} from '@/lib/domain/integrations/connections';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function LibrarySourcesPage({
  params,
}: PageProps<'/organizations/[organizationId]/library/sources'>) {
  const { organizationId } = await params;
  const {db}=await requireOrganization(organizationId);
  const [resources,connections]=await Promise.all([listResources(db,{organizationId}),listConnections(db,{organizationId})]);

  return (
    <>
      <CollectionHeader title="Sources" crumbs={[{label:'Library',href:`/organizations/${organizationId}/library`}]}/>
      <LibraryNav organizationId={organizationId} active="sources"/>
      <div className="mt-6"><SourcesTable organizationId={organizationId} resources={resources} connectionLabel={new Map(connections.map(c=>[c.id,c.accountLabel??c.connectorKey]))}/></div>
    </>
  );
}
