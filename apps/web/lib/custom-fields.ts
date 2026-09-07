import { CUSTOM_FIELD_PREFIX, type CustomInput } from '@/lib/domain/fields/field-definitions';

/**
 * Pull the custom field values out of a submitted form. Transport decoding only — which keys
 * are legal and what they coerce to is `parseCustom`'s job against the tenant's registry.
 * A repeated name (a checkbox group) becomes a list rather than being collapsed to the last one.
 */
export function customValuesFromFormData(formData: FormData): CustomInput {
  const custom: CustomInput = {};

  for (const [name, value] of formData.entries()) {
    if (!name.startsWith(CUSTOM_FIELD_PREFIX) || typeof value !== 'string') continue;

    const key = name.slice(CUSTOM_FIELD_PREFIX.length);
    const seen = custom[key];

    if (seen === undefined) {
      custom[key] = value;
    } else if (Array.isArray(seen)) {
      seen.push(value);
    } else {
      custom[key] = [seen, value];
    }
  }

  return custom;
}
