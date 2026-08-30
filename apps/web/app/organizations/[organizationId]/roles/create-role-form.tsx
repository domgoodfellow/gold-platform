'use client';

import { useActionState } from 'react';
import { CAPABILITIES, CAPABILITY_LABELS } from '@/lib/domain/tenancy/capabilities';
import { createRoleAction, type CreateRoleState } from './actions';

const INITIAL: CreateRoleState = { error: null };

export function CreateRoleForm({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState(createRoleAction, INITIAL);

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <h2 className="text-sm font-medium">New role</h2>

      <input
        name="name"
        type="text"
        required
        maxLength={64}
        placeholder="Name, e.g. Dispatcher"
        aria-label="Role name"
        className="rounded border border-black/15 px-3 py-2 dark:border-white/20"
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm opacity-70">Can</legend>
        {CAPABILITIES.map((capability) => (
          <label key={capability} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="capabilities" value={capability} />
            {CAPABILITY_LABELS[capability]}
          </label>
        ))}
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
      >
        {pending ? 'Creating…' : 'Create role'}
      </button>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
