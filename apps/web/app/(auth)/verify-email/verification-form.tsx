'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { FormError, FormField } from '@/components/controls/form';
import { Hint, TextInput } from '@/components/controls/inputs';
import { verifyEmailAction, resendEmailAction, type VerificationState } from './actions';

const INITIAL: VerificationState = { error: null };
export function VerificationForm() {
  const [state, action, pending] = useActionState(verifyEmailAction, INITIAL);
  const [resend, resendAction, sending] = useActionState(resendEmailAction, INITIAL);
  return <div className="mt-6 flex flex-col gap-4">
    <form action={action} className="flex flex-col gap-4">
      <FormField id="code" label="Verification code">
        {(field) => <TextInput {...field} name="code" inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={10} pattern="[0-9]{6,10}" autoFocus />}
      </FormField>
      <Hint>Codes expire after one hour and can be used once. Request another if yours has expired.</Hint>
      <Button type="submit" disabled={pending || sending}>{pending ? 'Verifying?' : 'Verify email'}</Button>
      <FormError>{state.error}</FormError>
    </form>
    <form action={resendAction} className="flex flex-col gap-2">
      <Button type="submit" tone="secondary" disabled={sending || pending}>{sending ? 'Sending?' : 'Resend code'}</Button>
      <Hint>Wait at least one minute between requests.</Hint>
      <FormError>{resend.error}</FormError>
      {resend.message ? <Hint role="status">{resend.message}</Hint> : null}
    </form>
  </div>;
}
