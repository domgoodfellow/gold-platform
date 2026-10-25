import type {
  CustomValues,
  FieldDefinition,
} from '@/lib/domain/fields/field-definitions';

/** Rendered exactly as stored — formatting a date would pick a locale, and the raw spelling is unambiguous to everyone. */
export function readValue(value: CustomValues[string]): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

/** Driven by field definitions, not by the keys present in `custom` — a value left behind by a deleted field renders nothing. */
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
      {present.map((definition) => (
        <div key={definition.id} className="flex gap-1">
          <dt>{definition.label}:</dt>
          <dd>{readValue(custom[definition.key])}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The same values as labelled rows for a `DefinitionList`: each field its own label and value, so a
 * record's custom data reads as data rather than as one long sentence.
 */
export function CustomFieldDetails({ definitions, custom }: { definitions: FieldDefinition[]; custom: CustomValues }) {
  return <>{definitions.filter(definition => custom[definition.key] !== undefined && custom[definition.key] !== '').map(definition => (
    <div key={definition.id} className="contents">
      <dt className="text-sm text-subtle">{definition.label}</dt>
      <dd className="text-sm break-words">{readValue(custom[definition.key])}</dd>
    </div>
  ))}</>;
}
