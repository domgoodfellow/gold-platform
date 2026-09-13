'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, TextInput } from '@/components/controls/inputs';
import {
  createOutcomeAction,
  type FormState,
} from '@/app/organizations/[organizationId]/calls/actions';

const INITIAL: FormState = { error: null };

/**
 * Naming the ways a call can go.
 *
 * **Nothing here proposes a word**, for the same reason `features/crm/sales/stage-settings.tsx`
 * proposes none: no placeholder suggests *Voicemail*, and a platform that ships no dialer script
 * may not seed one through a form's suggestions.
 */
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
