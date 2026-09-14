import { FieldSet, FieldLegend, FieldGroup } from '@gold/ui/components/field';
import { EntityFieldsConfiguration } from '@/features/fields/entity-fields-configuration';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';

export type ResourceConfigurationData = {
  organizationId: string;
  role: string;
  mayConfigure: boolean;
  definitions: FieldDefinition[];
};

/**
 * What a resource carries beyond its name — the one thing to configure about Resources today.
 * The same component from the Resources page's Configure rail and Settings → Data & automation
 * (contract: one configuration surface, every host — the Work pattern, generalized).
 */
export function ResourceConfiguration({
  organizationId,
  role,
  mayConfigure,
  definitions,
}: ResourceConfigurationData) {
  return (
    <FieldSet>
      <FieldLegend>Custom fields on a resource</FieldLegend>
      <FieldGroup>
        <EntityFieldsConfiguration
          organizationId={organizationId}
          entityType="resource"
          role={role}
          mayConfigure={mayConfigure}
          definitions={definitions}
        />
      </FieldGroup>
    </FieldSet>
  );
}
