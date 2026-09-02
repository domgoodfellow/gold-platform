'use client';

import { useActionState } from 'react';
import { ACTION_LABELS, type AgentRun } from '@/lib/domain/assistant/questions';
import { askAction, decideAction, type AskActionState } from './actions';

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

/**
 * A suggestion, and the two answers to it.
 *
 * **Nothing has happened when this renders.** The model said what it would do; the platform wrote
 * that down as a pending decision and stopped. Pressing *Do it* calls the same domain function
 * the schedule screen calls, under this person's own session — so somebody whose role cannot move
 * a job is refused by the policy on `work_items`, and the refusal appears here in the database's
 * own words (D34).
 *
 * Both buttons are shown to everybody, which is I12 rather than a shortcut around it: hiding one
 * would make this component the place that decides, and the policy would still be the place that
 * does.
 */
export function ProposedAction({
  organizationId,
  run,
}: {
  organizationId: string;
  run: AgentRun;
}) {
  const [state, action, pending] = useActionState(decideAction, INITIAL);

  if (!run.proposedAction || !run.actionOutcome) return null;

  const label = ACTION_LABELS[run.proposedAction.name] ?? run.proposedAction.name;

  if (run.actionOutcome !== 'pending') {
    return (
      <p className="mt-2 text-xs opacity-70">
        {label} —{' '}
        {run.actionOutcome === 'done'
          ? 'done'
          : run.actionOutcome === 'declined'
            ? 'you said no'
            : /* Whoever refused, in their own words (I25). */ run.actionDetail}
      </p>
    );
  }

  return (
    <div className="mt-3 rounded border border-black/15 p-2 dark:border-white/20">
      <p className="text-sm font-medium">{label}</p>
      {/* The model's own sentence, shown rather than paraphrased. */}
      <p className="mt-1 text-sm opacity-80">{run.proposedAction.because}</p>

      <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="runId" value={run.id} />
        <button
          type="submit"
          name="decision"
          value="carry-out"
          className={BUTTON}
          disabled={pending}
        >
          {pending ? 'Working…' : 'Do it'}
        </button>
        <button type="submit" name="decision" value="decline" className={BUTTON} disabled={pending}>
          No
        </button>
      </form>

      {state.error && (
        <p role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
    </div>
  );
}
