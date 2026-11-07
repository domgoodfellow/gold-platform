'use client';

import { FormError, FormField } from '@/components/controls/form';
import { FieldLabel, Hint, TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import Link from 'next/link';
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
  collectProfile?: boolean;
  /** Shown once the action reports `done`. The one caller is the recovery request. */
  successMessage?: ReactNode;
  /** Where somebody who has forgotten the password goes. Sits in the Password label row, at the right. */
  recoveryHref?: string;
  /** The address an invitation was sent to, offered as the email to use. Still editable. */
  defaultEmail?: string;
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
  collectProfile = false,
  successMessage,
  recoveryHref,
  defaultEmail,
}: Props) {
  const [state, formAction, pending] = useActionState(action, INITIAL);

  const wantsEmail = fields === 'email-and-password' || fields === 'email';
  const wantsPassword = fields === 'email-and-password' || fields === 'password';

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4">
      {collectProfile ? <>
        <FormField id="givenName" label="Given name">
          {(field) => <TextInput {...field} name="givenName" autoComplete="given-name" maxLength={100} />}
        </FormField>
        <FormField id="familyName" label="Family name">
          {(field) => <TextInput {...field} name="familyName" autoComplete="family-name" maxLength={100} />}
        </FormField>
        <FormField id="preferredName" label="Preferred name (optional)">
          {(field) => <TextInput {...field} name="preferredName" autoComplete="nickname" maxLength={100} />}
        </FormField>
      </> : null}
      {wantsEmail ? (
        <FormField id="email" label="Email">
          {(field) => <TextInput {...field} name="email" type="email" required autoComplete="email" defaultValue={defaultEmail} />}
        </FormField>
      ) : null}

      {wantsPassword && recoveryHref ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Link href={recoveryHref} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
              Forgot password?
            </Link>
          </div>
          <TextInput id="password" name="password" type="password" required autoComplete={passwordAutoComplete} />
        </div>
      ) : null}

      {wantsPassword && !recoveryHref ? (
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

/**
 * Local demo accounts, one button each, submitted through the same log-in action as the form
 * above. The pressed button supplies the email; all demo accounts share one password. The log-in
 * page renders this only for `next dev` against a local Supabase.
 */
export function DemoAccountButtons({
  action,
  accounts,
  password,
}: {
  action: Props['action'];
  accounts: { label: string; email: string }[];
  password: string;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  return (
    <form action={formAction} aria-label="Demo accounts" className="mt-6 flex flex-col gap-2">
      <input type="hidden" name="password" value={password} />
      {accounts.map((account) => (
        <Button
          key={account.email}
          type="submit"
          name="email"
          value={account.email}
          tone="secondary"
          size="small"
          disabled={pending}
          className="h-auto w-full flex-wrap justify-between gap-x-3 whitespace-normal py-1.5 text-left"
        >
          <span>{account.label}</span>
          <span className="min-w-0 break-all text-muted-foreground">{account.email}</span>
        </Button>
      ))}
      <FormError>{state.error}</FormError>
    </form>
  );
}
