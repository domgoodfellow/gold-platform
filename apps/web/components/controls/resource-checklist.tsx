'use client';

import { useId } from 'react';
import type { SelectOption } from '@/components/controls/optional-select';

/**
 * Who takes part: a fieldset of real checkboxes, so it is keyboard operable, announced as a group
 * with its legend, and says what is chosen by state rather than by colour. Nothing chosen is a
 * valid answer — scheduled work with nobody on it is ordinary — so there is no "none" option to
 * select, only the absence of a tick. Submits every ticked id under `name`.
 */
export function ResourceChecklist({
  name = 'resourceIds',
  legend,
  options,
  selected = [],
  hint,
}: {
  name?: string;
  legend: string;
  options: SelectOption[];
  selected?: readonly string[];
  hint?: string;
}) {
  const hintId = useId();

  if (options.length === 0) {
    return <p className="text-sm text-muted">No resources yet. Add some under Resources to assign them.</p>;
  }

  const chosen = new Set(selected);

  return (
    <fieldset className="flex flex-col gap-1" aria-describedby={hint ? hintId : undefined}>
      <legend className="text-sm text-muted">{legend}</legend>
      <div className="flex max-h-44 flex-col gap-1 overflow-y-auto pr-1">
        {options.map((option) => (
          <label key={option.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name={name} value={option.id} defaultChecked={chosen.has(option.id)} />
            <span className="min-w-0 break-words">{option.label}</span>
          </label>
        ))}
      </div>
      {hint ? (
        <p id={hintId} className="text-xs text-subtle">
          {hint}
        </p>
      ) : null}
    </fieldset>
  );
}
