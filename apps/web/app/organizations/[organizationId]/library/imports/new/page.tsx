import { ButtonLink } from '@/components/controls/button';
import { listResources } from '@/lib/domain/integrations/resources';
import { libraryNewImportHref, librarySourceHref } from '@/lib/route/library';
import { Lock } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@gold/ui/components/alert';
import { PageHeader } from '@/components/headers/page-header';
import { Hint } from '@/components/controls/inputs';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { suggestMapping } from '@/lib/domain/integrations/mappings';
import { downloadImportFile } from '@/lib/domain/integrations/resources';
import { libraryHref } from '@/lib/route/library';
import { LibraryNav } from '@/features/library/library-nav';
import { requireOrganization } from '@/lib/route/organization';
import { UploadSourceForm } from '@/features/integrations/imports/upload-source-form';
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
    return (
      <>
        <PageHeader title="Import into Contacts" crumbs={[{ label: 'Imports', href: libraryHref(organizationId, 'sources') }]} />
        <LibraryNav organizationId={organizationId} active="sources" />
        <Hint className="mb-4 block">
          Upload a CSV export. GildOps reads the header row and shows you a mapping to review before anything is written.
        </Hint>
        {typeof error === 'string' ? <Hint role="alert">{error}</Hint> : null}
        <section className="mb-6 space-y-2"><h2 className="font-medium">Choose an existing source</h2>
          {resources.filter(resource => resource.status === 'active' && ['file_upload','google_sheet','microsoft_workbook'].includes(resource.resourceType)).map(resource => <div key={resource.id} className="flex flex-wrap items-center gap-3"><ButtonLink tone="secondary" href={libraryNewImportHref(organizationId, resource.id)}>{resource.displayName}</ButtonLink><ButtonLink tone="text" href={librarySourceHref(organizationId, resource.id)}>Source status</ButtonLink></div>)}
          <ButtonLink tone="text" href={libraryHref(organizationId, 'files')}>Choose a Library CSV file</ButtonLink>
          <ButtonLink tone="text" href={libraryHref(organizationId, 'sources')}>Connect or synchronize a spreadsheet</ButtonLink>
        </section>
        <h2 className="mb-2 font-medium">Upload a CSV snapshot</h2>
        <UploadSourceForm organizationId={organizationId} />
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
