'use client';

import { Button } from '@/components/controls/button';
import { TextArea } from '@/components/controls/inputs';
import { useActionState } from 'react';
import { proposeAction, type SetupActionState } from '@/app/organizations/[organizationId]/setup/actions';
import { Error } from './setup-controls';

const INITIAL: SetupActionState = { error: null };

/**
 * Describe the business, or answer what the last proposal asked.
 *
 * One box and nothing else. The alternative — a form with a field per thing the platform wants
 * to know — is the form this whole module exists to avoid: it asks a business to already know
 * what a status is before it can say what it does.
 */
export function DescribeForm({
  organizationId,
  refining,
  disabled,
}: {
  organizationId: string;
  refining: boolean;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(proposeAction, INITIAL);

  return (
    <form action={action} className="mt-4 max-w-2xl">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="refine" value={refining ? 'yes' : 'no'} />

      <label className="block text-sm" htmlFor="description">
        {refining
          ? 'Answer anything below, or say what to change. What you have already agreed to is kept.'
          : 'Describe the business in your own words — the work it does, how a job goes from start to finish, what you charge for, when you are open.'}
      </label>
      <TextArea
        id="description"
        name="description"
        rows={refining ? 4 : 8}
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
        {pending ? 'Drafting…' : refining ? 'Redraft' : 'Draft a setup'}
      </Button>
      <Error state={state} />
    </form>
  );
}
