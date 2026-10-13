import { ButtonLink } from '@/components/controls/button';
import { configTarget } from '@/lib/navigation';
import { Hint } from '@/components/controls/inputs';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { CustomerStage } from '@/lib/domain/customers/stages';

export type CustomerConfigurationData = {
  organizationId: string;
  role: string;
  mayConfigure: boolean;
  definitions: FieldDefinition[];
  stages: CustomerStage[];
  salesEnabled: boolean;
};

/** Operating pages link to CRM's canonical configuration editors. */
export function CustomerConfiguration({ organizationId, mayConfigure, salesEnabled }: CustomerConfigurationData) {
 return <div className="space-y-4">{mayConfigure ? <><ButtonLink tone="text" href={`/organizations/${organizationId}/${configTarget('customer-fields').path}`}>Customer fields</ButtonLink>{salesEnabled ? <ButtonLink tone="text" href={`/organizations/${organizationId}/${configTarget('sales-stages').path}`}>Relationship stages</ButtonLink> : null}</> : <Hint>Your role cannot configure CRM fields or stages.</Hint>}</div>;
}
