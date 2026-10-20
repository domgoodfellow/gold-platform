import { RecordHeader } from '@/components/headers/record-header';
import type { Customer } from '@/lib/domain/customers/customers';
import type { CustomerStage } from '@/lib/domain/customers/stages';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { CallCustomerSheet, EditCustomerSheet } from './customer-action-sheets';

export function CustomerHeader({ organizationId, customer, stage, definitions, stages, mayEdit, mayCall }: {
  organizationId: string;
  customer: Customer;
  stage: CustomerStage | null;
  definitions: FieldDefinition[];
  stages: CustomerStage[];
  mayEdit: boolean;
  mayCall: boolean;
}) {
  return (
    <RecordHeader
      // The resolver owns this route's location (ADR-047); the page supplies only the name it was allowed to read.
      location={{ records: { customerId: { state: 'ready', label: customer.name } } }}
      summary={stage ? `Relationship stage: ${stage.name}` : 'No relationship stage'}
      actions={<>{mayCall ? <CallCustomerSheet organizationId={organizationId} customer={customer} /> : null}{mayEdit ? <EditCustomerSheet organizationId={organizationId} customer={customer} definitions={definitions} stages={stages} /> : null}</>}
    />
  );
}
