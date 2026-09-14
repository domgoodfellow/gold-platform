import Link from 'next/link';
import { AppPage } from '@/components/containers/app-page';
import { ConfigureRegistrar } from '@/components/containers/configure-registrar';
import { PageChromeRegistrar } from '@/components/containers/workspace-page-chrome';
import { Hint } from '@/components/controls/inputs';
import {
  CreateCustomerSheetProvider,
  CreateCustomerTrigger,
} from '@/features/crm/customers/create-customer-sheet';
import { CustomerConfiguration } from '@/features/customers/configuration/customer-configuration';
import { CustomerListToolbar } from '@/features/crm/customers/customer-list-toolbar';
import { CustomerTable } from '@/features/crm/customers/customer-table';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listCustomerStages } from '@/lib/domain/customers/stages';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { activeModuleKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
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
        <PageChromeRegistrar
          title="Customers"
          actions={
            <>
              {salesEnabled ? (
                <Link
                  href={`/organizations/${organizationId}/customers/pipeline`}
                  className="text-sm underline underline-offset-4"
                >
                  Pipeline
                </Link>
              ) : null}
              <CreateCustomerTrigger />
            </>
          }
        />
        {mayConfigure ? (
          <ConfigureRegistrar
            title="Customers configuration"
            settingsHref={`/organizations/${organizationId}/settings/data-automation`}
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
        <Hint>People and businesses this organization works for.</Hint>

        <div className="mt-6">
          <CustomerListToolbar organizationId={organizationId} stages={visibleStages} search={search} stage={stage} mayImport={modules.has('integrations')} />
        </div>

        <div className="mt-4">
          <CustomerTable
            organizationId={organizationId}
            customers={customers}
            definitions={definitions}
            stages={visibleStages}
            empty={search || stage ? 'No customers match these filters.' : 'No customers yet.'}
            emptyAction={search || stage ? undefined : <CreateCustomerTrigger />}
          />
        </div>
      </CreateCustomerSheetProvider>
    </AppPage>
  );
}
