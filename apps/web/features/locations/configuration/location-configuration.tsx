import { FieldSet, FieldLegend, FieldGroup } from '@gold/ui/components/field';
import { EntityFieldsConfiguration } from '@/features/fields/entity-fields-configuration';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';

export type LocationConfigurationData = {
  organizationId: string;
  role: string;
  mayConfigure: boolean;
  definitions: FieldDefinition[];
};

/**
 * What a location carries beyond its address — the one thing to configure about Locations today.
 * The same component from the Locations page's Configure rail and Settings → Data & automation
 * (contract: one configuration surface, every host — the Work pattern, generalized).
 */
export function LocationConfiguration({
  organizationId,
  role,
  mayConfigure,
  definitions,
}: LocationConfigurationData) {
  return (
    <FieldSet>
      <FieldLegend>Custom fields on a location</FieldLegend>
      <FieldGroup>
        <EntityFieldsConfiguration
          organizationId={organizationId}
          entityType="location"
          role={role}
          mayConfigure={mayConfigure}
          definitions={definitions}
        />
      </FieldGroup>
    </FieldSet>
  );
}
