import { ButtonLink } from '@/components/controls/button';
import { listResources } from '@/lib/domain/integrations/resources';
import { librarySourceHref } from '@/lib/route/library';
import { Lock } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@gold/ui/components/alert';
import { PageHeader } from '@/components/headers/page-header';
import { ErrorText, Hint } from '@/components/controls/inputs';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { findSavedTranslation, suggestMapping } from '@/lib/domain/integrations/mappings';
import { downloadImportFile } from '@/lib/domain/integrations/resources';
import { libraryHref } from '@/lib/route/library';
import { LibraryNav } from '@/features/library/library-nav';
import { requireOrganization } from '@/lib/route/organization';
import { ChooseImportSource } from '@/features/integrations/imports/choose-source';
import { ImportSteps } from '@/features/integrations/imports/import-steps';
import { listConnections } from '@/lib/domain/integrations/connections';
import { listLibraryFiles } from '@/lib/domain/documents/library-files';
import { MappingEditor } from '@/features/integrations/imports/mapping-editor';
import { InterpretationEditor } from '@/features/integrations/imports/interpretation-editor';
import { inspectRows } from '@/lib/domain/integrations/translation/inspect';
import { sourceSignature } from '@/lib/domain/integrations/translation/plan';
import { importDestination, libraryNewImportHref } from '@/lib/route/library';
import {DomainError} from '@/lib/domain/errors';
import { PriceBookEditor } from '@/features/integrations/imports/price-book-editor';
import { PRICE_CONCEPTS, businessCurrency, inspectPriceBookRows, type PriceBookInspection, type PriceBookPlan, type PriceMapping } from '@/lib/domain/integrations/translation/price-book';
import { findSavedPlan } from '@/lib/domain/integrations/mappings';

export const dynamic = 'force-dynamic';

