'use client';
import { startTransition, useActionState, useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/controls/button';
import { FormField } from '@/components/controls/form';
import { ErrorText, TextInput } from '@/components/controls/inputs';
import { notificationPreferenceAction, type NotificationPreferenceState } from '@/app/(public)/portal/notification-actions';
import { NOTIFICATION_PURPOSES, type NotificationPreferences } from '@/lib/domain/customers/service-notifications';

export function CustomerNotificationPreferences({ preferences }: { preferences: NotificationPreferences | null }) {
  const id = useId();
  const [email, setEmail] = useState(preferences?.emailAddress ?? '');
  const [purposes, setPurposes] = useState<string[]>([]);
  const [state, action, pending] = useActionState(notificationPreferenceAction, { error: null, message: null } as NotificationPreferenceState);
  const feedback = useRef<HTMLParagraphElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state.challengeId) codeInput.current?.focus();
    else if (state.message) feedback.current?.focus();
  }, [state.challengeId, state.message]);
  return <details className="mt-6 border-t border-border pt-3"><summary className="min-h-11 cursor-pointer py-2 font-medium">Email notifications</summary><div className="space-y-4">
    <ErrorText role="alert">{state.error}</ErrorText>{state.message ? <p ref={feedback} tabIndex={-1} role="status" className="text-sm">{state.message}</p> : null}
    {preferences ? <div className="space-y-2 text-sm"><p className="break-words">{preferences.emailAddress} — Verified{preferences.withdrawnAt ? ', notifications off' : ''}</p><ul>{Object.entries(NOTIFICATION_PURPOSES).map(([key, label]) => <li key={key}>{label}: {!preferences.withdrawnAt && preferences.purposes.includes(key) ? 'Enabled' : 'Off'}</li>)}</ul>
      {!preferences.withdrawnAt && preferences.mayWithdraw ? <form action={action}><input type="hidden" name="operation" value="withdraw"/><Button className="min-h-11 sm:min-h-0" type="submit" tone="secondary" disabled={pending}>Turn off email notifications</Button></form> : null}
    </div> : <p className="text-sm">Confirm your email in this session to view or change notification preferences.</p>}
    <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(() => action(form)); }} className="space-y-3"><input type="hidden" name="operation" value="propose"/>
      <FormField id={`${id}-email`} label="Notification email address">{p => <TextInput {...p} className="min-h-11 sm:min-h-0" type="email" name="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)}/>}</FormField>
      <fieldset><legend className="text-sm font-medium">Send me email about</legend>{Object.entries(NOTIFICATION_PURPOSES).map(([key, label]) => <label key={key} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="purposes" value={key} checked={purposes.includes(key)} onChange={e => { const checked = e.currentTarget.checked; setPurposes(current => checked ? [...current, key] : current.filter(p => p !== key)); }}/>{label}</label>)}</fieldset>
      <p className="text-xs text-muted">Select the purposes you want. A confirmation code verifies control of your inbox. Portal access alone does not enable email.</p>
      <Button className="min-h-11 sm:min-h-0" type="submit" disabled={pending}>Send confirmation code</Button>
    </form>
    {state.challengeId ? <form action={action} className="space-y-3"><input type="hidden" name="operation" value="confirm"/><input type="hidden" name="challengeId" value={state.challengeId}/>
      <FormField id={`${id}-code`} label="Email confirmation code">{p => <TextInput {...p} ref={codeInput} className="min-h-11 sm:min-h-0" name="code" autoComplete="one-time-code" required maxLength={16} minLength={16}/>}</FormField>
      <Button className="min-h-11 sm:min-h-0" type="submit" disabled={pending}>Verify address and save preferences</Button>
    </form> : null}
  </div></details>;
}
