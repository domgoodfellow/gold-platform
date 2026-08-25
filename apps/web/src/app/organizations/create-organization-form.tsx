'use client';

import { useActionState } from 'react';
import { createOrganizationAction, type CreateOrganizationState } from './actions';

const INITIAL: CreateOrganizationState = { error: null };

export function CreateOrganizationForm() {
  const [state, formAction, pending] = useActionState(createOrganizationAction, INITIAL);

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-2">
      <label htmlFor="name" className="text-sm font-medium">
        New organization
      </label>
      <div className="flex gap-2">
        <input
          id="name"
          name="name"
          type="text"
          required
          maxLength={200}
          className="flex-1 rounded border border-black/15 px-3 py-2 dark:border-white/20"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
        >
          {pending ? 'Creating…' : 'Create'}
        </button>
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
