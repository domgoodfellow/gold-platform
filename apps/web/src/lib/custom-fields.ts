import { CUSTOM_FIELD_PREFIX } from '@/lib/domain/fields/field-definitions';

/**
 * Pull the custom field values out of a submitted form.
 *
 * Transport decoding, not a business rule: which keys are legal, what they coerce to and
 * which are required are all decided by `parseCustom` against the tenant's registry. This
 * only undoes the prefix the form put on.
 *
 * Extracted at its second caller — the customer action and the location action — so the
 * prefix convention is applied in one place rather than spelled out in each.
 */
export function customValuesFromFormData(formData: FormData): Record<string, string> {
  const custom: Record<string, string> = {};

  for (const [name, value] of formData.entries()) {
    if (name.startsWith(CUSTOM_FIELD_PREFIX) && typeof value === 'string') {
      custom[name.slice(CUSTOM_FIELD_PREFIX.length)] = value;
    }
  }

  return custom;
}
