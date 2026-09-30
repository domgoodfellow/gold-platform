import {
  CUSTOM_FIELD_ENTITIES,
  type CustomFieldEntity,
} from '@/lib/domain/fields/field-definitions';

/** The URL has one canonical fallback: Customers. */
export function resolveFieldEntity(raw: string | undefined): CustomFieldEntity {
  return (CUSTOM_FIELD_ENTITIES as readonly string[]).includes(raw ?? '')
    ? (raw as CustomFieldEntity)
    : 'customer';
}
