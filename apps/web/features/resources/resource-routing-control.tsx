'use client';

import { useActionState, useId } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText } from '@/components/controls/inputs';
import { Field, FieldDescription, FieldLabel } from '@gold/ui/components/field';
import { TRAVEL_MODES, TRAVEL_MODE_LABELS, type TravelMode } from '@/lib/domain/resources/travel-mode';
import {
  setResourceRoutingAction,
  type ResourceEditState,
} from '@/app/organizations/[organizationId]/resources/actions';
import { SelectField } from '@/components/controls/select-field';

const INITIAL: ResourceEditState = { error: null };
const NOT_SAID = '';

/**
 * How this resource moves, and where it starts from. Two answers that only mean something together
 * (a fixed resource is *at* its base), so one Save rather than one control each. Both optional: the
 * business that says nothing gets no travel checks for this resource, and is told so.
 */
export function ResourceRoutingControl({
  organizationId,
  resourceId,
  travelMode,
  baseLocationId,
  locations,
}: {
  organizationId: string;
  resourceId: string;
  travelMode: TravelMode | null;
  baseLocationId: string | null;
  locations: { id: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(setResourceRoutingAction, INITIAL);
  const modeId = useId();
  const baseId = useId();

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="resourceId" value={resourceId} />

      <Field>
        <FieldLabel htmlFor={modeId}>How it moves</FieldLabel>
        <SelectField id={modeId} name="travelMode" size="small" defaultValue={travelMode ?? NOT_SAID} disabled={pending} options={[{ value: NOT_SAID, label: 'Not set — travel is not checked' }, ...TRAVEL_MODES.map((mode) => ({ value: mode, label: TRAVEL_MODE_LABELS[mode] }))]} />
      </Field>

      <Field>
        <FieldLabel htmlFor={baseId}>Routing base</FieldLabel>
        <SelectField id={baseId} name="baseLocationId" size="small" defaultValue={baseLocationId ?? NOT_SAID} disabled={pending} options={[{ value: NOT_SAID, label: 'None' }, ...locations.map((location) => ({ value: location.id, label: location.label }))]} />
        <FieldDescription>Used when this resource has no earlier job that day. Not its live position.</FieldDescription>
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" tone="secondary" size="small" disabled={pending}>
          Save travel settings
        </Button>
        <ErrorText role="alert">{state.error}</ErrorText>
      </div>
    </form>
  );
}
