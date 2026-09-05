import Link from 'next/link';
import { Disclosure } from '@/components/containers/card';
import { CustomFieldValues } from '@/components/custom-fields/values';
import { DataTable } from '@/components/display/table';
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
      {/* **The form is available, not permanent.** It used to render below the list, so a
          business with forty customers ended its customer screen with a create form and the
          answer to *what is on this page* was whatever fitted above it. Open by default when
          there is nothing to list, because then the form is the screen. */}
      <Disclosure summary="Add a customer" defaultOpen={customers.length === 0} className="mt-6">
        <CreateCustomerForm organizationId={organizationId} definitions={definitions} />
      </Disclosure>

      <div className="mt-6">
        <DataTable
          rows={customers}
          rowKey={(customer) => customer.id}
          empty="No customers yet."
          columns={[
            {
              key: 'name',
              header: 'Name',
              emphasis: 'primary',
              cell: (customer) => (
                <Link
                  href={`/organizations/${organizationId}/customers/${customer.id}`}
                  className="underline underline-offset-4"
                >
                  {customer.name}
                </Link>
              ),
            },
            {
              key: 'contact',
              header: 'Contact',
              cell: (customer) =>
                customer.email || customer.phone ? (
                  // Stacked rather than joined by a separator: an address and a number are two
                  // things somebody copies one at a time, and a middle dot between them is
                  // picked up by a double-click.
                  <div className="flex flex-col">
                    {customer.email ? <span>{customer.email}</span> : null}
                    {customer.phone ? <span className="text-muted">{customer.phone}</span> : null}
                  </div>
                ) : (
                  <span className="text-subtle">—</span>
                ),
            },
            // This business's own fields, in its own order. Secondary because a business with
            // six custom fields would otherwise have a six-column table nobody can read — they
            // stay in full on the card rendering, which is where there is room for them.
            ...(definitions.length > 0
              ? [
                  {
                    key: 'custom',
                    header: 'Details',
                    emphasis: 'secondary' as const,
                    cell: (customer: (typeof customers)[number]) => (
                      <CustomFieldValues definitions={definitions} custom={customer.custom} />
                    ),
                  },
                ]
              : []),
          ]}
        />
      </div>
    </>
  );
}
