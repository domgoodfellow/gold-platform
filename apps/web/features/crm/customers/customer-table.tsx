import { classificationLabel } from '@/lib/domain/customers/classification';
import { BusinessLabel } from '@/lib/context/business-vocabulary';
import Link from 'next/link';
import { DataTable, type Column } from '@/components/display/table';
import { readValue } from '@/features/custom-fields/values';
import type { Contact } from '@/lib/domain/contacts/contacts';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { CustomerStage } from '@/lib/domain/customers/stages';
import { formatPhoneForDisplay } from '@/lib/display/phone';

/** The field whose value is the directory's Industry column; it is always shown, so it is not offered as an extra. */
export const INDUSTRY_FIELD_KEY = 'industry';

/**
 * The directory's optional custom columns, by id. Name, lifecycle, temperature, phone and email are core; each optional id is `custom:<key>`
 * for a field this business defines. Chosen per view in the URL, never stored.
 */
export function optionalColumnChoices(definitions: FieldDefinition[]): { id: string; label: string }[] {
  return [
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
}) {
  if(groupByCompany && customers.length){
    const groups=new Map<string,{label:string;companyId:string|null;rows:Contact[]}>();
    for(const contact of customers){const key=contact.companyId ?? 'unaffiliated';const group=groups.get(key) ?? {label:contact.companyName ?? 'No company affiliation',companyId:contact.companyId ?? null,rows:[]};group.rows.push(contact);groups.set(key,group);}
    return <div className="space-y-6"><p className="text-sm text-muted">Companies and people on this page. Each person retains their own record.</p>{[...groups.entries()].map(([key,group])=><section key={key}><h2 className="mb-2 text-base font-semibold">{group.companyId?<Link href={`/organizations/${organizationId}/crm/contacts/${group.companyId}`} className="underline">{group.label}</Link>:group.label}</h2><CustomerTable organizationId={organizationId} customers={group.rows} definitions={definitions} stages={stages} locationLabels={locationLabels} optional={optional} lastActivity={lastActivity} timezone={timezone} empty={empty}/></section>)}</div>;
  }
  const stageNames = new Map(stages.map((stage) => [stage.id, stage.name]));
  const extra = new Set(optional);

  const columns: Column<Contact>[] = [
    {
      key: 'name',
      header: 'Name',
      emphasis: 'primary',
      cell: (customer) => (
        <Link
          href={`/organizations/${organizationId}/crm/contacts/${customer.id}`}
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
      key: 'email',
      header: 'Email',
      cell: customer => customer.email ? <a className="break-all underline" href={`mailto:${customer.email}`}>{customer.email}</a> : MISSING,
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
    {key:'type',header:'Type',cell:contact=>contact.contactType==='person'?'Person':contact.contactType==='company'?'Company':'Needs classification'},
    {key:'company',header:'Company',cell:contact=>contact.companyId?<Link className="underline" href={`/organizations/${organizationId}/crm/contacts/${contact.companyId}`}>{contact.companyName}</Link>:MISSING},
    { key: 'lifecycle', header: 'Lifecycle', cell: customer => classificationLabel(customer.lifecycle) },
    { key: 'temperature', header: 'Temperature', cell: customer => classificationLabel(customer.leadTemperature ?? 'unrated') },
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
