'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { FormField } from '@/components/controls/form';
import { ErrorText, TextArea, TextInput } from '@/components/controls/inputs';
import { contactSupportAction, type ContactSupportState } from '@/app/organizations/[organizationId]/help/contact/actions';

const INITIAL: ContactSupportState = { error: null, sent: false };

export function ContactSupportForm({ organizationId, page }: { organizationId: string; page: string | null }) {
  const [state, formAction, pending] = useActionState(contactSupportAction, INITIAL);

  if (state.sent) {
    return (
      <div role="status" className="rounded-lg border border-border p-4">
        <p className="font-medium">Your request has been sent to GildOps.</p>
        <p className="mt-1 text-sm text-muted">It is recorded against your business and your account. You do not need to send it again.</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      {page ? <input type="hidden" name="page" value={page} /> : null}
      <FormField id="support-subject" label="Subject">
        {(field) => <TextInput {...field} name="subject" required maxLength={200} />}
      </FormField>
      <FormField id="support-message" label="What do you need help with?" hint="Do not include passwords or card numbers.">
        {(field) => <TextArea {...field} name="message" required rows={7} maxLength={5000} />}
      </FormField>
      <div className="flex flex-col items-start gap-3">
        <Button type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send to GildOps'}</Button>
        <ErrorText role="alert">{state.error}</ErrorText>
      </div>
    </form>
  );
}
