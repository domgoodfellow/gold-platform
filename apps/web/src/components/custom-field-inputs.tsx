'use client';

import {
  CUSTOM_FIELD_PREFIX,
  type FieldDefinition,
} from '@/lib/domain/fields/field-definitions';

const INPUT_CLASS = 'flex-1 rounded border border-black/15 px-3 py-2 dark:border-white/20';

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
 */
export function CustomFieldInputs({ definitions }: { definitions: FieldDefinition[] }) {
  return (
    <>
      {definitions.map((definition) => {
        const name = `${CUSTOM_FIELD_PREFIX}${definition.key}`;

        if (definition.kind === 'boolean') {
          return (
            <label key={definition.id} className="flex w-fit items-center gap-2 text-sm">
              <input name={name} type="checkbox" />
              {definition.label}
            </label>
          );
        }

        return (
          <input
            key={definition.id}
            name={name}
            type={definition.kind === 'number' ? 'number' : 'text'}
            step={definition.kind === 'number' ? 'any' : undefined}
            required={definition.required}
            placeholder={
              definition.required ? definition.label : `${definition.label} (optional)`
            }
            aria-label={definition.label}
            className={INPUT_CLASS}
          />
        );
      })}
    </>
  );
}
