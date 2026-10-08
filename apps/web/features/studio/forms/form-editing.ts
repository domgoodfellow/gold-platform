import { FORM_FIELD_TYPE_LABEL, FORM_MAX_FIELDS, newFieldId, newOptionValue, type FormDefinition, type FormField, type FormFieldType } from '@gold/schemas';

/**
 * The builder's edits to a definition as plain functions: each returns a new definition and never
 * changes a field's `id` once it exists. Ids are created here, once, from the label the author
 * first sees; renaming a label afterwards leaves the id alone, which is what keeps earlier answers
 * readable. Whether the result is acceptable is the schema's and the database's call, not this file's.
 */

function choiceOptions(): Array<{ value: string; label: string }> {
  const taken = new Set<string>();
  return [1, 2].map((n) => {
    const label = `Choice ${n}`;
    const value = newOptionValue(label, taken);
    taken.add(value);
    return { value, label };
  });
}

export function makeField(type: FormFieldType, taken: ReadonlySet<string>): FormField {
  const label = FORM_FIELD_TYPE_LABEL[type];
  const id = newFieldId(label, taken);
  switch (type) {
    case 'select':
    case 'radio':
    case 'checkbox':
      return { id, type, label, options: choiceOptions() };
    case 'consent':
      return { id, type, label: 'I agree to be contacted.', required: true };
    default:
      return { id, type, label } as FormField;
  }
}

export function addField(definition: FormDefinition, type: FormFieldType): { definition: FormDefinition; fieldId: string | null } {
  if (definition.fields.length >= FORM_MAX_FIELDS) return { definition, fieldId: null };
  const field = makeField(type, new Set(definition.fields.map((entry) => entry.id)));
  return { definition: { ...definition, fields: [...definition.fields, field] }, fieldId: field.id };
}

export function duplicateField(definition: FormDefinition, fieldId: string): { definition: FormDefinition; fieldId: string | null } {
  const index = definition.fields.findIndex((field) => field.id === fieldId);
  if (index < 0 || definition.fields.length >= FORM_MAX_FIELDS) return { definition, fieldId: null };
  const field = structuredClone(definition.fields[index]);
  field.id = newFieldId(field.label, new Set(definition.fields.map((entry) => entry.id)));
  const fields = [...definition.fields];
  fields.splice(index + 1, 0, field);
  return { definition: { ...definition, fields }, fieldId: field.id };
}

export function updateField(definition: FormDefinition, fieldId: string, next: FormField): FormDefinition {
  // The id is identity: whatever the inspector produced, it stays what it was.
  return { ...definition, fields: definition.fields.map((field) => (field.id === fieldId ? { ...next, id: fieldId } as FormField : field)) };
}

export function removeField(definition: FormDefinition, fieldId: string): FormDefinition {
  return { ...definition, fields: definition.fields.filter((field) => field.id !== fieldId) };
}

export function moveField(definition: FormDefinition, fieldId: string, delta: -1 | 1): FormDefinition {
  const from = definition.fields.findIndex((field) => field.id === fieldId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= definition.fields.length) return definition;
  const fields = [...definition.fields];
  [fields[from], fields[to]] = [fields[to], fields[from]];
  return { ...definition, fields };
}
