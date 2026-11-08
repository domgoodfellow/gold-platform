'use client';

import { useId } from 'react';
import { TextInput } from '@/components/controls/inputs';
import { Field, FieldDescription, FieldLabel } from '@gold/ui/components/field';
import type { ResourceCapability } from '@/lib/domain/resources/resource-capabilities';

/**
 * What this resource can do, chosen from the business's own vocabulary and optional by design — a
 * business that has not said yet is not asked to. Native checkboxes in a fieldset: keyboard and
 * screen-reader behaviour for free, and nothing here is communicated by colour. A word typed into
 * the last box is added to the vocabulary and given to the resource in the same step (when the
 * caller may configure it — the database decides, not this control).
 */
export function CapabilityPicker({
  capabilities,
  mayAdd,
}: {
  capabilities: ResourceCapability[];
  mayAdd: boolean;
}) {
  const newId = useId();

  if (capabilities.length === 0 && !mayAdd) return null;

  return (
    <Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Skills</legend>
        {capabilities.length > 0 ? (
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {capabilities.map((capability) => (
              <label key={capability.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="capabilityIds" value={capability.id} />
                {capability.name}
              </label>
            ))}
          </div>
        ) : null}
      </fieldset>
      {mayAdd ? (
        <>
          <FieldLabel htmlFor={newId} className="font-normal">
            Add a skill
          </FieldLabel>
          <TextInput id={newId} name="newCapability" type="text" maxLength={64} placeholder="Tire service" />
          <FieldDescription>Optional. What this resource can do, in your own words.</FieldDescription>
        </>
      ) : null}
    </Field>
  );
}
