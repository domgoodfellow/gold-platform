import { DomainError } from '@/lib/domain/errors';
import { CUSTOM_FIELD_ENTITIES } from '@/lib/domain/fields/field-definitions';
import type { BusinessShape } from './configure';

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');
const rows = (value: unknown, check: (item: Record<string, unknown>) => boolean): boolean => Array.isArray(value) && value.every((item) => record(item) && check(item));

/** Structural boundary for untrusted documents. Values remain each canonical owner's rules. */
export function readBusinessShape(value: unknown): BusinessShape {
  const valid = record(value)
    && typeof value.typeName === 'string' && typeof value.schedulable === 'boolean'
    && strings(value.statuses)
    && Array.isArray(value.transitions) && value.transitions.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every((index) => Number.isInteger(index)))
    && record(value.fields) && Object.entries(value.fields).every(([entity, fields]) =>
      (CUSTOM_FIELD_ENTITIES as readonly string[]).includes(entity) && rows(fields, (field) => typeof field.key === 'string' && typeof field.label === 'string' && typeof field.kind === 'string' && typeof field.required === 'boolean' && (field.options === undefined || strings(field.options))))
    && rows(value.prices, (price) => typeof price.name === 'string' && typeof price.unit === 'string' && Number.isSafeInteger(price.amountMinor))
    && rows(value.hours, (hour) => Number.isInteger(hour.dayOfWeek) && typeof hour.opensAt === 'string' && typeof hour.closesAt === 'string')
    && rows(value.roles, (role) => typeof role.name === 'string' && strings(role.capabilities))
    && (value.modules === undefined || strings(value.modules))
    && (value.featureKeys === undefined || strings(value.featureKeys))
    && (value.automations === undefined || rows(value.automations, (rule) => typeof rule.name === 'string' && typeof rule.on === 'string' && Number.isInteger(rule.moveTo)))
    && (value.voice === undefined || (record(value.voice) && typeof value.voice.tagline === 'string' && typeof value.voice.intro === 'string'))
    && (value.brand === undefined || (record(value.brand) && typeof value.brand.accent === 'string' && typeof value.brand.headingFont === 'string' && typeof value.brand.bodyFont === 'string'));
  if (!valid) throw new DomainError('This setup document is malformed. Review its fields before saving or applying it.', 'configuration.shape_invalid');
  return value as BusinessShape;
}
