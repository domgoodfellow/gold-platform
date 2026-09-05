import type {
  CustomValues,
  FieldDefinition,
} from '@/lib/domain/fields/field-definitions';

/**
 * The custom values one row carries, labelled from the registry.
 *
 * Extracted at its third caller — customers, locations and resources all render the same
 * thing. Driven by the definitions rather than by the keys present in `custom`, so a value
 * left behind by a field that no longer exists is not rendered as a nameless string.
 */
export function CustomFieldValues({
  definitions,
  custom,
}: {
  definitions: FieldDefinition[];
  custom: CustomValues;
}) {
  const present = definitions.filter(
    (definition) => custom[definition.key] !== undefined,
  );

  if (present.length === 0) {
    return null;
  }

  return (
    <dl className="mt-1 flex flex-wrap gap-x-4 text-sm text-muted">
      {present.map((definition) => {
        const value = custom[definition.key];
        return (
          <div key={definition.id} className="flex gap-1">
            <dt>{definition.label}:</dt>
            <dd>{typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value}</dd>
          </div>
        );
      })}
    </dl>
  );
}
