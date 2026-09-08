'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, Hint, SelectInput, TextArea, TextInput } from '@/components/controls/inputs';
import type { CustomerStage } from '@/lib/domain/customers/stages';
import type { CallOutcome } from '@/lib/domain/reception/outcomes';
import {
  createOutcomeAction,
  createStageAction,
  setCallingNumberAction,
  updateStageAction,
  wrapUpCallAction,
  type FormState,
} from './actions';

const INITIAL: FormState = { error: null };

/**
 * The reception module's forms.
 *
 * **Nothing here proposes a word.** No placeholder suggests *Prospect*, no default outcome says
 * *Voicemail*, and the empty state says what is true rather than what to do about it — a
 * platform that seeds no pipeline may not seed one through a form's suggestions either.
 */

export function CreateStageForm({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState(createStageAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          name="name"
          type="text"
          required
          maxLength={64}
          aria-label="Stage name"
          className="flex-1"
        />
        <TextInput
          name="position"
          type="number"
          min={0}
          defaultValue={0}
          aria-label="Where it sits"
          className="w-28"
        />
        <Button type="submit" disabled={pending}>
          Add stage
        </Button>
      </div>

      {state.error ? <ErrorText>{state.error}</ErrorText> : null}
    </form>
  );
}

export function EditStageForm({
  organizationId,
  stage,
}: {
  organizationId: string;
  stage: CustomerStage;
}) {
  const [state, formAction, pending] = useActionState(updateStageAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-2 py-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="id" value={stage.id} />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <TextInput
          name="name"
          type="text"
          required
          maxLength={64}
          defaultValue={stage.name}
          aria-label="Stage name"
          className="flex-1"
        />
        <TextInput
          name="position"
          type="number"
          min={0}
          defaultValue={stage.position}
          aria-label="Where it sits"
          className="w-28"
        />
        <Button type="submit" tone="secondary" disabled={pending}>
          Save
        </Button>
      </div>

      {state.error ? <ErrorText>{state.error}</ErrorText> : null}
    </form>
  );
}

export function CreateOutcomeForm({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState(createOutcomeAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          name="name"
          type="text"
          required
          maxLength={64}
          aria-label="Outcome name"
          className="flex-1"
        />
        <TextInput
          name="position"
          type="number"
          min={0}
          defaultValue={0}
          aria-label="Where it sits"
          className="w-28"
        />
        <Button type="submit" disabled={pending}>
          Add outcome
        </Button>
      </div>

      {/* The one platform fact on an outcome, asked as the one question the platform needs
          answered: a business's own word cannot say whether a conversation happened. */}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="reached" />
        Counts as having spoken to somebody
      </label>

      {state.error ? <ErrorText>{state.error}</ErrorText> : null}
    </form>
  );
}

/** How it went, filled in after the call rather than during it. */
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

/**
 * The number this business dials from.
 *
 * **Empty is a real answer and the field says so** rather than proposing one. There is no
 * placeholder number, because a suggested `+1…` is the platform guessing at a country.
 */
export function CallingNumberForm({
  organizationId,
  number,
}: {
  organizationId: string;
  number: string | null;
}) {
  const [state, formAction, pending] = useActionState(setCallingNumberAction, INITIAL);

  return (
    <form action={formAction} className="mt-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="flex flex-wrap items-center gap-3">
        <TextInput
          name="number"
          type="tel"
          defaultValue={number ?? ''}
          inputMode="tel"
          autoComplete="off"
          aria-label="The number this business dials from"
          // The same expression the column checks and `placeCall` checks, so the browser refuses
          // what the database would have refused, with a sentence instead of a constraint name.
          pattern="\+[1-9][0-9]{7,14}"
          className="w-56"
        />
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <Hint className="mt-2">
        With a country code, like +14165550142. Clearing it stops the dialer.
      </Hint>
      {state.error ? <ErrorText>{state.error}</ErrorText> : null}
    </form>
  );
}
