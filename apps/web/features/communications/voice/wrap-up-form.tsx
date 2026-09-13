'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, SelectInput, TextArea, TextInput } from '@/components/controls/inputs';
import type { CallOutcome } from '@/lib/domain/reception/outcomes';
import {
  wrapUpCallAction,
  type FormState,
} from '@/app/organizations/[organizationId]/calls/actions';

const INITIAL: FormState = { error: null };

/**
 * How it went, filled in after the call rather than during it.
 *
 * Calls `wrapUpCallAction`, which forwards this to
 * `apps/api/app/domains/communications/voice/wrap_up.py::wrap_up_call` — the FastAPI-authoritative
 * write for this act. See that module's own comment for why it replaced two round trips
 * (`recordCallOutcome`, formerly in `lib/domain/reception/calls.ts`) with one transaction.
 */
export function WrapUpCallForm({
  organizationId,
  callId,
  outcomes,
  note,
  outcomeId,
}: {
  organizationId: string;
  callId: string;
  outcomes: CallOutcome[];
  note: string;
  outcomeId: string | null;
}) {
  const [state, formAction, pending] = useActionState(wrapUpCallAction, INITIAL);

  return (
    <form action={formAction} className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="callId" value={callId} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <SelectInput
          name="outcomeId"
          defaultValue={outcomeId ?? ''}
          aria-label="How it went"
          className="flex-1"
        >
          {/* Blank first, and it stays selectable: a call nobody has written up yet is an
              ordinary state, and forcing a word out of somebody produces a wrong one. */}
          <option value="">Not written up</option>
          {outcomes.map((outcome) => (
            <option key={outcome.id} value={outcome.id}>
              {outcome.name}
            </option>
          ))}
        </SelectInput>
        <TextInput
          name="durationSeconds"
          type="number"
          min={0}
          aria-label="Seconds"
          className="w-28"
        />
      </div>

      <TextArea name="note" rows={2} defaultValue={note} aria-label="What was said" />

      <Button type="submit" tone="secondary" disabled={pending} className="w-fit">
        Save
      </Button>

      {state.error ? <ErrorText>{state.error}</ErrorText> : null}
    </form>
  );
}
