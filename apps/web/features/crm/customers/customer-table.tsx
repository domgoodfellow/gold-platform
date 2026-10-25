import { classificationLabel } from '@/lib/domain/customers/classification';
import { BusinessLabel } from '@/lib/context/business-vocabulary';
import Link from 'next/link';
import { DataTable, type Column } from '@/components/display/table';
import { readValue } from '@/features/custom-fields/values';
import type { Contact } from '@/lib/domain/contacts/contacts';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { CustomerStage } from '@/lib/domain/customers/stages';
import { formatPhoneForDisplay } from '@/lib/display/phone';
import { Building2, CircleHelp, User } from 'lucide-react';
import { EntityIdentity } from '@/components/display/entity-row';

const IDENTITY = { person: { Icon: User, label: 'Person' }, company: { Icon: Building2, label: 'Company' }, unspecified: { Icon: CircleHelp, label: 'Needs classification' } } as const;

/** The field whose value is the directory's Industry column; it is always shown, so it is not offered as an extra. */
export const INDUSTRY_FIELD_KEY = 'industry';

/**
 * The directory's optional custom columns, by id. Name, lifecycle, temperature, phone and email are core; each optional id is `custom:<key>`
 * for a field this business defines. Chosen per view in the URL, never stored.
 */
export function optionalColumnChoices(definitions: FieldDefinition[]): { id: string; label: string }[] {
  return [
    { id: 'core:temperature', label: 'Lead temperature' },
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
  groupByCompany=false,
  customers,
  definitions,
  stages = [],
  locationLabels,
  optional = [],
  lastActivity = {},
  timezone = 'UTC',
  empty = 'No contacts yet.',
  inGroup = false,
}: {
  organizationId: string;
  groupByCompany?:boolean;
  customers: Contact[];
  definitions: FieldDefinition[];
  stages?: CustomerStage[];
  /** Contact id to the first recorded location's text. Absent means none is recorded. */
  locationLabels: Record<string, string>;
  /** Ids from `optionalColumnChoices` that the view has asked to show. */
  optional?: string[];
  lastActivity?: Record<string,string>;
  timezone?: string;
  empty?: string;
  /** Rendered inside a company group, where the company is the heading. */
  inGroup?: boolean;
}) {
  if (groupByCompany && customers.length) {
    // Each contact appears once: a company heads its own group, a person sits under their one primary
    // company, and people without one — and records still needing classification — keep their own groups.
    const groups = new Map<string, { label: string; companyId: string | null; rows: Contact[] }>();
    const add = (key: string, label: string, companyId: string | null, contact: Contact, first = false) => {
      const group = groups.get(key) ?? { label, companyId, rows: [] };
      if (first) { group.label = label; group.rows.unshift(contact); } else group.rows.push(contact);
      groups.set(key, group);
    };
    for (const contact of customers) {
      if (contact.contactType === 'company') add(contact.id, contact.name, contact.id, contact, true);
      else if (contact.contactType === 'person' && contact.companyId) add(contact.companyId, contact.companyName ?? 'Company', contact.companyId, contact);
      else if (contact.contactType === 'person') add('~none', 'No company', null, contact);
      else add('~review', 'Needs classification', null, contact);
    }
      // Page order (company name when grouped) is kept; the two special groups go last.
    const ordered = [...groups.entries()].sort(([a], [b]) => Number(a.startsWith('~')) - Number(b.startsWith('~')));
    return <div className="flex flex-col gap-6">{ordered.map(([key, group]) => <section key={key} aria-label={group.label} className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold">{group.companyId ? <><Building2 aria-hidden className="size-4 text-muted" /><Link href={`/organizations/${organizationId}/crm/contacts/${group.companyId}`} className="hover:underline">{group.label}</Link></> : group.label}<span className="font-normal tabular-nums text-muted">{group.rows.length}</span></h2>
      <CustomerTable organizationId={organizationId} customers={group.rows} definitions={definitions} stages={stages} locationLabels={locationLabels} optional={optional} lastActivity={lastActivity} timezone={timezone} empty={empty} inGroup />
    </section>)}</div>;
  }
  const stageNames = new Map(stages.map((stage) => [stage.id, stage.name]));
  const extra = new Set(optional);

  const columns: Column<Contact>[] = [
    {
      key: 'name',
      header: 'Contact',
      emphasis: 'primary',
      cell: (customer) => {
        const identity = IDENTITY[customer.contactType ?? 'unspecified'] ?? IDENTITY.unspecified;
        // Inside a company group the company is already the heading, so the secondary line names the type.
        const secondary = customer.contactType === 'person' && customer.companyName && !inGroup ? customer.companyName : identity.label;
        return <EntityIdentity icon={identity.Icon} kind={identity.label} name={customer.name} href={`/organizations/${organizationId}/crm/contacts/${customer.id}`} secondary={secondary} className="max-w-[32ch]" />;
      },
    },
    {
      key: 'phone',
      header: 'Phone',
      // The link dials the stored value. Only the visible text is regrouped.
      cell: (customer) =>
        customer.phone ? (
          <a href={`tel:${customer.phone}`} className="whitespace-nowrap hover:underline">
            {formatPhoneForDisplay(customer.phone)}
          </a>
        ) : MISSING,
    },
    {
      key: 'email',
      header: 'Email',
      cell: customer => customer.email ? <a className="break-all hover:underline" href={`mailto:${customer.email}`}>{customer.email}</a> : MISSING,
    },
    {
      key: 'last-activity',
      header: 'Last activity',
      cell: customer => lastActivity[customer.id] ? new Intl.DateTimeFormat('en-CA',{timeZone:timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(lastActivity[customer.id])) : <span className="text-subtle">No visible activity</span>,
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

  columns.splice(1, 0,
    { key: 'lifecycle', header: 'Lifecycle', cell: customer => customer.lifecycle ? classificationLabel(customer.lifecycle) : <span className="text-subtle">Unclassified</span> },
    ...(extra.has('core:temperature') ? [{ key: 'temperature', header: 'Temperature', cell: (customer: Contact) => classificationLabel(customer.leadTemperature ?? 'unrated') }] : []),
  );

  if (stages.length > 0) {
    columns.push({
      key: 'relationship',
      header: 'Relationship',
      cell: (customer) =>
        customer.stageId ? stageNames.get(customer.stageId) ?? 'Unknown stage' : <span className="text-subtle">No stage</span>,
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
