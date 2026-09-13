'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, Hint, TextInput } from '@/components/controls/inputs';
import {
  setCallingNumberAction,
  type FormState,
} from '@/app/organizations/[organizationId]/calls/actions';

const INITIAL: FormState = { error: null };

/**
 * The number this business dials from.
 *
 * **Empty is a real answer and the field says so** rather than proposing one. There is no
 * placeholder number, because a suggested `+1…` is the platform guessing at a country.
 *
 * A first step toward the eventual Voice control plane (number inventory, pools, routing —
 * `constraints.md`'s next-slice list), not that plane itself: this remains one nullable number.
 */
export function OutboundIdentity({
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
