import { DividedList, EmptyState } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { ItemDescription } from '@gold/ui/components/item';
import { CreateFieldForm, EditFieldForm } from '@/app/organizations/[organizationId]/fields/create-field-form';
import type { CustomFieldEntity, FieldDefinition } from '@/lib/domain/fields/field-definitions';

export type EntityFieldsConfigurationData = {
  organizationId: string;
  entityType: CustomFieldEntity;
  role: string;
  mayConfigure: boolean;
  definitions: FieldDefinition[];
};

/**
 * One entity's custom fields — list, edit, define. Extracted from Work's own Fields tab so it is
 * the same component wherever a business defines fields on customer/location/resource/asset/work
 * item, rather than a second implementation per screen: Settings → Data & automation loops this
 * once per entity, and an entity's own workspace scopes it to the one entity, on the Work
 * Configure-rail pattern generalized (contract: one configuration surface, every host).
 */
export function EntityFieldsConfiguration({
  organizationId,
  entityType,
  role,
  mayConfigure,
  definitions,
}: EntityFieldsConfigurationData) {
  return (
    <div>
      {definitions.length === 0 ? (
        <EmptyState>
          No custom fields yet. Anything you define here appears on this entity&rsquo;s form.
        </EmptyState>
      ) : (
        <DividedList>
          {definitions.map((definition) => (
            <li key={definition.id}>
              {mayConfigure ? (
                <EditFieldForm organizationId={organizationId} definition={definition} />
              ) : (
                <div className="py-3">
                  <div className="text-sm font-medium">{definition.label}</div>
                  <ItemDescription>{definition.key}</ItemDescription>
                </div>
              )}
            </li>
          ))}
        </DividedList>
      )}
      {mayConfigure ? (
        <CreateFieldForm organizationId={organizationId} entityType={entityType} />
      ) : (
        <Hint className="mt-4">Your role, {role}, cannot define fields here.</Hint>
      )}
    </div>
  );
}
