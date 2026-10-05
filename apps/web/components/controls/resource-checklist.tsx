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
  groups,
  additionalIds,
}: {
  name?: string;
  legend: string;
  options: SelectOption[];
  selected?: readonly string[];
  hint?: string;
  /**
   * What the work needs, each with the resources eligible for it (ids from `options`, each once).
   * A suggestion for the eye only — every box submits the same ordinary set under `name`, and what
   * actually covers the needs is decided elsewhere, from the assignments.
   */
  groups?: { key: string; title: string; hint?: string; resourceIds: readonly string[] }[];
  /** Resources no requirement asks for, shown last as additional. */
  additionalIds?: readonly string[];
}) {
  const hintId = useId();

  if (options.length === 0) {
    return <p className="text-sm text-muted">No resources yet. Add some under Resources to assign them.</p>;
  }

  const chosen = new Set(selected);
  const byId = new Map(options.map((option) => [option.id, option]));
  const box = (option: SelectOption) => (
    <label key={option.id} className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} value={option.id} defaultChecked={chosen.has(option.id)} />
      <span className="min-w-0 break-words">{option.label}</span>
    </label>
  );

  if (groups && groups.length > 0) {
    const extra = (additionalIds ?? []).flatMap((id) => byId.get(id) ?? []);
    return (
      <fieldset className="flex flex-col gap-2" aria-describedby={hint ? hintId : undefined}>
        <legend className="text-sm text-muted">{legend}</legend>
        {groups.map((group) => (
          <div key={group.key} role="group" aria-label={`${group.title}, ${group.hint ?? ''}`.replace(/, $/, '')} className="flex flex-col gap-1">
            <p className="text-sm font-medium">
              {group.title} <span className="font-normal text-muted">— {group.hint}</span>
            </p>
            {group.resourceIds.length === 0 ? (
              <p className="text-xs text-subtle">No resource can do this yet.</p>
            ) : (
              <div className="flex max-h-32 flex-col gap-1 overflow-y-auto pr-1">
                {group.resourceIds.flatMap((id) => byId.get(id) ?? []).map(box)}
              </div>
            )}
          </div>
        ))}
        {extra.length > 0 ? (
          <div role="group" aria-label="Additional resources" className="flex flex-col gap-1">
            <p className="text-sm font-medium">Additional resources</p>
            <div className="flex max-h-32 flex-col gap-1 overflow-y-auto pr-1">{extra.map(box)}</div>
          </div>
        ) : null}
        {hint ? (
          <p id={hintId} className="text-xs text-subtle">
            {hint}
          </p>
        ) : null}
      </fieldset>
    );
  }

  return (
    <fieldset className="flex flex-col gap-1" aria-describedby={hint ? hintId : undefined}>
      <legend className="text-sm text-muted">{legend}</legend>
      <div className="flex max-h-44 flex-col gap-1 overflow-y-auto pr-1">
        {options.map(box)}
      </div>
      {hint ? (
        <p id={hintId} className="text-xs text-subtle">
          {hint}
        </p>
      ) : null}
    </fieldset>
  );
}
