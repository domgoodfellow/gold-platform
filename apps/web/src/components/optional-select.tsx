'use client';

export type SelectOption = { id: string; label: string };

/**
 * A select for an optional reference — a customer, a location, a resource, an asset.
 *
 * Extracted at its second caller. The empty option submits `""`, which the domain layer
 * turns into `null` before it reaches Postgres, because an empty string is not a uuid and
 * "not set" has to mean not set rather than a parse error.
 */
export function OptionalSelect({
  name,
  label,
  options,
}: {
  name: string;
  label: string;
  options: SelectOption[];
}) {
  return (
    <select
      name={name}
      defaultValue=""
      aria-label={label}
      className="flex-1 rounded border border-black/15 px-3 py-2 dark:border-white/20"
    >
      <option value="">{label} — none</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
