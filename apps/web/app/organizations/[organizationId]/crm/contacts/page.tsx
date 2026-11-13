import { BusinessLabel } from '@/lib/context/business-vocabulary';
import { AppPage } from '@/components/layout/app-page';
import { SupportRegistrar } from '@/components/panels/support-registrar';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { ButtonLink } from '@/components/controls/button';
import { AddContactsTrigger, ContactIntakeProvider } from '@/features/crm/intake/contact-intake';
import { anyIntake, contactIntakeOptions } from '@/lib/application/crm/contact-intake';
import {
  directoryHref,
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
  listContactLastActivity,
} from '@/lib/domain/contacts/contacts';
import { listCustomerStages } from '@/lib/domain/customers/stages';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { activeModuleKeys, availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { areaAvailable } from '@/lib/navigation';
import { CustomersInsights } from '@/features/insights/workspace-insights';
import { WorkspaceActivity } from '@/features/timeline/workspace-activity';
import { notFound } from 'next/navigation';
import { requireOrganization } from '@/lib/route/organization';
import { directoryFilter, directoryFiltered } from '@/lib/application/crm/contact-directory';
import { callListAvailable } from '@/lib/application/communications/call-list';
import { AddToListMenu } from '@/features/communications/voice/add-to-list-menu';
import { ContactSelection, ContactSelectionBar } from '@/features/crm/customers/contact-selection';

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
  // Contacts are `customer.read`; the database withholds them too, this refuses before reading anything.
  if (!organization.capabilities.includes('customer.read')) notFound();

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
  // Adding, importing and synchronizing are offered through one intake dialog; each path follows the
  // capability its destination enforces (`contactIntakeOptions`). Library's file import needs
  // `integration.manage` alone; the Integrations module governs provider Connections, not file imports.
  const intake = await contactIntakeOptions(db, { organizationId, capabilities: organization.capabilities, modules });
  const mayIntake = anyIntake(intake);

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
    added: single(query.added) === '30d' ? '30d' : undefined,
    review: single(query.review) === '1' ? '1' : undefined,
    archived: single(query.archived) === '1' ? '1' : undefined,
    optional: (Array.isArray(query.column) ? query.column : query.column ? [query.column] : []).filter((id) => validChoices.has(id)),
  };
  const companies=await listCompanies(db,organizationId);
  const filtered = directoryFiltered(view);

  const customers = await listContactPage(db, {
    organizationId,
    filter: { ...directoryFilter(view), page },
  });
  const [locationLabels,lastActivity] = await Promise.all([listContactLocationLabels(db, {
    organizationId,
    customerIds: customers.map((customer) => customer.id),
  }), listContactLastActivity(db,{organizationId,customerIds:customers.map(customer=>customer.id)})]);

  // Not `customers.total === 0` alone: a filter that matches nothing must keep the toolbar, or the
  // person has no way to change it.
  const emptyCollection = customers.total === 0 && !filtered;
  const mayCreate = organization.capabilities.includes('customer.create');
  // Add to (the Dialer's call list) is offered only where the business has the Dialer and this member may manage
  // tasks, and never over archived contacts.
  const mayAddToList = !emptyCollection && !view.archived && customers.total > 0 && await callListAvailable(db, organization);
  // The view as the URL states it, without the display-only column choice, so Add to reaches exactly who the filters match.
  const directoryView = { ...view, optional: undefined };

  const hrefFor = (target: number) => directoryHref(organizationId, view, { page: String(target) });
  const lastPage = Math.max(1, Math.ceil(customers.total / CONTACT_PAGE_SIZE));

  return (
    <AppPage>
      <ContactIntakeProvider organizationId={organizationId} definitions={definitions} options={intake} initialType={query.type==='company'?'company':query.type==='person'?'person':''} defaultOpen={mayCreate && query.create === '1'} initialImport={query.import === '1'} initialAccountId={single(query.connection)} oauthError={single(query.oauth_error)}>
        <CollectionHeader
          location={{}}
          actions={!emptyCollection ? (
            <>
              {relationshipBoardAvailable ? <ButtonLink tone="secondary" href={`/organizations/${organizationId}/crm/contacts/stages`}>Relationship stages</ButtonLink> : null}
              {mayAddToList ? <AddToListMenu organizationId={organizationId} target={{ view: directoryView }} /> : null}
              {mayIntake ? <AddContactsTrigger /> : null}
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
              {mayIntake ? <AddContactsTrigger /> : null}
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
          <ContactSelection pageIds={mayAddToList ? customers.map((customer) => customer.id) : []}>
          {mayAddToList ? <ContactSelectionBar organizationId={organizationId} /> : null}
          <CustomerTable
            organizationId={organizationId}
            customers={customers}
            groupByCompany={view.group==='company'}
            reviewMode={view.review === '1'}
            definitions={definitions}
            stages={visibleStages}
            locationLabels={locationLabels}
              lastActivity={lastActivity}
              timezone={organization.timezone}
            optional={view.optional}
            empty={filtered ? 'No contacts match these filters.' : 'No contacts yet.'}
            selectable={mayAddToList}
          />
          </ContactSelection>
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
      </ContactIntakeProvider>
    </AppPage>
  );
}
