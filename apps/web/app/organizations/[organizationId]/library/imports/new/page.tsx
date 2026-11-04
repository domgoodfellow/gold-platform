import { ButtonLink } from '@/components/controls/button';
import { listResources } from '@/lib/domain/integrations/resources';
import { librarySourceHref } from '@/lib/route/library';
import { Lock } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@gold/ui/components/alert';
import { PageHeader } from '@/components/headers/page-header';
import { ErrorText, Hint } from '@/components/controls/inputs';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { suggestMapping } from '@/lib/domain/integrations/mappings';
import { downloadImportFile } from '@/lib/domain/integrations/resources';
import { libraryHref } from '@/lib/route/library';
import { LibraryNav } from '@/features/library/library-nav';
import { requireOrganization } from '@/lib/route/organization';
import { ChooseImportSource } from '@/features/integrations/imports/choose-source';
import { ImportSteps } from '@/features/integrations/imports/import-steps';
import { listConnections } from '@/lib/domain/integrations/connections';
import { listLibraryFiles } from '@/lib/domain/documents/library-files';
import { MappingEditor } from '@/features/integrations/imports/mapping-editor';
import {DomainError} from '@/lib/domain/errors';

export const dynamic = 'force-dynamic';

export default async function NewImportPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/library/imports/new'>) {
  const { organizationId } = await params;
  const { resourceId, error } = await searchParams;
  const { db, organization } = await requireOrganization(organizationId);

  // Importing is the organization's own capability. The database refuses every step without it
  // (`integration.manage`); this only says so instead of showing a form that cannot succeed.
  if (!organization.capabilities.includes('integration.manage')) {
    return (
      <>
        <PageHeader title="Import into Contacts" crumbs={[{ label: 'Imports', href: libraryHref(organizationId, 'sources') }]} />
        <LibraryNav organizationId={organizationId} active="sources" />
        <Alert>
          <Lock aria-hidden />
          <AlertTitle>Your role, {organization.role}, cannot import data</AlertTitle>
          <AlertDescription>Importing needs the permission to connect external data sources. Ask someone who has it in this business.</AlertDescription>
        </Alert>
      </>
    );
  }

  const resources = await listResources(db, { organizationId });
  if (typeof resourceId !== 'string') {
    const [connections, spreadsheets] = await Promise.all([
      listConnections(db, { organizationId }),
      listLibraryFiles(db, { organizationId, filter: { search: '', family: 'spreadsheets', usage: 'any', sort: 'newest', page: 1 } }),
    ]);
    const csvFiles = spreadsheets.rows.filter(file => file.mimeType === 'text/csv' || file.fileName.toLowerCase().endsWith('.csv'));
    return (
      <>
        <PageHeader title="Import into Contacts" crumbs={[{ label: 'Imports', href: libraryHref(organizationId, 'sources') }]} />
        <LibraryNav organizationId={organizationId} active="sources" />
        <ImportSteps organizationId={organizationId} current={0} />
        {typeof error === 'string' ? <ErrorText role="alert" className="mb-4">{error}</ErrorText> : null}
        <ChooseImportSource organizationId={organizationId} resources={resources} files={csvFiles} connectionStatus={new Map(connections.map(connection => [connection.id, connection.status]))} />
      </>
    );
  }

  let source;
  try{source=await downloadImportFile(db,{organizationId,resourceId});}
  catch(failure){if(failure instanceof DomainError)return <><PageHeader title="Import into Contacts"/><LibraryNav organizationId={organizationId} active="sources"/><Hint className="mt-6" role="alert">{failure.message}</Hint><ButtonLink tone="secondary" href={librarySourceHref(organizationId,resourceId)}>Open source status</ButtonLink></>;throw failure;}
  if (!source) {
    return <><PageHeader title="Import into Contacts"/><LibraryNav organizationId={organizationId} active="sources"/><Hint className="mt-6">No importable rows are available. Synchronize the worksheet or upload a CSV file.</Hint><ButtonLink tone="secondary" href={librarySourceHref(organizationId,resourceId)}>Open source status</ButtonLink></>;
  }

  const definitions = await listFieldDefinitions(db, { organizationId, entityType: 'customer' });
  const suggested = suggestMapping(source.headers, definitions);

  return (
    <>
      <PageHeader title="Map your columns" crumbs={[{ label: 'Imports', href: libraryHref(organizationId, 'sources') }]} />
      <LibraryNav organizationId={organizationId} active="sources" />
      <ImportSteps organizationId={organizationId} current={1} resourceId={resourceId} />
      <MappingEditor
        organizationId={organizationId}
        maySynchronize={['google_sheet','microsoft_workbook'].includes(resources.find(resource => resource.id === resourceId)?.resourceType ?? '')}
        resourceId={resourceId}
        headers={source.headers}
        sample={source.sample}
        totalRows={source.totalRows}
        suggested={suggested}
        definitions={definitions}
        error={typeof error === 'string' ? error : undefined}
      />
    </>
  );
}
