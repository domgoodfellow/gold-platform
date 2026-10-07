'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { FormError, FormField } from '@/components/controls/form';
import { Hint, TextInput } from '@/components/controls/inputs';
import { changeEmailAction, requestEmailCodeAction, updateProfileAction } from '@/app/settings/account/actions';
import { ACCOUNT_FORM_INITIAL } from './account-form-state';

export function PersonalProfileForm({ profile }: { profile: import('@/lib/domain/identity/profile').AccountProfile }) {
  const [state, action, pending] = useActionState(updateProfileAction, ACCOUNT_FORM_INITIAL);
  const fields = [
    { name: 'given_name', label: 'Given name', autoComplete: 'given-name', maxLength: 100 },
    { name: 'family_name', label: 'Family name', autoComplete: 'family-name', maxLength: 100 },
    { name: 'preferred_name', label: 'Preferred name', autoComplete: 'nickname', maxLength: 100 },
    { name: 'avatar', label: 'Avatar URL', autoComplete: 'url', maxLength: 2048 },
    { name: 'locale', label: 'Language', autoComplete: 'language', maxLength: 64 },
    { name: 'timezone', label: 'Timezone', autoComplete: 'off', maxLength: 100 },
  ] as const;
  return (
    <form action={action} className="mt-4 flex max-w-md flex-col gap-4">
      {fields.map(({ name, label, autoComplete, maxLength }) => (
        <FormField key={name} id={name} label={label}>
          {(field) => <TextInput {...field} name={name} defaultValue={profile[name] ?? ''} maxLength={maxLength} autoComplete={autoComplete} required={name === 'locale' || name === 'timezone'} type={name === 'avatar' ? 'url' : 'text'} />}
        </FormField>
      ))}
      <Hint>Your preferred name is used across GildOps. A business can set an optional name override.</Hint>
      <Button type="submit" disabled={pending}>{pending ? 'Saving?' : 'Save profile'}</Button>
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
