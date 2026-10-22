import { CONTACT_LIFECYCLES, LEAD_TEMPERATURES, type ContactLifecycle, type LeadTemperature } from '@/lib/domain/customers/classification';
import { BusinessLabel } from '@/lib/context/business-vocabulary';
import { AppPage } from '@/components/layout/app-page';
import { SupportRegistrar } from '@/components/panels/support-registrar';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { ButtonLink } from '@/components/controls/button';
import {
  CreateCustomerSheetProvider,
  CreateCustomerTrigger,
} from '@/features/crm/customers/create-customer-sheet';
import {
  CustomerListToolbar,
  type CustomerDirectoryView,
} from '@/features/crm/customers/customer-list-toolbar';
import {
  CustomerTable,
  INDUSTRY_FIELD_KEY,
  optionalColumnChoices,
} from '@/features/crm/customers/customer-table';
import {
  CONTACT_PAGE_SIZE,
  listContactLocationLabels,
  listContactPage,
  listCompanies,
  type ContactType,
  listContactLastActivity,
} from '@/lib/domain/contacts/contacts';
import { listCustomerStages } from '@/lib/domain/customers/stages';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { activeModuleKeys, availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { areaAvailable } from '@/lib/navigation';
import { CustomersInsights } from '@/features/insights/workspace-insights';
import { WorkspaceActivity } from '@/features/timeline/workspace-activity';
import { requireOrganization } from '@/lib/route/organization';
import { libraryNewImportHref } from '@/lib/route/library';

export const dynamic = 'force-dynamic';

/** A query value read as one string: the first if the URL repeated it. */
function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export default async function CustomersPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/crm/contacts'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const requestedPage = Number(single(query.page));
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const { db, organization } = await requireOrganization(organizationId);

  const [definitions, resolvedFeatures, stages] = await Promise.all([
    listFieldDefinitions(db, { organizationId, entityType: 'customer' }),
    organizationResolvedFeatureStates(db, { organizationId }),
    listCustomerStages(db, { organizationId }),
  ]);
  const modules = activeModuleKeys(resolvedFeatures);
  const salesEnabled = modules.has('reception');
  const relationshipBoardAvailable = areaAvailable('pipeline', {enabled:modules,capabilities:new Set(organization.capabilities),featureAvailability:availableFeatureKeys(resolvedFeatures)});
  // Insights is offered only where the reporting workspace is this business's and this role reads it.
  const mayInsight =
    areaAvailable('insights', {
      enabled: modules,
      capabilities: new Set(organization.capabilities),
      featureAvailability: availableFeatureKeys(resolvedFeatures),
    }) && organization.capabilities.includes('report.read');
  const visibleStages = salesEnabled ? stages : [];
  // The database refuses an import from a role without `integration.manage`; the button follows
  // the organization's own capability, never platform authority, and only when the module is on.
  const mayImport = modules.has('integrations') && organization.capabilities.includes('integration.manage');

  const industryDefinition = definitions.find((definition) => definition.key === INDUSTRY_FIELD_KEY);
  const choices = optionalColumnChoices(definitions);
  const validChoices = new Set(choices.map((choice) => choice.id));
  const view: CustomerDirectoryView = {
    search: single(query.q),
    contactType:single(query.contactType),
    companyId:single(query.companyId),
    sort:single(query.sort),
    group:single(query.group),
    lifecycle: single(query.lifecycle),
    temperature: single(query.temperature),
    stage: single(query.stage),
    industry: single(query.industry),
    website: single(query.website),
    optional: (Array.isArray(query.column) ? query.column : query.column ? [query.column] : []).filter((id) => validChoices.has(id)),
  };
  const companies=await listCompanies(db,organizationId);
  const filtered = Boolean(view.contactType || view.companyId || view.lifecycle || view.temperature || view.search || view.stage || view.industry || view.website);

  const customers = await listContactPage(db, {
    organizationId,
    filter: {
      search: view.search,
      contactType:['person','company','unspecified'].includes(view.contactType ?? '')?view.contactType as ContactType:undefined,
      companyId: view.companyId || undefined,
      sort:view.group==='company'||view.sort==='company'?'company':view.sort==='name'?'name':undefined,
      lifecycle: view.lifecycle === 'unclassified' ? 'unclassified' : CONTACT_LIFECYCLES.includes(view.lifecycle as ContactLifecycle) ? view.lifecycle as ContactLifecycle : undefined,
      temperature: LEAD_TEMPERATURES.includes(view.temperature as LeadTemperature) ? view.temperature as LeadTemperature : undefined,
      stageId: view.stage === 'unstaged' ? null : view.stage || undefined,
      industry: view.industry || undefined,
      website: view.website === 'with' || view.website === 'without' ? view.website : undefined,
      page,
    },
  });
  const [locationLabels,lastActivity] = await Promise.all([listContactLocationLabels(db, {
    organizationId,
    customerIds: customers.map((customer) => customer.id),
  }), listContactLastActivity(db,{organizationId,customerIds:customers.map(customer=>customer.id)})]);

  // Not `customers.total === 0` alone: a filter that matches nothing must keep the toolbar, or the
  // person has no way to change it.
  const emptyCollection = customers.total === 0 && !filtered;
  const mayCreate = organization.capabilities.includes('customer.create');

  const hrefFor = (target: number) => {
    const params = new URLSearchParams();
    for(const key of ['contactType','companyId','sort','group'] as const)if(view[key])params.set(key,view[key]);
    if (view.lifecycle) params.set('lifecycle', view.lifecycle);
    if (view.temperature) params.set('temperature', view.temperature);
    if (view.search) params.set('q', view.search);
    if (view.stage) params.set('stage', view.stage);
    if (view.industry) params.set('industry', view.industry);
    if (view.website) params.set('website', view.website);
    for (const id of view.optional) params.append('column', id);
    if (target > 1) params.set('page', String(target));
    const suffix = params.toString();
    return `/organizations/${organizationId}/crm/contacts${suffix ? `?${suffix}` : ''}`;
  };
  const lastPage = Math.max(1, Math.ceil(customers.total / CONTACT_PAGE_SIZE));

  return (
    <AppPage>
      <CreateCustomerSheetProvider organizationId={organizationId} definitions={definitions} initialType={query.type==='company'?'company':query.type==='person'?'person':''} defaultOpen={mayCreate && query.create === '1'}>
        <CollectionHeader
          location={{}}
          actions={!emptyCollection ? (
            <>
              {relationshipBoardAvailable ? <ButtonLink tone="secondary" href={`/organizations/${organizationId}/crm/contacts/stages`}>Relationship stages</ButtonLink> : null}
              {mayImport ? (
                <ButtonLink href={libraryNewImportHref(organizationId)} tone="secondary">
                  Import
                </ButtonLink>
              ) : null}
              {mayCreate ? <CreateCustomerTrigger /> : null}
            </>
          ) : undefined}
          activity={!emptyCollection}
          insights={mayInsight && !emptyCollection}
        />
        <SupportRegistrar mode="activity" title="Contact activity">
          <WorkspaceActivity
            db={db}
            organizationId={organizationId}
            timezone={organization.timezone}
            scope="customers"
            emptyMessage="No customer activity yet."
          />
        </SupportRegistrar>
        {mayInsight ? (
          <SupportRegistrar
            mode="insights"
            title="Contact insights"
          >
            <CustomersInsights
              db={db}
              organizationId={organizationId}
              today={todayInZone(organization.timezone)}
              salesEnabled={salesEnabled}
            />
          </SupportRegistrar>
        ) : null}
        {/* CRM configuration is reached from CRM's own sidebar group and Home Configure menu; this
            page has no configuration of its own to offer, so it registers no Configure panel. */}
        {emptyCollection ? (
          <section className="mt-6 rounded-lg border border-border bg-surface px-5 py-12 text-center" aria-labelledby="customers-empty-heading">
            <h2 id="customers-empty-heading" className="text-base font-semibold"><BusinessLabel>No contacts yet</BusinessLabel></h2>
            <p className="mx-auto mt-2 w-full max-w-lg text-sm text-muted">
              Add a person or company directly or bring existing contact records into this organization.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {mayCreate ? <CreateCustomerTrigger /> : null}
              {mayImport ? (
                <ButtonLink href={libraryNewImportHref(organizationId)} tone="secondary">
                  Import contacts
                </ButtonLink>
              ) : null}
            </div>
          </section>
        ) : (
          <>
          <div className="mt-4">
            <CustomerListToolbar
              organizationId={organizationId}
              stages={visibleStages}
              industries={industryDefinition?.options ?? []}
              choices={choices}
              view={view}
              companies={companies}
            />
          </div>
          <div className="mt-4">
          <CustomerTable
            organizationId={organizationId}
            customers={customers}
            groupByCompany={view.group==='company'}
            definitions={definitions}
            stages={visibleStages}
            locationLabels={locationLabels}
              lastActivity={lastActivity}
              timezone={organization.timezone}
            optional={view.optional}
            empty={filtered ? 'No contacts match these filters.' : 'No contacts yet.'}
          />
          </div>
          {customers.total > CONTACT_PAGE_SIZE ? (
            <nav aria-label="Contact pages" className="mt-4 flex items-center justify-between gap-3 text-sm text-muted">
              {page > 1 ? <ButtonLink href={hrefFor(page - 1)} tone="secondary">Previous</ButtonLink> : <span />}
              <span>Page {page} of {lastPage} · {customers.total} contacts</span>
              {page < lastPage ? <ButtonLink href={hrefFor(page + 1)} tone="secondary">Next</ButtonLink> : <span />}
            </nav>
          ) : null}
          </>
        )}
      </CreateCustomerSheetProvider>
    </AppPage>
  );
}
