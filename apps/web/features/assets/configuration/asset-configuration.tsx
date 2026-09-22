import { FieldSet, FieldLegend, FieldGroup } from '@gold/ui/components/field';
import { EntityFieldsConfiguration } from '@/features/custom-fields/configuration/entity-fields-configuration';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';

export type AssetConfigurationData = {
  organizationId: string;
  role: string;
  mayConfigure: boolean;
  definitions: FieldDefinition[];
};

/**
 * What an asset carries beyond its name — the one thing to configure about Assets today. The
 * same component from the Assets page's Configure rail and Settings → Data & automation
 * (contract: one configuration surface, every host — the Work pattern, generalized).
 */
export function AssetConfiguration({
  organizationId,
  role,
  mayConfigure,
  definitions,
}: AssetConfigurationData) {
  return (
    <FieldSet>
      <FieldLegend>Custom fields on an asset</FieldLegend>
      <FieldGroup>
        <EntityFieldsConfiguration
          organizationId={organizationId}
          entityType="asset"
          role={role}
          mayConfigure={mayConfigure}
          definitions={definitions}
        />
      </FieldGroup>
    </FieldSet>
  );
}
