'use client';

import { useActionState, useState } from 'react';
import { ErrorText, SelectInput } from '@/components/controls/inputs';
import {
  RESOURCE_CLASSES,
  RESOURCE_CLASS_LABELS,
  type ResourceClass,
} from '@/lib/domain/resources/resource-class';
import {
  setResourceClassAction,
  type ResourceEditState,
} from '@/app/organizations/[organizationId]/resources/actions';

const INITIAL: ResourceEditState = { error: null };

/**
 * What kind of resource this is, changed in place — `ResourceMembershipControl`'s shape, for the
 * same reason: one independent command submits itself, and a refusal (a member-linked resource
 * cannot stop being a person) reverts the control to what is actually stored rather than leave it
 * showing a choice that was never written.
 */
export function ResourceClassControl({
  organizationId,
  resourceId,
  current,
}: {
  organizationId: string;
  resourceId: string;
  current: ResourceClass;
}) {
  const [state, formAction, pending] = useActionState(setResourceClassAction, INITIAL);
  const [value, setValue] = useState<ResourceClass>(current);

  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state.error) setValue(current);
  }

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="resourceId" value={resourceId} />
      <SelectInput
        name="resourceClass"
        size="small"
        value={value}
        disabled={pending}
        aria-label="Type"
        onChange={(event) => {
          setValue(event.target.value as ResourceClass);
          event.currentTarget.form?.requestSubmit();
        }}
      >
        {RESOURCE_CLASSES.map((option) => (
          <option key={option} value={option}>
            {RESOURCE_CLASS_LABELS[option]}
          </option>
        ))}
      </SelectInput>
      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}
