import { FieldSet, FieldLegend, FieldGroup } from '@gold/ui/components/field';
import { EntityFieldsConfiguration } from '@/features/custom-fields/configuration/entity-fields-configuration';
import { CapabilityVocabulary } from '@/features/resources/configuration/capability-vocabulary';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { ResourceCapability } from '@/lib/domain/resources/resource-capabilities';

export type ResourceConfigurationData = {
  organizationId: string;
  role: string;
  mayConfigure: boolean;
  definitions: FieldDefinition[];
  /** The whole vocabulary, archived included — this is where it is managed. */
  capabilities: ResourceCapability[];
};

/**
 * What a resource carries beyond its name: the capabilities a business gives its resources, and the custom fields.
 * The same component from the Resources page's Configure rail and Settings → Data & automation
 * (contract: one configuration surface, every host — the Work pattern, generalized).
 */
export function ResourceConfiguration({
  organizationId,
  role,
  mayConfigure,
  definitions,
  capabilities,
}: ResourceConfigurationData) {
  return (
    <div className="flex flex-col gap-8">
    <FieldSet>
      <FieldLegend>Skills</FieldLegend>
      <FieldGroup>
        <CapabilityVocabulary organizationId={organizationId} capabilities={capabilities} mayConfigure={mayConfigure} role={role} />
      </FieldGroup>
    </FieldSet>
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
    </div>
  );
}
