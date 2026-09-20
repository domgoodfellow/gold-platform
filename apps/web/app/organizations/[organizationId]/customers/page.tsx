import { AppPage } from '@/components/containers/app-page';
import { ConfigureRegistrar } from '@/components/containers/configure-registrar';
import { PageHeader } from '@/components/containers/page-header';
import { ButtonLink } from '@/components/controls/button';
import { ConfigureTrigger } from '@/components/containers/workspace-right-rail';
import {
  CreateCustomerSheetProvider,
  CreateCustomerTrigger,
} from '@/features/crm/customers/create-customer-sheet';
import { CustomerConfiguration } from '@/features/customers/configuration/customer-configuration';
import { CustomerListToolbar } from '@/features/crm/customers/customer-list-toolbar';
import { CustomersViewNav } from '@/features/crm/customers/customers-view-nav';
import { CustomerTable } from '@/features/crm/customers/customer-table';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listCustomerStages } from '@/lib/domain/customers/stages';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { activeModuleKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { areaLabel } from '@/lib/navigation';
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
  const visibleStages = salesEnabled ? stages : [];
  const mayConfigure = organization.capabilities.includes('field.manage');
  const customers = await listCustomers(db, {
    organizationId,
    search,
    stageId: stage === 'unstaged' ? null : stage || undefined,
  });

  return (
    <AppPage width="wide">
      <CreateCustomerSheetProvider organizationId={organizationId} definitions={definitions}>
        <PageHeader
          title={areaLabel('customers')}
          description="People and businesses this organization works for."
          actions={
            <>
              {mayConfigure ? <ConfigureTrigger /> : null}
              {modules.has('integrations') ? (
                <ButtonLink href={`/organizations/${organizationId}/integrations/imports/new`} tone="secondary">
                  Import
                </ButtonLink>
              ) : null}
              <CreateCustomerTrigger />
            </>
          }
        />
        {mayConfigure ? (
          <ConfigureRegistrar
            title="Customers configuration"
            settingsHref={`/organizations/${organizationId}/fields`}
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
        {salesEnabled ? <CustomersViewNav organizationId={organizationId} current="list" /> : null}
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
      </CreateCustomerSheetProvider>
    </AppPage>
  );
}
