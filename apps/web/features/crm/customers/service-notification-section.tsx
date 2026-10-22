'use client';
import { useActionState, useId } from 'react';
import { Button, ButtonLink } from '@/components/controls/button';
import { FormField } from '@/components/controls/form';
import { ErrorText, SelectInput } from '@/components/controls/inputs';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { notificationAction, type ServiceActionState, type readEngagementDetails } from '@/app/organizations/[organizationId]/crm/contacts/[contactId]/service-actions';
import { NOTIFICATION_PURPOSES, NOTIFICATION_STATES } from '@/lib/domain/customers/service-notifications';

type Details = Awaited<ReturnType<typeof readEngagementDetails>>;
export function NotificationChoice({ configuration, maySend, identities, purpose }: { configuration?: Details['notificationConfig']; maySend?: boolean; identities?: Details['emailIdentities']; purpose: keyof typeof NOTIFICATION_PURPOSES }) {
  const recipient = configuration?.recipient;
  const ready = maySend && recipient && !recipient.withdrawn_at && !configuration?.suppressed && recipient.purposes.includes(purpose) && identities?.some(i => i.id === configuration?.senderId);
  return <div className="space-y-1 text-sm"><label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="notify" disabled={!ready}/>{purpose === 'service_review_status_changed' ? 'Email customer about withdrawal' : 'Notify customer by email'}</label>
    <p className="break-words text-xs text-muted">{ready ? `Verified recipient: ${recipient.email_address}. Delivery eligibility is checked again before sending.` : configuration?.suppressed ? 'Email notification unavailable. Communications has suppressed this recipient address. Changing the sender does not remove suppression.' : 'Email notification unavailable. Configure a ready sender below and ask the customer to verify an address and opt in through their Portal.'}</p>
  </div>;
}
export function ServiceNotificationSection({ organizationId, customerId, details, onSaved }: { organizationId: string; customerId: string; details: Details; onSaved: () => void }) {
  const id = useId();
  const [state, action, pending] = useActionState(async (previous: ServiceActionState, form: FormData) => {
    try { const result = await notificationAction(previous, form); if (result.saved) onSaved(); return result; }
    catch { return { saved: false, error: 'Notification settings could not be updated. Refresh and try again.' }; }
  }, { saved: false, error: null });
  const recipient = details.notificationConfig?.recipient;
  const context = <><input type="hidden" name="organizationId" value={organizationId}/><input type="hidden" name="customerId" value={customerId}/></>;
  return <Section><SectionHeading>Customer notifications</SectionHeading>
    <ErrorText role="alert">{state.error}</ErrorText>{state.saved ? <p role="status">Notification configuration updated.</p> : null}
    <p className="break-words text-sm">{recipient ? `${recipient.email_address} — ${recipient.withdrawn_at ? 'Consent withdrawn' : 'Verified'}` : 'No verified notification recipient.'}</p>
    {details.notificationConfig?.suppressed ? <p className="text-sm">Delivery suppressed by Communications.</p> : null}
    {recipient && !recipient.withdrawn_at ? <ul className="text-sm">{Object.entries(NOTIFICATION_PURPOSES).map(([key, label]) => <li key={key}>{label}: {recipient.purposes.includes(key) ? 'Enabled' : 'Off'}</li>)}</ul> : null}
    {details.maySend && details.emailIdentities.length ? <form action={action} className="mt-3 space-y-3">{context}<input type="hidden" name="operation" value="sender"/>
      <FormField id={`${id}-sender`} label="Communications email identity">{p => <SelectInput {...p} className="w-full [&>select]:min-h-11 sm:[&>select]:min-h-0" name="emailIdentityId" defaultValue={details.notificationConfig?.senderId ?? ''} required><option value="" disabled>Choose a ready sender</option>{details.emailIdentities.map(i => <option key={i.id} value={i.id}>{i.address}</option>)}</SelectInput>}</FormField>
      <Button className="min-h-11 sm:min-h-0" type="submit" disabled={pending}>Save notification sender</Button>
    </form> : <p className="text-sm text-muted">{details.maySend ? 'No ready email identity. Configure Communications email before requesting confirmation.' : 'Email sending permission is required to configure delivery.'}</p>}
    <ButtonLink className="min-h-11 sm:min-h-0" tone="text" href={`/organizations/${organizationId}/settings/email`}>Email sending settings</ButtonLink>
    <details className="mt-3"><summary className="min-h-11 cursor-pointer py-2 text-sm">Delivery history ({details.notifications.length})</summary>
      {!details.notifications.length ? <p className="text-sm">No notification intent recorded.</p> : <ol className="space-y-4">{details.notifications.map(n => <li key={n.id} className="space-y-1 border-t border-border pt-3 text-sm">
        <p>{NOTIFICATION_PURPOSES[n.purpose]} — {NOTIFICATION_STATES[n.state] ?? 'Unavailable'}</p><p className="text-xs text-muted">{new Date(n.createdAt).toLocaleString('en-GB', { timeZone: details.timezone })}</p>
        {n.recipient ? <p className="break-words">Recipient: {n.recipient}</p> : null}{n.reason ? <p>{n.reason}</p> : null}
        <details><summary className="min-h-11 cursor-pointer py-2">View delivery details</summary><div className="space-y-2"><p className="break-words">Sender: {n.sender ?? 'Not queued'}</p><p>Message: {n.messageId ?? 'Not created'}</p>
          {n.attempts.map((a, index) => <p key={index}>Attempt {index + 1}: {a.outcome ?? 'In progress'}{a.detail ? ` — ${a.detail}` : ''}</p>)}
          {n.events.filter(e => !['opened', 'clicked'].includes(e.type)).map((e, index) => <p key={index}>{e.type} — {new Date(e.at).toLocaleString('en-GB', { timeZone: details.timezone })}</p>)}
        </div></details>
        {n.mayRetry ? <form action={action}>{context}<input type="hidden" name="operation" value="retry"/><input type="hidden" name="intentId" value={n.id}/><Button className="min-h-11 sm:min-h-0" type="submit" tone="secondary" disabled={pending}>Retry notification</Button></form> : null}
      </li>)}</ol>}
    </details>
  </Section>;
}
