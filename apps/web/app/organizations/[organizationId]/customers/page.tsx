import Link from 'next/link';
import { AppPage } from '@/components/containers/app-page';
import { PageHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { CreateCustomerSheet } from '@/features/crm/customers/create-customer-sheet';
import { CustomerListToolbar } from '@/features/crm/customers/customer-list-toolbar';
import { CustomerTable } from '@/features/crm/customers/customer-table';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listCustomerStages } from '@/lib/domain/customers/stages';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listUsableModules } from '@/lib/domain/tenancy/modules';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function CustomersPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/customers'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const search = Array.isArray(query.q) ? query.q[0] ?? '' : query.q ?? '';
  const stage = Array.isArray(query.stage) ? query.stage[0] ?? '' : query.stage ?? '';
  const { db } = await requireOrganization(organizationId);

  const [definitions, modules, stages] = await Promise.all([
    listFieldDefinitions(db, { organizationId, entityType: 'customer' }),
    listUsableModules(db, { organizationId }),
    listCustomerStages(db, { organizationId }),
  ]);
  const salesEnabled = modules.has('reception');
  const visibleStages = salesEnabled ? stages : [];
  const customers = await listCustomers(db, {
    organizationId,
    search,
    stageId: stage === 'unstaged' ? null : stage || undefined,
  });

  return (
    <AppPage width="wide">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <PageHeading>Customers</PageHeading>
          <Hint className="mt-1">People and businesses this organization works for.</Hint>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {salesEnabled ? <Link href={`/organizations/${organizationId}/customers/pipeline`} className="text-sm underline underline-offset-4">Pipeline</Link> : null}
          <CreateCustomerSheet organizationId={organizationId} definitions={definitions} defaultOpen={customers.total === 0 && !search && !stage} />
        </div>
      </header>

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
        />
      </div>
    </AppPage>
  );
}
