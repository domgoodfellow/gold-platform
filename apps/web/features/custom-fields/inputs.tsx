'use client';

import { SelectInput, TextInput } from '@/components/controls/inputs';
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
 *
 * **Three kinds landed here at once and each needed a different shape of control**, which is
 * what the first version of this file predicted when it said two copies would drift the first
 * time a kind was added. `select` is a dropdown, `date` is the browser's own date input, and
 * `multi_select` is a group of checkboxes sharing one name — the only control here that sends
 * its name more than once, which is the reason `customValuesFromFormData` had to learn what a
 * repeated name means.
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

        if (definition.kind === 'select') {
          // **An empty option first, and it is not decoration.** A dropdown with no blank
          // preselects its first choice, so every row would silently carry the first option
          // whether or not anybody looked at the field — the platform answering on the
          // business's behalf, which is the thing it may not do. A required field still has
          // the blank; the browser refuses to submit it, which is the honest version.
          //
          // A stored value the field no longer offers is added back as its own option, so
          // editing a row keeps what it holds instead of quietly changing it to something
          // else. It reads as-is, because the business's own word is what was stored.
          const stored = typeof value === 'string' ? value : undefined;
          const choices =
            stored !== undefined && !definition.options.includes(stored)
              ? [...definition.options, stored]
              : definition.options;

          return (
            <SelectInput
              key={definition.id}
              name={name}
              required={definition.required}
              defaultValue={stored ?? ''}
              aria-label={definition.label}
              className="flex-1"
            >
              <option value="">
                {definition.required ? definition.label : `${definition.label} (optional)`}
              </option>
              {choices.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </SelectInput>
          );
        }

        if (definition.kind === 'multi_select') {
          const stored = Array.isArray(value) ? value : [];
          const choices = [
            ...definition.options,
            ...stored.filter((option) => !definition.options.includes(option)),
          ];

          // No `required` on the boxes. HTML applies it to each one individually, so a group
          // of four required checkboxes means *tick all four* — the opposite of the rule.
          // `parseCustom` refuses an empty required list, which is where that rule lives.
          return (
            <fieldset key={definition.id} className="flex flex-col gap-1">
              {/* A legend rather than `FieldLabel`, which renders a `<label>`. A label points
                  at one control and these are several — the group's name is a legend, and a
                  screen reader reads it before each box because of it. */}
              <legend className="text-sm font-medium">
                {definition.required ? definition.label : `${definition.label} (optional)`}
              </legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {choices.map((option) => (
                  <label key={option} className="flex items-center gap-2 text-sm">
                    <input
                      name={name}
                      type="checkbox"
                      value={option}
                      defaultChecked={stored.includes(option)}
                    />
                    {option}
                  </label>
                ))}
              </div>
            </fieldset>
          );
        }

        return (
          <TextInput
            key={definition.id}
            name={name}
            type={
              definition.kind === 'number'
                ? 'number'
                : definition.kind === 'date'
                  ? 'date'
                  : 'text'
            }
            step={definition.kind === 'number' ? 'any' : undefined}
            required={definition.required}
            defaultValue={value === undefined ? undefined : String(value)}
            // A date input renders its own placeholder and ignores this one, so the label has
            // to reach a screen reader through `aria-label` alone — which it already did.
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
