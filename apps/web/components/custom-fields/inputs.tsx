'use client';

import { TextInput } from '@/components/controls/inputs';
import {
  CUSTOM_FIELD_PREFIX,
  type CustomValues,
  type FieldDefinition,
} from '@/lib/domain/fields/field-definitions';

/**
 * The inputs for whatever fields a tenant has defined for one entity.
 *
 * Extracted at its second caller, not in anticipation: the customer form and the location
 * form need the identical mapping from field kind to input, and two copies would drift the
 * first time a kind is added.
 *
 * `required` here is the browser being helpful. The rule is re-checked by `parseCustom` in
 * the domain layer and again by `app.check_custom_fields` in the database, because a form
 * attribute is not a constraint.
 *
 * `values` arrived with the third caller — the work item edit form — and the component was
 * extended rather than copied, which is the rule D23 states for exactly this moment. An edit
 * form prefills; a create form passes nothing and gets the empty inputs it always had. A key
 * the registry no longer declares simply does not render, because `definitions` decides what
 * exists and the stored values only decide what they contain.
 */
export function CustomFieldInputs({
  definitions,
  values,
}: {
  definitions: FieldDefinition[];
  values?: CustomValues;
}) {
  return (
    <>
      {definitions.map((definition) => {
        const name = `${CUSTOM_FIELD_PREFIX}${definition.key}`;
        const value = values?.[definition.key];

        if (definition.kind === 'boolean') {
          return (
            <label key={definition.id} className="flex w-fit items-center gap-2 text-sm">
              <input name={name} type="checkbox" defaultChecked={value === true} />
              {definition.label}
            </label>
          );
        }

        return (
          <TextInput
            key={definition.id}
            name={name}
            type={definition.kind === 'number' ? 'number' : 'text'}
            step={definition.kind === 'number' ? 'any' : undefined}
            required={definition.required}
            defaultValue={value === undefined ? undefined : String(value)}
            placeholder={
              definition.required ? definition.label : `${definition.label} (optional)`
            }
            aria-label={definition.label}
            className="flex-1"
          />
        );
      })}
    </>
  );
}
