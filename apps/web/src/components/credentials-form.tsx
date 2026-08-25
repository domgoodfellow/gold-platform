'use client';

import { useActionState } from 'react';

export type CredentialsState = { error: string | null };

const INITIAL: CredentialsState = { error: null };

type Props = {
  action: (state: CredentialsState, formData: FormData) => Promise<CredentialsState>;
  submitLabel: string;
  pendingLabel: string;
  passwordAutoComplete: 'current-password' | 'new-password';
};

/**
 * The form for both sign-in and sign-up. It renders whatever message the domain returned
 * and never composes one of its own — the rule that produced the message lives in
 * `domain/identity`, and a second sentence written here would be a second rule.
 */
export function CredentialsForm({
  action,
  submitLabel,
  pendingLabel,
  passwordAutoComplete,
}: Props) {
  const [state, formAction, pending] = useActionState(action, INITIAL);

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="rounded border border-black/15 px-3 py-2 dark:border-white/20"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete={passwordAutoComplete}
          className="rounded border border-black/15 px-3 py-2 dark:border-white/20"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
      >
        {pending ? pendingLabel : submitLabel}
      </button>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
