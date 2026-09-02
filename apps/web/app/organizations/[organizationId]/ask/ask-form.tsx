'use client';

import { useActionState } from 'react';
import { askAction, type AskActionState } from './actions';

const INITIAL: AskActionState = { error: null };

const INPUT = 'rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20';
const BUTTON =
  'rounded border border-black/15 px-3 py-1 text-sm disabled:opacity-50 dark:border-white/20';

/**
 * One box, and the answer appears in the history below it.
 *
 * **No streaming and no chat.** An answer arrives whole or not at all, which is what the far
 * side returns and what the record holds — a half-answer on screen that no row contains is a
 * thing an operator can quote and nobody can check. A conversation is a different feature: it
 * would mean a run holding turns rather than a question, and nothing has asked for one.
 */
export function AskForm({
  organizationId,
  disabled,
}: {
  organizationId: string;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(askAction, INITIAL);

  return (
    <form action={action} className="mt-4 max-w-2xl">
      <input type="hidden" name="organizationId" value={organizationId} />

      <label className="block text-sm" htmlFor="question">
        Ask about this business — what is at risk of being late today, what is booked with nobody
        assigned.
      </label>
      <textarea
        id="question"
        name="question"
        rows={3}
        required
        disabled={disabled}
        className={`${INPUT} mt-2 w-full`}
      />

      <button type="submit" className={`${BUTTON} mt-2`} disabled={disabled || pending}>
        {pending ? 'Asking…' : 'Ask'}
      </button>

      {state.error && (
        <p role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
    </form>
  );
}
