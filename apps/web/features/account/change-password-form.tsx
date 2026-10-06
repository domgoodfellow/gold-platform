'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { FormError, FormField } from '@/components/controls/form';
import { Hint, TextInput } from '@/components/controls/inputs';
import { changePasswordAction, requestPasswordCodeAction } from '@/app/settings/account/actions';
import { PASSWORD_MIN } from '@/lib/domain/identity/password-policy';
import { ACCOUNT_FORM_INITIAL } from './account-form-state';

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, ACCOUNT_FORM_INITIAL);
  const [codeState, codeAction, sendingCode] = useActionState(requestPasswordCodeAction, ACCOUNT_FORM_INITIAL);
  return (
    <div className="mt-4 flex max-w-md flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        <FormField id="currentPassword" label="Current password">
          {(field) => <TextInput {...field} name="currentPassword" type="password" required autoComplete="current-password" />}
        </FormField>
        <FormField id="password" label="New password">
          {(field) => <TextInput {...field} name="password" type="password" required minLength={PASSWORD_MIN} autoComplete="new-password" />}
        </FormField>
        <Hint>Use at least {PASSWORD_MIN} characters. Long passphrases and password managers are welcome.</Hint>
        <FormField id="passwordConfirmation" label="Confirm new password">
          {(field) => <TextInput {...field} name="passwordConfirmation" type="password" required autoComplete="new-password" />}
        </FormField>
        <FormField id="passwordNonce" label="Verification code (if requested)">
          {(field) => <TextInput {...field} name="nonce" autoComplete="one-time-code" inputMode="numeric" />}
        </FormField>
        <Hint>If your sign-in is older, request a code below and enter it here.</Hint>
        <Button type="submit" disabled={pending || sendingCode}>{pending ? 'Changing…' : 'Change password'}</Button>
        <FormError>{state.error}</FormError>
        {state.message ? <Hint role="status">{state.message}</Hint> : null}
      </form>
      <form action={codeAction}>
        <Button type="submit" tone="secondary" disabled={sendingCode || pending}>{sendingCode ? 'Sending…' : 'Send password verification code'}</Button>
        <FormError>{codeState.error}</FormError>
        {codeState.message ? <Hint role="status">{codeState.message}</Hint> : null}
      </form>
    </div>
  );
}
