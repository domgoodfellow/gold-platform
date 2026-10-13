'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { CheckboxField } from '@/components/controls/checkbox-field';
import { ErrorText, FieldLabel, Hint, SelectInput, TextInput } from '@/components/controls/inputs';
import {
  assignNumberAction,
  configureNumberAction,
  releaseAssignmentAction,
  useNumberAsMineAction,
  type NumberFormState,
} from '@/app/organizations/[organizationId]/comms/configuration/numbers/actions';
import { NUMBER_PURPOSES, type PhoneNumber } from '@/lib/domain/reception/numbers';
import { PURPOSE_LABEL } from './labels';

const INITIAL: NumberFormState = { error: null };

/**
 * What this business says about how it uses a number: its own name for it, what it is for, and
 * whether it takes and places calls and texts. A number GildOps does not hold cannot take calls or
 * texts, so those two boxes are not offered for it rather than offered and refused.
 */
export function ConfigureNumberForm({ organizationId, number }: { organizationId: string; number: PhoneNumber }) {
  const [state, formAction, pending] = useActionState(configureNumberAction, INITIAL);
  const inboundPossible = number.origin === 'provisioned';

  return (
    <form action={formAction} className="mt-2 flex max-w-md flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="phoneNumberId" value={number.id} />

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor={`label-${number.id}`}>Name</FieldLabel>
        <TextInput id={`label-${number.id}`} name="label" defaultValue={number.label ?? ''} maxLength={120} placeholder="Front desk" />
      </div>

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor={`purpose-${number.id}`}>Used for</FieldLabel>
        <SelectInput id={`purpose-${number.id}`} name="purpose" defaultValue={number.purpose}>
          {NUMBER_PURPOSES.map((purpose) => <option key={purpose} value={purpose}>{PURPOSE_LABEL[purpose]}</option>)}
        </SelectInput>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm text-subtle">What it can do</legend>
        <CheckboxField id={`vi-${number.id}`} name="voiceInbound" label="Take calls" defaultChecked={number.voiceInboundEnabled} disabled={!inboundPossible} />
        <CheckboxField id={`vo-${number.id}`} name="voiceOutbound" label="Place calls" defaultChecked={number.voiceOutboundEnabled} />
        <CheckboxField id={`si-${number.id}`} name="smsInbound" label="Take texts" defaultChecked={number.smsInboundEnabled} disabled={!inboundPossible} />
        <CheckboxField id={`so-${number.id}`} name="smsOutbound" label="Send texts" defaultChecked={number.smsOutboundEnabled} />
        {!inboundPossible ? <Hint>Calls and texts sent to this number do not reach GildOps, so it cannot take them.</Hint> : null}
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
        <ErrorText>{state.error}</ErrorText>
      </div>
    </form>
  );
}

export function AssignNumberForm({ organizationId, phoneNumberId, members }: {
  organizationId: string;
  phoneNumberId: string;
  members: { id: string; displayName: string }[];
}) {
  const [state, formAction, pending] = useActionState(assignNumberAction, INITIAL);

  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="phoneNumberId" value={phoneNumberId} />
      <SelectInput name="memberId" required defaultValue="" aria-label="Assign to">
        <option value="" disabled>Assign to…</option>
        {members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}
      </SelectInput>
      <CheckboxField id={`default-${phoneNumberId}`} name="isDefault" label="Their default" />
      <Button type="submit" tone="secondary" size="small" disabled={pending}>{pending ? 'Assigning…' : 'Assign'}</Button>
      <ErrorText>{state.error}</ErrorText>
    </form>
  );
}

export function ReleaseAssignmentForm({ organizationId, phoneNumberId, assignmentId }: {
  organizationId: string;
  phoneNumberId: string;
  assignmentId: string;
}) {
  const [state, formAction, pending] = useActionState(releaseAssignmentAction, INITIAL);

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="phoneNumberId" value={phoneNumberId} />
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <Button type="submit" tone="text" size="tiny" disabled={pending}>Release</Button>
      <ErrorText>{state.error}</ErrorText>
    </form>
  );
}

export function UseAsMineForm({ organizationId, phoneNumberId }: { organizationId: string; phoneNumberId: string }) {
  const [state, formAction, pending] = useActionState(useNumberAsMineAction, INITIAL);

  return (
    <form action={formAction} className="mt-3 flex items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="phoneNumberId" value={phoneNumberId} />
      <Button type="submit" tone="secondary" size="small" disabled={pending}>{pending ? 'Saving…' : 'Dial from this number'}</Button>
      <ErrorText>{state.error}</ErrorText>
    </form>
  );
}
