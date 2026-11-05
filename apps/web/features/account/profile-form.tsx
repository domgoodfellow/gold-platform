'use client';

import { PhoneInput } from '@/components/controls/phone-input';
import { useActionState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@gold/ui/components/avatar';
import { Button } from '@/components/controls/button';
import { FormError, FormField } from '@/components/controls/form';
import { Hint, TextInput } from '@/components/controls/inputs';
import { Card } from '@/components/surfaces/card';
import { SectionHeading } from '@/components/surfaces/section';
import { changeEmailAction, requestEmailCodeAction, updateProfileAction } from '@/app/settings/account/actions';
import type { AccountProfile } from '@/lib/domain/identity/profile';
import { ACCOUNT_FORM_INITIAL } from './account-form-state';

const names = [
  { name: 'given_name', label: 'Given name', autoComplete: 'given-name', maxLength: 100 },
  { name: 'family_name', label: 'Family name', autoComplete: 'family-name', maxLength: 100 },
  { name: 'preferred_name', label: 'Preferred name', autoComplete: 'nickname', maxLength: 100 },
] as const;
const contacts = [
  { name: 'phone_e164', label: 'Phone number', autoComplete: 'tel', maxLength: 16 },
  { name: 'address_line_1', label: 'Address line 1', autoComplete: 'address-line1', maxLength: 200 },
  { name: 'address_line_2', label: 'Address line 2', autoComplete: 'address-line2', maxLength: 200 },
  { name: 'city', label: 'City', autoComplete: 'address-level2', maxLength: 100 },
  { name: 'administrative_area', label: 'Province / State / Region', autoComplete: 'address-level1', maxLength: 100 },
  { name: 'postal_code', label: 'Postal code', autoComplete: 'postal-code', maxLength: 32 },
  { name: 'country_code', label: 'Country', autoComplete: 'country', maxLength: 2 },
] as const;
const panel = 'min-w-0 p-5 sm:p-6 shadow-none';
const grid = 'grid min-w-0 gap-4 sm:grid-cols-2';

export function PersonalProfileForm({ profile, email }: { profile: AccountProfile; email: string }) {
  const [state, action, pending] = useActionState(updateProfileAction, ACCOUNT_FORM_INITIAL);
  const displayName = profile.preferred_name || [profile.given_name, profile.family_name].filter(Boolean).join(' ');
  const initials = (profile.preferred_name || [profile.given_name, profile.family_name].filter(Boolean).join(' '))
    .trim().split(/\s+/).filter(Boolean).map((part) => Array.from(part)[0]).slice(0, 2).join('').toUpperCase() || '?';
  return (
    <form action={action} aria-label="Personal profile" className="flex flex-col gap-6" aria-busy={pending}>
      <Card as="section" aria-labelledby="personal-profile-heading" className={panel}>
        <SectionHeading id="personal-profile-heading">Personal profile</SectionHeading>
        <div className="mt-6 grid min-w-0 gap-6 md:grid-cols-[9rem_minmax(0,1fr)]">
          <div className="flex items-center gap-4 md:flex-col md:items-start">
            <Avatar className="size-20" role="img" aria-label={displayName ? `Profile photo for ${displayName}` : 'Profile photo'}>
              {profile.avatar ? <AvatarImage src={profile.avatar} alt="" /> : null}
              <AvatarFallback className="text-xl">{initials}</AvatarFallback>
            </Avatar>
            <Hint className="max-w-48 text-xs">Your photo, when available, comes from your sign-in provider.</Hint>
          </div>
          <div className={grid}>
            {names.map(({ name, label, autoComplete, maxLength }) => (
              <FormField key={name} id={name} label={label} className={name === 'preferred_name' ? 'sm:col-span-2' : undefined}>
                {(field) => <TextInput {...field} name={name} defaultValue={profile[name]} maxLength={maxLength} autoComplete={autoComplete} />}
              </FormField>
            ))}
            <Hint className="sm:col-span-2">Your preferred name is used across GildOps. A business can set an optional name override.</Hint>
          </div>
        </div>
      </Card>
      <Card as="section" aria-labelledby="contact-heading" className={panel}>
        <SectionHeading id="contact-heading">Contact information</SectionHeading>
        <div className={`mt-6 ${grid}`}>
          <FormField id="profile-email" label="Email" hint="Change your sign-in email using the verification flow below.">
            {(field) => <TextInput {...field} type="email" autoComplete="email" value={email} readOnly />}
          </FormField>
          {contacts.map(({ name, label, autoComplete, maxLength }) => (
            <FormField key={name} id={name} label={label}
              hint={name === 'phone_e164' ? 'Include + and country code, without spaces: +14165550142.' : undefined}>
              {(field) => name === 'phone_e164' ? <PhoneInput {...field} name={name} defaultValue={profile[name] ?? ''} maxLength={maxLength} autoComplete={autoComplete} /> : <TextInput {...field} name={name} defaultValue={profile[name] ?? ''} maxLength={maxLength} autoComplete={autoComplete} />}
            </FormField>
          ))}
        </div>
        <Hint className="mt-3">Optional personal contact details, private to your account. For Country, use a two-letter code such as CA, GB or JP.</Hint>
      </Card>
      <Card as="section" aria-labelledby="regional-heading" className={panel}>
        <SectionHeading id="regional-heading">Regional preferences</SectionHeading>
        <div className={`mt-6 ${grid}`}>
          <FormField id="locale" label="Language" hint="Language code, such as en, fr or ja.">
            {(field) => <TextInput {...field} name="locale" defaultValue={profile.locale} maxLength={64} autoComplete="language" required />}
          </FormField>
          <FormField id="timezone" label="Time zone" hint="IANA time zone, such as America/Toronto or Europe/Paris.">
            {(field) => <TextInput {...field} name="timezone" defaultValue={profile.timezone} maxLength={100} autoComplete="off" required />}
          </FormField>
        </div>
      </Card>
      <div className="flex flex-col gap-3 sm:items-end">
        <FormError>{state.error}</FormError>
        {state.message ? <Hint role="status">{state.message}</Hint> : null}
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">{pending ? 'Saving\u2026' : 'Save profile'}</Button>
      </div>
    </form>
  );
}

export function ChangeEmailForm({ email, pendingEmail }: { email: string; pendingEmail: string | null }) {
  const [state, action, pending] = useActionState(changeEmailAction, ACCOUNT_FORM_INITIAL);
  const [codeState, codeAction, sending] = useActionState(requestEmailCodeAction, ACCOUNT_FORM_INITIAL);
  return (
    <Card as="section" aria-labelledby="email-change-heading" className={panel}>
      <SectionHeading id="email-change-heading">Email verification / change email</SectionHeading>
      <div className="mt-6 flex flex-col gap-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0"><Hint>Current email</Hint><p className="break-all text-sm font-medium">{email}</p></div>
          <form action={codeAction} className="flex flex-col gap-2">
            <Button type="submit" tone="secondary" disabled={sending || pending}>{sending ? 'Sending\u2026' : 'Send email verification code'}</Button>
            <FormError>{codeState.error}</FormError>
            {codeState.message ? <Hint role="status">{codeState.message}</Hint> : null}
          </form>
        </div>
        {pendingEmail ? <Hint role="status" className="break-all">Awaiting confirmation: {pendingEmail}</Hint> : null}
        <form action={action} aria-label="Change email address" className="flex flex-col gap-4">
          <div className={grid}>
            <FormField id="newEmail" label="New email address">
              {(field) => <TextInput {...field} name="email" type="email" required autoComplete="email" />}
            </FormField>
            <FormField id="emailCode" label="Code from your current email">
              {(field) => <TextInput {...field} name="code" required autoComplete="one-time-code" inputMode="numeric" />}
            </FormField>
          </div>
          <Hint>After verification, confirm the change using the messages sent to both addresses.</Hint>
          <FormError>{state.error}</FormError>
          {state.message ? <Hint role="status">{state.message}</Hint> : null}
          <Button type="submit" className="w-full sm:w-auto sm:self-end" disabled={pending || sending}>{pending ? 'Requesting\u2026' : 'Change email address'}</Button>
        </form>
      </div>
    </Card>
  );
}
