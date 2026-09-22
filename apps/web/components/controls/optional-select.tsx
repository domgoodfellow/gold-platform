'use client';

import { SelectInput } from '@/components/controls/inputs';
export type SelectOption = { id: string; label: string };

/** The empty option submits `""`, which the domain layer converts to `null` — not a valid uuid. */
export function OptionalSelect({
  id,
  name,
  label,
  options,
  value,
}: {
  /** Wire this to an external, visible `FieldLabel`'s `htmlFor` instead of the internal aria-label. */
  id?: string;
  name: string;
  label: string;
  options: SelectOption[];
  value?: string | null;
}) {
  return (
    <SelectInput
      id={id}
      name={name}
      defaultValue={value ?? ''}
      aria-label={id ? undefined : label}
      className="flex-1"
    >
      <option value="">{label} — none</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </SelectInput>
  );
}
