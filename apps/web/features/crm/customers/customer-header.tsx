import Link from 'next/link';
import { Building2, CircleHelp, Mail, Phone, User } from 'lucide-react';
import { classificationLabel } from '@/lib/domain/customers/classification';
import { formatPhoneForDisplay } from '@/lib/display/phone';
import { RecordHeader } from '@/components/headers/record-header';
import { StatusSummary } from '@/components/display/status-summary';
import type { Contact } from '@/lib/domain/contacts/contacts';
import type { CustomerStage } from '@/lib/domain/customers/stages';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { CallCustomerSheet } from './customer-action-sheets';
import { EditContactDialog } from './edit-contact-dialog';
import { AddToListMenu, type CallListStanding } from '@/features/communications/voice/add-to-list-menu';

const TYPE = { person: { label: 'Person', Icon: User }, company: { label: 'Company', Icon: Building2 }, unspecified: { label: 'Needs classification', Icon: CircleHelp } } as const;

/**
 * The record's identity and quick actions. The name comes from the location bar (ADR-047), so this
 * shows what it is: identity type, company, the independent classifications as labelled chips, and
 * the primary ways to reach them. Call keeps its own surface; Edit opens the focused dialog.
 */
export function CustomerHeader({ organizationId, customer, stage, definitions, stages, mayEdit, mayCall, openEditOn, callList }: {
  organizationId: string; customer: Contact; stage: CustomerStage | null; definitions: FieldDefinition[]; stages: CustomerStage[]; mayEdit: boolean; mayCall: boolean;
  /** This contact's standing on the call list; absent when the business has no Dialer or the member may not manage tasks. */
  callList?: CallListStanding;
  /** Open the edit dialog on load, on this section (a Needs review link). */
  openEditOn?: 'identity' | 'relationship';
}) {
  const type = TYPE[customer.contactType ?? 'unspecified'] ?? TYPE.unspecified;
  const temperatureRelevant = customer.lifecycle === 'lead' || (customer.leadTemperature && customer.leadTemperature !== 'unrated');
  return (
    <RecordHeader
      location={{ records: { contactId: { state: 'ready', label: customer.name } } }}
      summary={<div className="flex flex-col gap-2">
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground"><type.Icon aria-hidden className="size-4 text-muted" />{type.label}</span>
          {customer.companyId ? <Link href={`/organizations/${organizationId}/crm/contacts/${customer.companyId}`} className="inline-flex items-center gap-1.5 hover:underline"><Building2 aria-hidden className="size-4" />{customer.companyName}</Link> : null}
          {customer.email ? <a href={`mailto:${customer.email}`} className="inline-flex items-center gap-1.5 hover:underline"><Mail aria-hidden className="size-4" />{customer.email}</a> : null}
          {customer.phone ? <a href={`tel:${customer.phone}`} className="inline-flex items-center gap-1.5 hover:underline"><Phone aria-hidden className="size-4" />{formatPhoneForDisplay(customer.phone)}</a> : null}
        </p>
        <StatusSummary label="Classification" items={[
          { label: 'Lifecycle', value: classificationLabel(customer.lifecycle) },
          ...(temperatureRelevant ? [{ label: 'Temperature', value: classificationLabel(customer.leadTemperature ?? 'unrated') }] : []),
          ...(stages.length ? [{ label: 'Relationship stage', value: stage?.name ?? 'None' }] : []),
        ]} />
      </div>}
      actions={<>{mayCall ? <CallCustomerSheet organizationId={organizationId} customer={customer} /> : null}{callList ? <AddToListMenu organizationId={organizationId} target={{ customerIds: [customer.id] }} standing={callList} /> : null}{mayEdit ? <EditContactDialog organizationId={organizationId} customer={customer} definitions={definitions} stages={stages} defaultOpen={Boolean(openEditOn)} initialSection={openEditOn ?? 'identity'} /> : null}</>}
    />
  );
}
