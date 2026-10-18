import { BusinessLabel } from '@/lib/context/business-vocabulary';
import { AppPage } from '@/components/layout/app-page';
import { ConfigureRegistrar } from '@/components/panels/configure-registrar';
import { SupportRegistrar } from '@/components/panels/support-registrar';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { ButtonLink } from '@/components/controls/button';
import {
  CreateCustomerSheetProvider,
  CreateCustomerTrigger,
} from '@/features/crm/customers/create-customer-sheet';
import { CustomerConfiguration } from '@/features/crm/customers/customer-configuration';
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
  CUSTOMER_PAGE_SIZE,
  listCustomerLocationLabels,
  listCustomerPage,
} from '@/lib/domain/customers/customers';
import { listCustomerStages } from '@/lib/domain/customers/stages';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { activeModuleKeys, availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { areaAvailable, areaLabel, workspaceAncestry } from '@/lib/navigation';
import { CustomersInsights } from '@/features/insights/workspace-insights';
import { WorkspaceActivity } from '@/features/timeline/workspace-activity';
import { requireOrganization } from '@/lib/route/organization';
import { libraryNewImportHref } from '@/lib/route/library';

export const dynamic = 'force-dynamic';

/** A query value read as one string: the first if the URL repeated it. */
function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export default async function CustomersPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/customers'>) {
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
  // Insights is offered only where the reporting workspace is this business's and this role reads it.
  const mayInsight =
    areaAvailable('insights', {
      enabled: modules,
      capabilities: new Set(organization.capabilities),
      featureAvailability: availableFeatureKeys(resolvedFeatures),
    }) && organization.capabilities.includes('report.read');
  const visibleStages = salesEnabled ? stages : [];
  const mayConfigure = organization.capabilities.includes('field.manage');
  // The database refuses an import from a role without `integration.manage`; the button follows
  // the organization's own capability, never platform authority, and only when the module is on.
  const mayImport = modules.has('integrations') && organization.capabilities.includes('integration.manage');

  const industryDefinition = definitions.find((definition) => definition.key === INDUSTRY_FIELD_KEY);
  const choices = optionalColumnChoices(definitions);
  const validChoices = new Set(choices.map((choice) => choice.id));
  const view: CustomerDirectoryView = {
    search: single(query.q),
    stage: single(query.stage),
    industry: single(query.industry),
    website: single(query.website),
    optional: (Array.isArray(query.column) ? query.column : query.column ? [query.column] : []).filter((id) => validChoices.has(id)),
  };
  const filtered = Boolean(view.search || view.stage || view.industry || view.website);

  const customers = await listCustomerPage(db, {
    organizationId,
    filter: {
      search: view.search,
      stageId: view.stage === 'unstaged' ? null : view.stage || undefined,
      industry: view.industry || undefined,
      website: view.website === 'with' || view.website === 'without' ? view.website : undefined,
      page,
    },
  });
  const locationLabels = await listCustomerLocationLabels(db, {
    organizationId,
    customerIds: customers.map((customer) => customer.id),
  });

  // Not `customers.total === 0` alone: a filter that matches nothing must keep the toolbar, or the
  // person has no way to change it.
  const emptyCollection = customers.total === 0 && !filtered;
  const mayCreate = organization.capabilities.includes('customer.create');

  const hrefFor = (target: number) => {
    const params = new URLSearchParams();
    if (view.search) params.set('q', view.search);
    if (view.stage) params.set('stage', view.stage);
    if (view.industry) params.set('industry', view.industry);
    if (view.website) params.set('website', view.website);
    for (const id of view.optional) params.append('column', id);
    if (target > 1) params.set('page', String(target));
    const suffix = params.toString();
    return `/organizations/${organizationId}/customers${suffix ? `?${suffix}` : ''}`;
  };
  const lastPage = Math.max(1, Math.ceil(customers.total / CUSTOMER_PAGE_SIZE));

  return (
    <AppPage>
      <CreateCustomerSheetProvider organizationId={organizationId} definitions={definitions} defaultOpen={mayCreate && query.create === '1'}>
        <CollectionHeader
          title={areaLabel('customers')}
          crumbs={workspaceAncestry(organizationId, 'customers')}
          actions={!emptyCollection ? (
            <>
              {mayImport ? (
                <ButtonLink href={libraryNewImportHref(organizationId)} tone="secondary">
                  Import
                </ButtonLink>
              ) : null}
              <CreateCustomerTrigger />
            </>
          ) : undefined}
          activity={!emptyCollection}
          insights={mayInsight && !emptyCollection}
          configure={mayConfigure}
        />
        <SupportRegistrar mode="activity" title="Customer activity">
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
            title="Customer insights"
          >
            <CustomersInsights
              db={db}
              organizationId={organizationId}
              today={todayInZone(organization.timezone)}
              salesEnabled={salesEnabled}
            />
          </SupportRegistrar>
        ) : null}
        {mayConfigure ? (
          <ConfigureRegistrar
            title="Customers configuration"
            settingsHref={`/organizations/${organizationId}/settings/custom-fields`}
          >
            <CustomerConfiguration
              organizationId={organizationId}
              role={organization.role}
              mayConfigure={mayConfigure}
              definitions={definitions}
              stages={stages}
              salesEnabled={salesEnabled}
            />
          </ConfigureRegistrar>
        ) : null}
        {emptyCollection ? (
          <section className="mt-6 rounded-lg border border-border bg-surface px-5 py-12 text-center" aria-labelledby="customers-empty-heading">
            <h2 id="customers-empty-heading" className="text-base font-semibold"><BusinessLabel>No customers yet</BusinessLabel></h2>
            <p className="mx-auto mt-2 w-full max-w-lg text-sm text-muted">
              Add a customer directly or bring existing customer records into this organization.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <CreateCustomerTrigger />
              {mayImport ? (
                <ButtonLink href={libraryNewImportHref(organizationId)} tone="secondary">
                  Import customers
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
            />
          </div>
          <div className="mt-4">
          <CustomerTable
            organizationId={organizationId}
            customers={customers}
            definitions={definitions}
            stages={visibleStages}
            locationLabels={locationLabels}
            optional={view.optional}
            empty={filtered ? 'No customers match these filters.' : 'No customers yet.'}
          />
          </div>
          {customers.total > CUSTOMER_PAGE_SIZE ? (
            <nav aria-label="Customer pages" className="mt-4 flex items-center justify-between gap-3 text-sm text-muted">
              {page > 1 ? <ButtonLink href={hrefFor(page - 1)} tone="secondary">Previous</ButtonLink> : <span />}
              <span>Page {page} of {lastPage} · {customers.total} customers</span>
              {page < lastPage ? <ButtonLink href={hrefFor(page + 1)} tone="secondary">Next</ButtonLink> : <span />}
            </nav>
          ) : null}
          </>
        )}
      </CreateCustomerSheetProvider>
    </AppPage>
  );
}
