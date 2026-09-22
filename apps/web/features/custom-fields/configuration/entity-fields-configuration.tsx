import { DataTable } from '@/components/display/table';
import { Hint } from '@/components/controls/inputs';
import {
  CUSTOM_FIELD_ENTITY_LABELS,
  FIELD_KIND_LABELS,
  type CustomFieldEntity,
  type FieldDefinition,
} from '@/lib/domain/fields/field-definitions';
import { CreateFieldSheet } from './create-field-sheet';
import { EditFieldSheet } from './edit-field-sheet';

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
  const create = mayConfigure ? (
    <CreateFieldSheet organizationId={organizationId} entityType={entityType} />
  ) : undefined;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Hint weight="subtle">
          {definitions.length} {definitions.length === 1 ? 'field' : 'fields'} configured.
        </Hint>
        {create}
      </div>
      <div className="mt-4">
        <DataTable
          rows={definitions}
          rowKey={(definition) => definition.id}
          empty={`No custom fields for ${CUSTOM_FIELD_ENTITY_LABELS[entityType]} yet.`}
          columns={[
            {
              key: 'field',
              header: 'Field',
              emphasis: 'primary',
              cell: (definition) => (
                <div>
                  <div>{definition.label}</div>
                  <code className="text-xs text-subtle">{definition.key}</code>
                </div>
              ),
            },
            { key: 'type', header: 'Type', cell: (definition) => FIELD_KIND_LABELS[definition.kind] },
            { key: 'required', header: 'Required', cell: (definition) => (definition.required ? 'Yes' : 'No') },
          ]}
          actions={
            mayConfigure
              ? (definition) => <EditFieldSheet organizationId={organizationId} definition={definition} />
              : undefined
          }
        />
      </div>
      {!mayConfigure ? (
        <Hint className="mt-4">Your role, {role}, cannot define fields here.</Hint>
      ) : null}
    </div>
  );
}
