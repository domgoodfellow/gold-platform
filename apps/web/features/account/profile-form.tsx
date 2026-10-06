'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { FormError, FormField } from '@/components/controls/form';
import { Hint, TextInput } from '@/components/controls/inputs';
import { changeEmailAction, requestEmailCodeAction, updateProfileAction } from '@/app/settings/account/actions';
import { ACCOUNT_FORM_INITIAL } from './account-form-state';

export function PersonalProfileForm({ displayName }: { displayName: string }) {
  const [state, action, pending] = useActionState(updateProfileAction, ACCOUNT_FORM_INITIAL);
  return (
    <form action={action} className="mt-4 flex max-w-md flex-col gap-4">
      <FormField id="displayName" label="Display name">
        {(field) => <TextInput {...field} name="displayName" defaultValue={displayName} maxLength={100} autoComplete="name" />}
      </FormField>
      <Hint>This personal name is separate from what each organization calls you.</Hint>
      <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save profile'}</Button>
      <FormError>{state.error}</FormError>
      {state.message ? <Hint role="status">{state.message}</Hint> : null}
    </form>
  );
}

export function ChangeEmailForm({ email, pendingEmail }: { email: string; pendingEmail: string | null }) {
  const [state, action, pending] = useActionState(changeEmailAction, ACCOUNT_FORM_INITIAL);
  const [codeState, codeAction, sending] = useActionState(requestEmailCodeAction, ACCOUNT_FORM_INITIAL);
  return (
    <div className="mt-4 flex max-w-md flex-col gap-4">
      <Hint>Current email: {email}</Hint>
      {pendingEmail ? <Hint role="status">Awaiting confirmation: {pendingEmail}</Hint> : null}
      <form action={codeAction}>
        <Button type="submit" tone="secondary" disabled={sending || pending}>{sending ? 'Sending…' : 'Send email verification code'}</Button>
        <FormError>{codeState.error}</FormError>
        {codeState.message ? <Hint role="status">{codeState.message}</Hint> : null}
      </form>
      <form action={action} className="flex flex-col gap-4">
        <FormField id="newEmail" label="New email address">
          {(field) => <TextInput {...field} name="email" type="email" required autoComplete="email" />}
        </FormField>
        <FormField id="emailCode" label="Code from your current email">
          {(field) => <TextInput {...field} name="code" required autoComplete="one-time-code" inputMode="numeric" />}
        </FormField>
        <Hint>After verification, confirm the change using the messages sent to both addresses.</Hint>
        <Button type="submit" disabled={pending || sending}>{pending ? 'Requesting…' : 'Change email address'}</Button>
        <FormError>{state.error}</FormError>
        {state.message ? <Hint role="status">{state.message}</Hint> : null}
      </form>
    </div>
  );
}
