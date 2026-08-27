'use client';

import { useActionState } from 'react';
import type { Role } from '@/lib/domain/tenancy/roles';
import { addMemberAction, type AddMemberState } from './actions';

const INITIAL: AddMemberState = { error: null };

const INPUT_CLASS = 'flex-1 rounded border border-black/15 px-3 py-2 dark:border-white/20';

export function AddMemberForm({
  organizationId,
  roles,
}: {
  organizationId: string;
  roles: Role[];
}) {
  const [state, formAction, pending] = useActionState(addMemberAction, INITIAL);

  if (roles.length === 0) {
    return <p className="mt-4 text-sm opacity-70">Create a role before adding people.</p>;
  }

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          name="email"
          type="email"
          required
          placeholder="Their email address"
          aria-label="Email address"
          className={INPUT_CLASS}
        />
        {/* What this organization calls them. Not a profile: the same account can be "Sam"
            here and something else entirely to another tenant (D19). */}
        <input
          name="displayName"
          type="text"
          required
          maxLength={120}
          placeholder="What to call them here"
          aria-label="Name"
          className={INPUT_CLASS}
        />
        <select name="roleId" aria-label="Role" className={INPUT_CLASS}>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
      >
        {pending ? 'Adding…' : 'Add person'}
      </button>

      <p className="text-sm opacity-60">
        They need an account already. There are no invitations yet.
      </p>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
