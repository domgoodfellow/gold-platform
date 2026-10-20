'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, Hint, SelectInput } from '@/components/controls/inputs';
import { Section, SectionHeading } from '@/components/surfaces/section';
import {
  sendTestEmailAction,
  setEmailReplyToAction,
  type EmailDomainState,
} from '@/app/organizations/[organizationId]/settings/email/actions';
import type { EmailSender, EmailTestSend } from '@/lib/domain/email/sender';

const INITIAL: EmailDomainState = { error: null, notice: null, done: false };

/**
 * Where replies go. Only an address on a domain this business has proved can be chosen — a typed
 * address cannot be, because nobody has shown the business controls it. Choosing nothing sends
 * replies to the default sender address.
 */
export function ReplyToForm({ organizationId, senders, hasDefault }: { organizationId: string; senders: EmailSender[]; hasDefault: boolean }) {
  const [state, run, pending] = useActionState(setEmailReplyToAction, INITIAL);
  const eligible = senders.filter((sender) => sender.canTakeReplies);
  const current = senders.find((sender) => sender.isReplyTo) ?? null;
  return (
    <Section className="mt-8">
      <SectionHeading>Where replies go</SectionHeading>
      <Hint className="mt-1 max-w-prose">
        When a customer replies to a booking confirmation, automation message or notification, the reply goes to the
        default sender address unless you choose another of your addresses here. Only addresses on your verified domains
        can be chosen.
      </Hint>
      {!hasDefault ? (
        <Hint className="mt-3">Choose a default sender first.</Hint>
      ) : (
        <form action={run} className="mt-3 flex flex-wrap items-center gap-2">
          <input type="hidden" name="organizationId" value={organizationId} />
          <SelectInput name="emailIdentityId" aria-label="Reply-To address" defaultValue={current?.emailIdentityId ?? ''}>
            <option value="">The default sender address</option>
            {eligible.map((sender) => (
              <option key={sender.emailIdentityId} value={sender.emailIdentityId}>{sender.address}</option>
            ))}
          </SelectInput>
          <Button type="submit" tone="secondary" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
          {state.notice ? <Hint role="status">{state.notice}</Hint> : null}
          {state.error ? <ErrorText>{state.error}</ErrorText> : null}
        </form>
      )}
      {current && !current.receivesInInbox ? (
        <Hint className="mt-2 max-w-prose">
          Replies to {current.address} go wherever that address&rsquo;s mail is delivered today. They appear in the Inbox only
          if the address receives into the Inbox (Communications → Inbox email).
        </Hint>
      ) : null}
    </Section>
  );
}

const TEST_STATE: Record<EmailTestSend['state'], string> = {
  sending: 'Sending',
  sent: 'Accepted for delivery',
  failed: 'Not sent',
  uncertain: 'Uncertain — may or may not have been sent',
};

const REPORT: Record<string, string> = { delivered: 'Delivered', delayed: 'Delivery delayed', bounced: 'Bounced', complained: 'Marked as spam', failed: 'Failed', rejected: 'Rejected' };

/** A test from the default sender to the manager's own sign-in address — never to anyone else. */
export function TestSendForm({ organizationId, ready, tests }: { organizationId: string; ready: boolean; tests: EmailTestSend[] }) {
  const [state, run, pending] = useActionState(sendTestEmailAction, INITIAL);
  return (
    <Section className="mt-8">
      <SectionHeading>Send a test email</SectionHeading>
      <Hint className="mt-1 max-w-prose">
        Sends one short test from your default sender to your own sign-in email address, to check that email from your
        business arrives. A few tests can be sent each hour.
      </Hint>
      <form action={run} className="mt-3 flex flex-wrap items-center gap-2">
        <input type="hidden" name="organizationId" value={organizationId} />
        <Button type="submit" tone="secondary" disabled={pending || !ready}>{pending ? 'Sending…' : 'Send test email to me'}</Button>
        {!ready ? <Hint>Available once a default sender is ready.</Hint> : null}
      </form>
      {state.notice ? <Hint role="status" className="mt-2">{state.notice}</Hint> : null}
      {state.error ? <p role="status" className="mt-2 text-sm text-danger">{state.error}</p> : null}
      {tests.length ? (
        <ul aria-label="Recent test emails" className="mt-3 divide-y divide-border border-y border-border text-sm">
          {tests.map((test) => (
            <li key={test.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span>{new Date(test.createdAt).toLocaleString()} · to {test.recipient}</span>
              <span>{test.providerState ? REPORT[test.providerState] ?? test.providerState : TEST_STATE[test.state]}</span>
              {test.detail ? <span className="w-full text-xs text-muted">{test.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}
