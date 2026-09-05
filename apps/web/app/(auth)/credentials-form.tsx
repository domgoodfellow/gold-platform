'use client';

import { ErrorText, FieldLabel, TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { useActionState } from 'react';

export type CredentialsState = { error: string | null };

const INITIAL: CredentialsState = { error: null };

type Props = {
  action: (state: CredentialsState, formData: FormData) => Promise<CredentialsState>;
  submitLabel: string;
  pendingLabel: string;
  passwordAutoComplete: 'current-password' | 'new-password';
  /** Sign-up asks twice; sign-in has nothing to confirm against. */
  confirmPassword?: boolean;
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
  confirmPassword = false,
}: Props) {
  const [state, formAction, pending] = useActionState(action, INITIAL);

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="email">
          Email
        </FieldLabel>
        <TextInput id="email" name="email" type="email" required autoComplete="email" />
      </div>

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="password">
          Password
        </FieldLabel>
        <TextInput
          id="password"
          name="password"
          type="password"
          required
          autoComplete={passwordAutoComplete}
        />
      </div>

      {/* Whether they match is decided in `domain/identity`, not here — this field only
          collects the second reading. */}
      {confirmPassword ? (
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="passwordConfirmation">
            Confirm password
          </FieldLabel>
          <TextInput
            id="passwordConfirmation"
            name="passwordConfirmation"
            type="password"
            required
            autoComplete="new-password"
          />
        </div>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? pendingLabel : submitLabel}
      </Button>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}
