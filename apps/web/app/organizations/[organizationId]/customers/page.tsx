import { AppPage } from '@/components/containers/app-page';
import { ConfigureRegistrar } from '@/components/containers/configure-registrar';
import { SupportRegistrar } from '@/components/containers/support-registrar';
import { PageHeader } from '@/components/containers/page-header';
import { ButtonLink } from '@/components/controls/button';
import {
  CreateCustomerSheetProvider,
  CreateCustomerTrigger,
} from '@/features/crm/customers/create-customer-sheet';
import { CustomerConfiguration } from '@/features/crm/customers/customer-configuration';
import { CustomerListToolbar } from '@/features/crm/customers/customer-list-toolbar';
import { CustomerTable } from '@/features/crm/customers/customer-table';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listCustomerStages } from '@/lib/domain/customers/stages';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { activeModuleKeys, availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { areaAvailable, areaHref, areaLabel, workspaceAncestry } from '@/lib/navigation';
import { CustomersInsights } from '@/features/insights/workspace-insights';
import { WorkspaceActivity } from '@/features/timeline/workspace-activity';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function CustomersPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/customers'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const search = Array.isArray(query.q) ? query.q[0] ?? '' : query.q ?? '';
  const stage = Array.isArray(query.stage) ? query.stage[0] ?? '' : query.stage ?? '';
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
  const customers = await listCustomers(db, {
    organizationId,
    search,
    stageId: stage === 'unstaged' ? null : stage || undefined,
  });
  const emptyCollection = customers.total === 0 && !search && !stage;

  return (
    <AppPage>
      <CreateCustomerSheetProvider organizationId={organizationId} definitions={definitions}>
        <PageHeader
          title={areaLabel('customers')}
          crumbs={workspaceAncestry(organizationId, 'customers')}
          description="People and businesses this organization works for."
          actions={!emptyCollection ? (
            <>
              {mayImport ? (
                <ButtonLink href={`/organizations/${organizationId}/integrations/imports/new`} tone="secondary">
                  Import
                </ButtonLink>
              ) : null}
              <CreateCustomerTrigger />
            </>
          ) : undefined}
          activity={!emptyCollection}
          insights={mayInsight && !emptyCollection}
          configure={mayConfigure && !emptyCollection}
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
            href={`${areaHref(organizationId, 'insights')}/reports?of=invoiced_and_incurred&by=customer&period=month`}
            hrefLabel="Full report"
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
            <h2 id="customers-empty-heading" className="text-base font-semibold">No customers yet</h2>
            <p className="mx-auto mt-2 w-full max-w-lg text-sm text-muted">
              Add a customer directly or bring existing customer records into this organization.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <CreateCustomerTrigger />
              {mayImport ? (
                <ButtonLink href={`/organizations/${organizationId}/integrations/imports/new`} tone="secondary">
                  Import customers
                </ButtonLink>
              ) : null}
            </div>
          </section>
        ) : (
          <>
          <CustomerListToolbar organizationId={organizationId} stages={visibleStages} search={search} stage={stage} />
          <div className="mt-4">
          <CustomerTable
            organizationId={organizationId}
            customers={customers}
            definitions={definitions}
            stages={visibleStages}
            empty={search || stage ? 'No customers match these filters.' : 'No customers yet.'}
          />
          </div>
          </>
        )}
      </CreateCustomerSheetProvider>
    </AppPage>
  );
}
