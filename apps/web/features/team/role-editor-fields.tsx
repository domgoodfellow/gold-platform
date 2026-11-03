'use client';

import { useState } from 'react';
import { TextInput } from '@/components/controls/inputs';
import { CapabilitySelector } from '@/features/tenancy/capability-selector';
import type { Capability } from '@/lib/domain/tenancy/capabilities';
import { ROLE_PRESETS } from '@/lib/domain/tenancy/role-presets';
import { SelectField } from '@/components/controls/select-field';

/**
 * The fields Create and Edit share — name and the capability checklist — so the two Sheets stay
 * one system rather than drifting into two hand-maintained forms. Neither Sheet duplicates
 * `CapabilitySelector`'s vocabulary or grouping.
 *
 * `withPresets` (Create only) adds a *Start from* choice that ticks a template's capabilities. It
 * only fills the checklist, which stays fully editable; the saved role records no preset.
 */
export function RoleEditorFields({
  defaultName,
  selected,
  idPrefix,
  withPresets = false,
}: {
  defaultName?: string;
  /** Which capabilities start checked — absent for a new role, the role's own set when editing. */
  selected?: ReadonlySet<Capability>;
  idPrefix: string;
  withPresets?: boolean;
}) {
  const [preset, setPreset] = useState('');
  const chosen = ROLE_PRESETS.find((candidate) => candidate.key === preset);
  const start = chosen ? new Set<Capability>(chosen.capabilities) : selected;

  return (
    <>
      <TextInput
        name="name"
        type="text"
        required
        maxLength={64}
        defaultValue={defaultName}
        placeholder="Name, e.g. Dispatcher"
        aria-label="Role name"
      />
      {withPresets ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Start from</span>
          <SelectField value={preset} onValueChange={(next) => setPreset(next)} aria-label="Start from a preset" options={[{ value: '', label: 'Nothing ticked' }, ...ROLE_PRESETS.map((candidate) => ({ value: candidate.key, label: candidate.label }))]} />
        </label>
      ) : null}
      {/* Keyed by preset so choosing another remounts the checklist with that template's boxes ticked. */}
      <CapabilitySelector key={preset} selected={start} idPrefix={idPrefix} />
    </>
  );
}
