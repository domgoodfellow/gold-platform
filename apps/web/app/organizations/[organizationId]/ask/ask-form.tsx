'use client';

import { Button } from '@/components/controls/button';
import { Card } from '@/components/containers/card';
import { ErrorText, Hint, TextArea } from '@/components/controls/inputs';
import { useActionState } from 'react';
import { ACTION_LABELS, type AgentRun } from '@/lib/domain/assistant/questions';
import { askAction, decideAction, type AskActionState } from './actions';

const INITIAL: AskActionState = { error: null };

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
      <TextArea
        id="question"
        name="question"
        rows={3}
        required
        disabled={disabled}
        size="small"
        className="mt-2 w-full"
      />

      <Button
        type="submit"
        disabled={disabled || pending}
        tone="secondary"
        size="small"
        className="mt-2"
      >
        {pending ? 'Asking…' : 'Ask'}
      </Button>

      {state.error && (
        <ErrorText role="alert" className="mt-1">
          {state.error}
        </ErrorText>
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
      <Hint className="mt-2 text-xs">
        {label} —{' '}
        {run.actionOutcome === 'done'
          ? 'done'
          : run.actionOutcome === 'declined'
            ? 'you said no'
            : /* Whoever refused, in their own words (I25). */ run.actionDetail}
      </Hint>
    );
  }

  return (
    <Card className="mt-3 p-2">
      <p className="text-sm font-medium">{label}</p>
      {/* The model's own sentence, shown rather than paraphrased. */}
      <p className="mt-1 text-sm opacity-80">{run.proposedAction.because}</p>

      <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="runId" value={run.id} />
        <Button
          type="submit"
          name="decision"
          value="carry-out"
          disabled={pending}
          tone="secondary"
          size="small"
        >
          {pending ? 'Working…' : 'Do it'}
        </Button>
        <Button
          type="submit"
          name="decision"
          value="decline"
          disabled={pending}
          tone="secondary"
          size="small"
        >
          No
        </Button>
      </form>

      {state.error && (
        <ErrorText role="alert" className="mt-1">
          {state.error}
        </ErrorText>
      )}
    </Card>
  );
}
