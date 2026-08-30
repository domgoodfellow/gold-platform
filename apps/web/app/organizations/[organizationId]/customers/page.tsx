import Link from 'next/link';
import { CustomFieldValues } from '@/components/custom-field-values';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { requireOrganization } from '@/lib/route/organization';
import { CreateCustomerForm } from './create-customer-form';

export const dynamic = 'force-dynamic';

export default async function CustomersPage({
  params,
}: PageProps<'/organizations/[organizationId]/customers'>) {
  const { organizationId } = await params;
  const { db } = await requireOrganization(organizationId);

  const customers = await listCustomers(db, { organizationId });
  const definitions = await listFieldDefinitions(db, {
    organizationId,
    entityType: 'customer',
  });

  return (
    <>
      {customers.length === 0 ? (
        <p className="mt-6 text-sm opacity-70">No customers yet.</p>
      ) : (
        <ul className="mt-6 divide-y divide-black/10 dark:divide-white/15">
          {customers.map((customer) => (
            <li key={customer.id} className="py-3">
              <Link
                href={`/organizations/${organizationId}/customers/${customer.id}`}
                className="font-medium underline underline-offset-4"
              >
                {customer.name}
              </Link>
              {customer.email || customer.phone ? (
                <div className="text-sm opacity-70">
                  {[customer.email, customer.phone].filter(Boolean).join(' · ')}
                </div>
              ) : null}
              <CustomFieldValues definitions={definitions} custom={customer.custom} />
            </li>
          ))}
        </ul>
      )}

      <CreateCustomerForm organizationId={organizationId} definitions={definitions} />
    </>
  );
}
