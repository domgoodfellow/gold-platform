import { FieldSet, FieldLegend, FieldGroup } from '@gold/ui/components/field';
import { Hint } from '@/components/controls/inputs';
import { EntityFieldsConfiguration } from '@/features/custom-fields/configuration/entity-fields-configuration';
import { StageSettingsSheet } from '@/features/crm/sales/stage-settings-sheet';
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

/**
 * What a customer carries beyond its name, and — when Communications/Voice is on — the pipeline
 * a relationship moves through. The same component from the Customers page's Configure rail and
 * Settings → Data & automation (contract: one configuration surface, every host — the Work
 * pattern, generalized). Its two concerns are stacked sections, not tabs: Configure is one
 * surface's contextual configuration, and a stack needs no nested navigation. Pipeline reuses `StageSettingsSheet`, the same trigger the Pipeline
 * board's own header already offers, rather than a second stage-editing surface.
 */
export function CustomerConfiguration({
  organizationId,
  role,
  mayConfigure,
  definitions,
  stages,
  salesEnabled,
}: CustomerConfigurationData) {
  return (
    <div className="flex flex-col gap-8">
      <FieldSet>
        <FieldLegend>Custom fields on a customer</FieldLegend>
        <FieldGroup>
          <EntityFieldsConfiguration
            organizationId={organizationId}
            entityType="customer"
            role={role}
            mayConfigure={mayConfigure}
            definitions={definitions}
          />
        </FieldGroup>
      </FieldSet>

      {salesEnabled ? (
        <FieldSet>
          <FieldLegend>Sales stages</FieldLegend>
          <FieldGroup>
            <Hint>The stages a relationship moves through, in order.</Hint>
            <StageSettingsSheet
              organizationId={organizationId}
              stages={stages}
              mayConfigure={mayConfigure}
              role={role}
            />
          </FieldGroup>
        </FieldSet>
      ) : null}
    </div>
  );
}
