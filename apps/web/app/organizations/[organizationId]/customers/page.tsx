import Link from 'next/link';
import { AppPage } from '@/components/containers/app-page';
import { Disclosure } from '@/components/containers/card';
import { Hint } from '@/components/controls/inputs';
import { CreateCustomerForm } from '@/features/crm/customers/create-customer-form';
import { CustomerTable } from '@/features/crm/customers/customer-table';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listUsableModules } from '@/lib/domain/tenancy/modules';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function CustomersPage({
  params,
}: PageProps<'/organizations/[organizationId]/customers'>) {
  const { organizationId } = await params;
  const { db } = await requireOrganization(organizationId);

  const [customers, definitions, modules] = await Promise.all([
    listCustomers(db, { organizationId }),
    listFieldDefinitions(db, { organizationId, entityType: 'customer' }),
    listUsableModules(db, { organizationId }),
  ]);

  return (
    <AppPage width="wide">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Hint>People and businesses this organization works for.</Hint>
        {/* CRM/Sales's own canonical board — a Communications/Voice module switches this on,
            since `reception` is the runtime module backing both, but the board itself belongs
            here, not to Calls. */}
        {modules.has('reception') ? (
          <Link
            href={`/organizations/${organizationId}/customers/pipeline`}
            className="text-sm underline underline-offset-4"
          >
            Pipeline →
          </Link>
        ) : null}
      </div>

      {/* **The form is available, not permanent.** It used to render below the list, so a
          business with forty customers ended its customer screen with a create form and the
          answer to *what is on this page* was whatever fitted above it. Open by default when
          there is nothing to list, because then the form is the screen. */}
      <Disclosure summary="Add a customer" tone="primary" defaultOpen={customers.length === 0} className="mt-5">
        <CreateCustomerForm organizationId={organizationId} definitions={definitions} />
      </Disclosure>

      <div className="mt-6">
        <CustomerTable organizationId={organizationId} customers={customers} definitions={definitions} />
      </div>
    </AppPage>
  );
}
