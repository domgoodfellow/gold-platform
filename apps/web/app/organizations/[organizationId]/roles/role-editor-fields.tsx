'use client';

import { TextInput } from '@/components/controls/inputs';
import { CapabilitySelector } from '@/features/tenancy/capability-selector';
import type { Capability } from '@/lib/domain/tenancy/capabilities';

/**
 * The fields Create and Edit share — name and the capability checklist — so the two Sheets stay
 * one system rather than drifting into two hand-maintained forms. Neither Sheet duplicates
 * `CapabilitySelector`'s vocabulary or grouping.
 */
export function RoleEditorFields({
  defaultName,
  selected,
  idPrefix,
}: {
  defaultName?: string;
  /** Which capabilities start checked — absent for a new role, the role's own set when editing. */
  selected?: ReadonlySet<Capability>;
  idPrefix: string;
}) {
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
      <CapabilitySelector selected={selected} idPrefix={idPrefix} />
    </>
  );
}
