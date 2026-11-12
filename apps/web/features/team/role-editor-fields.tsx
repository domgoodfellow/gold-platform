'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { FormField } from '@/components/controls/form';
import { Hint, TextInput } from '@/components/controls/inputs';
import { SelectField } from '@/components/controls/select-field';
import { CardSection } from '@/components/surfaces/card';
import { CapabilitySelector } from '@/features/tenancy/capability-selector';
import { CAPABILITIES, type Capability } from '@/lib/domain/tenancy/capabilities';
import { ROLE_PRESETS } from '@/lib/domain/tenancy/role-presets';
import type { RoleSuggestion } from '@/lib/domain/tenancy/role-suggestions';

/**
 * The fields of a role, for creating and editing alike: its name and the grouped permission
 * checklist. The editor that renders this owns the values, so it can say what a save will change.
 *
 * `withPresets` (a new role only) adds a *Start from* choice that ticks a starting point's
 * permissions: first the roles suggested for this kind of business, which also fill an empty name,
 * then the general ones. It only fills the form, which stays fully editable; the saved role
 * records nothing about where it started.
 */
export function RoleEditorFields({
  name,
  onNameChange,
  capabilities,
  onCapabilitiesChange,
  grantable,
  idPrefix,
  withPresets = false,
  suggestions = [],
}: {
  name: string;
  onNameChange: (next: string) => void;
  capabilities: ReadonlySet<Capability>;
  onCapabilitiesChange: (next: ReadonlySet<Capability>) => void;
  /** What the person editing holds; they can give nothing beyond it. */
  grantable: ReadonlySet<Capability>;
  idPrefix: string;
  withPresets?: boolean;
  suggestions?: readonly RoleSuggestion[];
}) {
  const [preset, setPreset] = useState('');
  const starts = [
    ...suggestions.map((suggestion, index) => ({ value: `suggested:${index}`, label: `${suggestion.name} (suggested for ${suggestion.from})`, name: suggestion.name, capabilities: suggestion.capabilities as readonly Capability[] })),
    ...ROLE_PRESETS.map((candidate) => ({ value: candidate.key, label: candidate.label, name: null, capabilities: candidate.capabilities })),
  ];
  const [query, setQuery] = useState('');

  return (
    <>
      <CardSection title="Role">
        <div className="mt-3 grid max-w-2xl gap-4 sm:grid-cols-2">
          <FormField id={`${idPrefix}-name`} label="Name">
            {(field) => (
              <TextInput {...field} name="name" type="text" required maxLength={64} value={name} onChange={(event) => onNameChange(event.target.value)} />
            )}
          </FormField>
          {withPresets ? (
            <FormField id={`${idPrefix}-start`} label="Start from">
              {(field) => (
                <SelectField
                  {...field}
                  value={preset}
                  onValueChange={(next) => {
                    setPreset(next);
                    const start = starts.find((candidate) => candidate.value === next);
                    onCapabilitiesChange(new Set((start?.capabilities ?? []).filter((capability) => grantable.has(capability))));
                    if (start?.name && !name.trim()) onNameChange(start.name);
                  }}
                  options={[{ value: '', label: 'Nothing ticked' }, ...starts.map((candidate) => ({ value: candidate.value, label: candidate.label }))]}
                />
              )}
            </FormField>
          ) : null}
        </div>
      </CardSection>

      <CardSection
        title="Permissions"
        action={
          <label className="relative block w-full sm:w-64">
            <span className="sr-only">Search permissions</span>
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <TextInput type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search permissions" className="pl-8" />
          </label>
        }
      >
        {grantable.size < CAPABILITIES.length ? <Hint className="mt-2">You can only give permissions you have yourself. The others cannot be ticked.</Hint> : null}
        <div className="mt-4">
          <CapabilitySelector value={capabilities} onChange={onCapabilitiesChange} query={query} grantable={grantable} idPrefix={idPrefix} />
        </div>
      </CardSection>
    </>
  );
}
