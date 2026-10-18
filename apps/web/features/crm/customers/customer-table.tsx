import { BusinessLabel } from '@/lib/context/business-vocabulary';
import Link from 'next/link';
import { DataTable, type Column } from '@/components/display/table';
import { readValue } from '@/features/custom-fields/values';
import type { Customer } from '@/lib/domain/customers/customers';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { CustomerStage } from '@/lib/domain/customers/stages';
import { formatPhoneForDisplay } from '@/lib/display/phone';

/** The field whose value is the directory's Industry column; it is always shown, so it is not offered as an extra. */
export const INDUSTRY_FIELD_KEY = 'industry';

/**
 * The directory's optional columns, by id. `email` is built in; every other id is `custom:<key>`
 * for a field this business defines. Chosen per view in the URL, never stored.
 */
export function optionalColumnChoices(definitions: FieldDefinition[]): { id: string; label: string }[] {
  return [
    { id: 'email', label: 'Email' },
    ...definitions
      .filter((definition) => definition.key !== INDUSTRY_FIELD_KEY)
      .map((definition) => ({ id: `custom:${definition.key}`, label: definition.label })),
  ];
}

const MISSING = <span className="text-subtle">—</span>;

/**
 * Who this business serves, and how to reach each one. Name, phone, industry, location and
 * relationship are the working columns; anything else is opt-in per view, so a business with many
 * custom fields gets a readable table, and the full record stays on the customer's own page.
 *
 * A dash means nothing was recorded. It is never a guess.
 */
export function CustomerTable({
  organizationId,
  customers,
  definitions,
  stages = [],
  locationLabels,
  optional = [],
  empty = 'No customers yet.',
}: {
  organizationId: string;
  customers: Customer[];
  definitions: FieldDefinition[];
  stages?: CustomerStage[];
  /** Customer id to the first recorded location's text. Absent means none is recorded. */
  locationLabels: Record<string, string>;
  /** Ids from `optionalColumnChoices` that the view has asked to show. */
  optional?: string[];
  empty?: string;
}) {
  const stageNames = new Map(stages.map((stage) => [stage.id, stage.name]));
  const extra = new Set(optional);

  const columns: Column<Customer>[] = [
    {
      key: 'name',
      header: 'Name',
      emphasis: 'primary',
      cell: (customer) => (
        <Link
          href={`/organizations/${organizationId}/customers/${customer.id}`}
          className="inline-block max-w-[34ch] whitespace-normal wrap-break-word underline underline-offset-4"
        >
          {customer.name}
        </Link>
      ),
    },
    {
      key: 'phone',
      header: 'Phone',
      // The link dials the stored value. Only the visible text is regrouped.
      cell: (customer) =>
        customer.phone ? (
          <a href={`tel:${customer.phone}`} className="whitespace-nowrap underline underline-offset-4">
            {formatPhoneForDisplay(customer.phone)}
          </a>
        ) : MISSING,
    },
    {
      key: 'industry',
      header: 'Industry',
      cell: (customer) => {
        const value = customer.custom[INDUSTRY_FIELD_KEY];
        return value === undefined || value === '' ? MISSING : readValue(value);
      },
    },
    {
      key: 'location',
      header: 'Location',
      cell: (customer) => locationLabels[customer.id] ?? MISSING,
    },
  ];

  if (stages.length > 0) {
    columns.push({
      key: 'relationship',
      header: 'Relationship',
      cell: (customer) =>
        customer.stageId ? stageNames.get(customer.stageId) ?? 'Unknown stage' : <span className="text-subtle">No stage</span>,
    });
  }

  if (extra.has('email')) {
    columns.push({
      key: 'email',
      header: 'Email',
      cell: (customer) => (customer.email ? <span className="break-all">{customer.email}</span> : MISSING),
    });
  }

  for (const definition of definitions) {
    if (definition.key === INDUSTRY_FIELD_KEY || !extra.has(`custom:${definition.key}`)) continue;
    columns.push({
      key: `custom:${definition.key}`,
      header: definition.label,
      cell: (customer) => {
        const value = customer.custom[definition.key];
        return value === undefined || value === '' ? MISSING : readValue(value);
      },
    });
  }

  return (
    <DataTable
      rows={customers}
      rowKey={(customer) => customer.id}
      empty={<BusinessLabel>{empty}</BusinessLabel>}
      columns={columns}
    />
  );
}
