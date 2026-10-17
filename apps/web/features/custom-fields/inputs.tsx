'use client';

import { useId } from 'react';
import { Checkbox } from '@gold/ui/components/checkbox';
import { FieldSet, FieldLegend } from '@gold/ui/components/field';
import { SelectInput, TextInput, FieldLabel } from '@/components/controls/inputs';
import { CheckboxField } from '@/components/controls/checkbox-field';
import { FormField } from '@/components/controls/form';
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
 * extended rather than copied, which is the rule the UI system states for exactly this moment. An edit
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
      {definitions.map((definition) => (
        <CustomFieldInput key={definition.id} definition={definition} value={values?.[definition.key]} />
      ))}
    </>
  );
}

function CustomFieldInput({
  definition,
  value,
}: {
  definition: FieldDefinition;
  value: CustomValues[string] | undefined;
}) {
  const id = useId();
  const name = `${CUSTOM_FIELD_PREFIX}${definition.key}`;

  if (definition.kind === 'boolean') {
    return <CheckboxField id={id} name={name} label={definition.label} defaultChecked={value === true} />;
  }

  if (definition.kind === 'select') {
    // **An empty option first, and it is not decoration.** A dropdown with no blank preselects
    // its first choice, so every row would silently carry the first option whether or not
    // anybody looked at the field — the platform answering on the business's behalf, which is
    // the thing it may not do. A required field still has the blank; the browser refuses to
    // submit it, which is the honest version.
    //
    // A stored value the field no longer offers is added back as its own option, so editing a
    // row keeps what it holds instead of quietly changing it to something else. It reads
    // as-is, because the business's own word is what was stored.
    const stored = typeof value === 'string' ? value : undefined;
    const choices =
      stored !== undefined && !definition.options.includes(stored) ? [...definition.options, stored] : definition.options;

    return (
      <FormField id={id} label={definition.label} optional={!definition.required}>
        {(field) => (
          <SelectInput {...field} name={name} required={definition.required} defaultValue={stored ?? ''}>
            <option value="">
              {definition.required ? definition.label : `${definition.label} (optional)`}
            </option>
            {choices.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectInput>
        )}
      </FormField>
    );
  }

  if (definition.kind === 'multi_select') {
    const stored = Array.isArray(value) ? value : [];
    const choices = [...definition.options, ...stored.filter((option) => !definition.options.includes(option))];

    return (
      <FieldSet className="gap-1">
        {/* A legend, not `FieldLabel` — a label points at one control and these are several. */}
        <FieldLegend variant="label">
          {definition.required ? definition.label : `${definition.label} (optional)`}
        </FieldLegend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {choices.map((option, index) => {
            const optionId = `${id}-${index}`;
            return (
              <div key={option} className="flex items-center gap-2">
                {/* No `required` on any box. HTML applies it to each one individually, so a
                    group of four required checkboxes would mean *tick all four* — the opposite
                    of the rule. `parseCustom` refuses an empty required list instead. */}
                <Checkbox id={optionId} name={name} value={option} defaultChecked={stored.includes(option)} />
                <FieldLabel htmlFor={optionId} className="font-normal">
                  {option}
                </FieldLabel>
              </div>
            );
          })}
        </div>
      </FieldSet>
    );
  }

  return (
    <FormField id={id} label={definition.label} optional={!definition.required}>
      {(field) => (
        <TextInput
          {...field}
          name={name}
          type={definition.kind === 'number' ? 'number' : definition.kind === 'date' ? 'date' : 'text'}
          step={definition.kind === 'number' ? 'any' : undefined}
          required={definition.required}
          defaultValue={value === undefined ? undefined : String(value)}
        />
      )}
    </FormField>
  );
}
