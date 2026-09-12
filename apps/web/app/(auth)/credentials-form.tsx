'use client';

import { FormError, FormField } from '@/components/controls/form';
import { Hint, TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { useActionState, type ReactNode } from 'react';

/** `done` is for an action with nothing to navigate to afterwards — asking for a recovery link. */
export type CredentialsState = { error: string | null; done?: boolean };

const INITIAL: CredentialsState = { error: null };

/** Which of the three shapes this screen needs. Logging in, asking for a link, setting a new one. */
export type CredentialsFields = 'email-and-password' | 'email' | 'password';

type Props = {
  action: (state: CredentialsState, formData: FormData) => Promise<CredentialsState>;
  fields: CredentialsFields;
  submitLabel: string;
  pendingLabel: string;
  passwordAutoComplete: 'current-password' | 'new-password';
  /** Sign-up and setting a new password ask twice; logging in has nothing to confirm against. */
  confirmPassword?: boolean;
  /** Shown once the action reports `done`. The one caller is the recovery request. */
  successMessage?: ReactNode;
};

/**
 * The form for all four credential screens: log in, sign up, ask for a recovery link, set a new
 * password. It renders whatever message the domain returned and never composes one of its own —
 * the rule that produced the message lives in `domain/identity`, and a second sentence written
 * here would be a second rule.
 *
 * One component with a `fields` switch rather than four near-identical forms, because what must
 * not drift between them is the part nobody looks at twice: the autocomplete hints a password
 * manager reads, the `role="alert"` on the error, and the disabled state while a submit is in
 * flight.
 */
export function CredentialsForm({
  action,
  fields,
  submitLabel,
  pendingLabel,
  passwordAutoComplete,
  confirmPassword = false,
  successMessage,
}: Props) {
  const [state, formAction, pending] = useActionState(action, INITIAL);

  const wantsEmail = fields === 'email-and-password' || fields === 'email';
  const wantsPassword = fields === 'email-and-password' || fields === 'password';

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4">
      {wantsEmail ? (
        <FormField id="email" label="Email">
          {(field) => <TextInput {...field} name="email" type="email" required autoComplete="email" />}
        </FormField>
      ) : null}

      {wantsPassword ? (
        <FormField id="password" label="Password">
          {(field) => (
            <TextInput {...field} name="password" type="password" required autoComplete={passwordAutoComplete} />
          )}
        </FormField>
      ) : null}

      {/* Whether they match is decided in `domain/identity`, not here — this field only
          collects the second reading. */}
      {confirmPassword ? (
        <FormField id="passwordConfirmation" label="Confirm password">
          {(field) => (
            <TextInput {...field} name="passwordConfirmation" type="password" required autoComplete="new-password" />
          )}
        </FormField>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? pendingLabel : submitLabel}
      </Button>

      <FormError>{state.error}</FormError>

      {state.done && successMessage ? <Hint role="status">{successMessage}</Hint> : null}
    </form>
  );
}
