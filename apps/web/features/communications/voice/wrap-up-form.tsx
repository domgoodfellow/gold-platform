'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, TextArea, TextInput } from '@/components/controls/inputs';
import type { CallOutcome } from '@/lib/domain/reception/outcomes';
import {
  wrapUpCallAction,
  type FormState,
} from '@/app/organizations/[organizationId]/calls/actions';
import { SelectField } from '@/components/controls/select-field';

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
  onSaved,
}: {
  organizationId: string;
  callId: string;
  outcomes: CallOutcome[];
  note: string;
  outcomeId: string | null;
  /** Told once each time the outcome is saved. */
  onSaved?: () => void;
}) {
  const [state, formAction, pending] = useActionState(wrapUpCallAction, INITIAL);
  // Each submission answers with a new state object; a saved one has no error.
  const reported = useRef<FormState>(INITIAL);
  useEffect(() => {
    if (state === reported.current) return;
    reported.current = state;
    if (!state.error) onSaved?.();
  }, [state, onSaved]);

  return (
    <form action={formAction} className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="callId" value={callId} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <SelectField name="outcomeId" defaultValue={outcomeId ?? ''} aria-label="How it went" className="flex-1" options={[{ value: '', label: 'Not written up' }, ...outcomes.map((outcome) => ({ value: outcome.id, label: outcome.name }))]} />
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
