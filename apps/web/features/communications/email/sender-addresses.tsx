'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, Hint } from '@/components/controls/inputs';
import { Badge } from '@/components/display/data';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { setDefaultEmailSenderAction, type EmailDomainState } from '@/app/organizations/[organizationId]/settings/email/actions';
import type { EmailSender } from '@/lib/domain/email/sender';
import { AddAddressForm } from './email-addresses';

const INITIAL: EmailDomainState = { error: null, notice: null, done: false };

const STATE_LABEL: Record<EmailSender['state'], string> = {
  ready: 'Ready to send',
  not_ready: 'Not ready yet',
  unavailable: 'Temporarily unavailable',
};

function MakeDefault({ organizationId, sender }: { organizationId: string; sender: EmailSender }) {
  const [state, run, pending] = useActionState(setDefaultEmailSenderAction, INITIAL);
  return (
    <form action={run} className="flex flex-col items-start gap-1">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="emailIdentityId" value={sender.emailIdentityId} />
      <Button type="submit" tone="secondary" size="small" disabled={pending}>
        {pending ? 'Saving…' : 'Make default'}
      </Button>
      {state.error ? <ErrorText>{state.error}</ErrorText> : null}
    </form>
  );
}

/**
 * The addresses this business sends from, each answered by the same check a send makes, and the
 * one it sends from by default. Choosing the default is a choice among these rows, so it is made on
 * the row: only an address that is ready can become it.
 */
export function SenderAddresses({
  organizationId,
  senders,
  domains,
}: {
  organizationId: string;
  senders: EmailSender[];
  domains: { resourceId: string; domain: string; ready: boolean }[];
}) {
  return (
    <Section className="mt-8">
      <SectionHeading>Sender addresses</SectionHeading>
      <Hint className="mt-1">
        Addresses on your verified domains that email can come from. Booking confirmations, automation messages and
        service notifications use the default address; the Inbox replies from the address a conversation is on.
      </Hint>

      {senders.length === 0 ? (
        <Hint className="mt-3">No sender address yet. Add one below once a domain is verified.</Hint>
      ) : (
        <ul className="mt-3 divide-y divide-border border-y border-border">
          {senders.map((sender) => (
            <li key={sender.emailIdentityId} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-all text-sm font-medium">{sender.address}</span>
                  {sender.isDefault ? <Badge tone="accent">Default</Badge> : null}
                </div>
                {sender.displayName ? <div className="text-xs text-muted">Shown as {sender.displayName}</div> : null}
                <div className="mt-1 text-sm">{STATE_LABEL[sender.state]}</div>
                {sender.detail ? <div className="text-xs text-muted">{sender.detail}</div> : null}
              </div>
              {sender.state === 'ready' && !sender.isDefault ? <MakeDefault organizationId={organizationId} sender={sender} /> : null}
            </li>
          ))}
        </ul>
      )}

      <AddAddressForm organizationId={organizationId} domains={domains} />
    </Section>
  );
}
