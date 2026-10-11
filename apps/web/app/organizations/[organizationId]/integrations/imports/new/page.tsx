import { Lock } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@gold/ui/components/alert';
import { PageHeader } from '@/components/headers/page-header';
import { areaLabel } from '@/lib/navigation';
import { Hint } from '@/components/controls/inputs';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { suggestMapping } from '@/lib/domain/integrations/mappings';
import { downloadImportFile } from '@/lib/domain/integrations/resources';
import { requireOrganization } from '@/lib/route/organization';
import { UploadSourceForm } from '@/features/integrations/imports/upload-source-form';
import { MappingEditor } from '@/features/integrations/imports/mapping-editor';
import {DomainError} from '@/lib/domain/errors';

export const dynamic = 'force-dynamic';

export default async function NewImportPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/integrations/imports/new'>) {
  const { organizationId } = await params;
  const { resourceId, error } = await searchParams;
  const { db, organization } = await requireOrganization(organizationId);

  // Importing is the organization's own capability. The database refuses every step without it
  // (`integration.manage`); this only says so instead of showing a form that cannot succeed.
  if (!organization.capabilities.includes('integration.manage')) {
    return (
      <>
        <PageHeader title="Import customers" crumbs={[{ label: areaLabel('integrations'), href: `/organizations/${organizationId}/settings/connections` }]} />
        <Alert>
          <Lock aria-hidden />
          <AlertTitle>Your role, {organization.role}, cannot import data</AlertTitle>
          <AlertDescription>Importing needs the permission to connect external data sources. Ask someone who has it in this business.</AlertDescription>
        </Alert>
      </>
    );
  }

  if (typeof resourceId !== 'string') {
    return (
      <>
        <PageHeader title="Import customers" crumbs={[{ label: areaLabel('integrations'), href: `/organizations/${organizationId}/settings/connections` }]} />
        <Hint className="mb-4 block">
          Upload a CSV export. GildOps reads the header row and shows you a mapping to review before anything is written.
        </Hint>
        <UploadSourceForm organizationId={organizationId} />
      </>
    );
  }

  let source;
  try{source=await downloadImportFile(db,{organizationId,resourceId});}
  catch(failure){if(failure instanceof DomainError)return <Hint className="mt-6" role="alert">{failure.message}</Hint>;throw failure;}
  if (!source) {
    return <Hint className="mt-6">No importable rows are available. Synchronize the worksheet or upload a CSV file.</Hint>;
  }

  const definitions = await listFieldDefinitions(db, { organizationId, entityType: 'customer' });
  const suggested = suggestMapping(source.headers, definitions);

  return (
    <>
      <PageHeader title="Map your columns" crumbs={[{ label: areaLabel('integrations'), href: `/organizations/${organizationId}/settings/connections` }]} />
      <MappingEditor
        organizationId={organizationId}
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