export default async function NewImportPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/library/imports/new'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const { resourceId, error, mode } = query;
  const into = importDestination(query.into);
  const title = into === 'price_book' ? 'Import into the price book' : 'Import into Contacts';
  const { db, organization } = await requireOrganization(organizationId);

  // Importing is the organization's own capability. The database refuses every step without it
  // (`integration.manage`); this only says so instead of showing a form that cannot succeed.
  if (!organization.capabilities.includes('integration.manage')) {
    return (
      <>
        <PageHeader title={title} crumbs={[{ label: 'Imports', href: libraryHref(organizationId, 'sources') }]} />
        <LibraryNav organizationId={organizationId} active="sources" />
        <Alert>
          <Lock aria-hidden />
          <AlertTitle>Your role, {organization.role}, cannot import data</AlertTitle>
          <AlertDescription>Importing needs the permission to connect external data sources. Ask someone who has it in this business.</AlertDescription>
        </Alert>
      </>
    );
  }
  // Importing items writes the price book, so it also needs `price.manage`; the database refuses without it.
  if (into === 'price_book' && !organization.capabilities.includes('price.manage')) {
    return (
      <>
        <PageHeader title={title} crumbs={[{ label: 'Imports', href: libraryHref(organizationId, 'sources') }]} />
        <LibraryNav organizationId={organizationId} active="sources" />
        <Alert>
          <Lock aria-hidden />
          <AlertTitle>Your role, {organization.role}, cannot change prices</AlertTitle>
          <AlertDescription>Importing into the price book needs the permission to manage prices. Ask someone who has it in this business.</AlertDescription>
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
        <PageHeader title={title} crumbs={[{ label: 'Imports', href: libraryHref(organizationId, 'sources') }]} />
        <LibraryNav organizationId={organizationId} active="sources" />
        <ImportSteps organizationId={organizationId} current={0} into={into} />
        {typeof error === 'string' ? <ErrorText role="alert" className="mb-4">{error}</ErrorText> : null}
        <ButtonLink tone="text" className="mb-3" href={libraryNewImportHref(organizationId, undefined, into === 'price_book' ? 'contacts' : 'price_book')}>{into === 'price_book' ? 'Import into Contacts instead' : 'Import into the price book instead'}</ButtonLink>
        <ChooseImportSource organizationId={organizationId} into={into} resources={resources} files={csvFiles} connectionStatus={new Map(connections.map(connection => [connection.id, connection.status]))} />
      </>
    );
  }

  let source;
  try{source=await downloadImportFile(db,{organizationId,resourceId});}
  catch(failure){if(failure instanceof DomainError)return <><PageHeader title={title}/><LibraryNav organizationId={organizationId} active="sources"/><Hint className="mt-6" role="alert">{failure.message}</Hint><ButtonLink tone="secondary" href={librarySourceHref(organizationId,resourceId)}>Open source status</ButtonLink></>;throw failure;}
  if (!source) {
    return <><PageHeader title={title}/><LibraryNav organizationId={organizationId} active="sources"/><Hint className="mt-6">No importable rows are available. Synchronize the worksheet or upload a CSV file.</Hint><ButtonLink tone="secondary" href={librarySourceHref(organizationId,resourceId)}>Open source status</ButtonLink></>;
  }

  if (into === 'price_book') {
    const failure = typeof error === 'string' ? error : undefined;
    let inspection: PriceBookInspection;
    let previewError: string | undefined;
    try {
      const currency = await businessCurrency(db, organizationId);
      const saved = await findSavedPlan<PriceBookPlan>(db, { organizationId, signature: sourceSignature(source.headers), kind: 'price_book' });
      // Update preview sends the chosen columns back here; a choice that cannot be read falls back to the starting plan.
      const chosen = PRICE_CONCEPTS.some((concept) => `concept_${concept}` in query)
        ? { version: 1 as const, mapping: Object.fromEntries(PRICE_CONCEPTS.map((concept) => [concept, String(query[`concept_${concept}`] ?? '')]).filter(([, column]) => column)) as PriceMapping, defaultUnit: String(query.defaultUnit ?? '') || null }
        : undefined;
      try { inspection = inspectPriceBookRows(source, { currency, plan: chosen, saved }); }
      catch (problem) {
        if (!(problem instanceof DomainError)) throw problem;
        previewError = problem.message;
        inspection = inspectPriceBookRows(source, { currency, saved });
      }
    } catch (problem) {
      if (problem instanceof DomainError) return <><PageHeader title={title}/><LibraryNav organizationId={organizationId} active="sources"/><Hint className="mt-6" role="alert">{problem.message}</Hint></>;
      throw problem;
    }
    return (
      <>
        <PageHeader title="Read your price list" crumbs={[{ label: 'Imports', href: libraryHref(organizationId, 'sources') }]} />
        <LibraryNav organizationId={organizationId} active="sources" />
        <ImportSteps organizationId={organizationId} current={1} resourceId={resourceId} into={into} />
        <PriceBookEditor organizationId={organizationId} resourceId={resourceId} inspection={inspection} error={failure ?? previewError} />
      </>
    );
  }

  const definitions = await listFieldDefinitions(db, { organizationId, entityType: 'customer' });
  // A source with a business column, a Workbench export or a translation saved for the same columns is read as businesses and people
  // unless the person asks for column-by-column mapping; anything else maps columns as before.
  const saved = mode === 'columns' ? null : await findSavedTranslation(db, { organizationId, signature: sourceSignature(source.headers) });
  const inspection = inspectRows(source, undefined, saved);
  const translate = mode === 'translate' || (mode !== 'columns' && (inspection.origin === 'saved' || inspection.discovery.workbenchPackage || Boolean(inspection.discovery.mapping.business_name)));
  if (translate) {
    return (
      <>
        <PageHeader title="Interpret your source" crumbs={[{ label: 'Imports', href: libraryHref(organizationId, 'sources') }]} />
        <LibraryNav organizationId={organizationId} active="sources" />
        <ImportSteps organizationId={organizationId} current={1} resourceId={resourceId} />
        <InterpretationEditor organizationId={organizationId} resourceId={resourceId} inspection={inspection} definitions={definitions} error={typeof error === 'string' ? error : undefined} />
      </>
    );
  }
  const suggested = suggestMapping(source.headers, definitions);

  return (
    <>
      <PageHeader title="Map your columns" crumbs={[{ label: 'Imports', href: libraryHref(organizationId, 'sources') }]} />
      <LibraryNav organizationId={organizationId} active="sources" />
      <ImportSteps organizationId={organizationId} current={1} resourceId={resourceId} />
      <MappingEditor
        translateHref={`${libraryNewImportHref(organizationId, resourceId)}&mode=translate`}
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
