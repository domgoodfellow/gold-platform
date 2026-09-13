import Link from 'next/link';
import { DataTable } from '@/components/display/table';
import { CustomFieldValues } from '@/features/custom-fields/values';
import type { Customer } from '@/lib/domain/customers/customers';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';

/**
 * Who this business serves, and how to reach each one. The customer list's own canonical
 * rendering — extracted so the same table this route composes today is what a future search or
 * filter toolbar (`ui-spec.md` §16) would extend, rather than markup that route owns alone.
 */
export function CustomerTable({
  organizationId,
  customers,
  definitions,
}: {
  organizationId: string;
  customers: Customer[];
  definitions: FieldDefinition[];
}) {
  return (
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
                cell: (customer: Customer) => (
                  <CustomFieldValues definitions={definitions} custom={customer.custom} />
                ),
              },
            ]
          : []),
      ]}
    />
  );
}
