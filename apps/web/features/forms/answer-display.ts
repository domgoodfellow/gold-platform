import { formatPhoneForDisplay } from '@/lib/display/phone';
import type { FormDefinition } from '@gold/schemas';

/** A stored answer as words, read against the field it answered. Shared by every screen that shows one. */
export function displayAnswer(field: FormDefinition['fields'][number] | undefined, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (field && 'options' in field) {
    const label = (key: unknown) => field.options.find((option) => option.value === key)?.label ?? String(key);
    return Array.isArray(value) ? value.map(label).join(', ') : label(value);
  }
  if (field?.type === 'phone' && typeof value === 'string') return formatPhoneForDisplay(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}
