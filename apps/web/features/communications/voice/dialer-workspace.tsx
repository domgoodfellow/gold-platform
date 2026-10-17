'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, ButtonLink } from '@/components/controls/button';
import { Hint } from '@/components/controls/inputs';
import { Section, SectionHeading } from '@/components/surfaces/section';
import type { CallingOptions } from '@/lib/application/communications/calling-options';
import type { DialerQueueEntry } from '@/lib/application/communications/dialer-queue';
import { NewCallForm } from './new-call-form';
import { useTelephoneDevice } from './telephone-device';
import { useDialerPopout } from './dialer-popout-context';

export function DialerWorkspace({ organizationId, timezone, queue, queueTotal, queueAvailable, options }: {
  organizationId: string;
  timezone: string;
  queue: DialerQueueEntry[];
  queueTotal: number;
  queueAvailable: boolean;
  options: CallingOptions;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(queue[0]?.followUp.id ?? null);
  const selected = queue.find(entry => entry.followUp.id === selectedId);
  const { activeCall, incoming } = useTelephoneDevice();
  const popout = useDialerPopout();
  const date = new Intl.DateTimeFormat('en', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' });

  return <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
    <Section>
      <SectionHeading>Call queue</SectionHeading>
      {!queueAvailable ? <Hint>Call follow-ups are unavailable for this business.</Hint> : queue.length === 0 ? <Hint>No open call follow-ups.</Hint> : <ul className="mt-3 space-y-2">
        {queue.map(({ followUp }) => <li key={followUp.id}>
          <button type="button" aria-pressed={selectedId === followUp.id} onClick={() => setSelectedId(followUp.id)} className="flex min-h-11 w-full flex-col gap-1 rounded-md border border-border p-3 text-left hover:bg-hover aria-pressed:bg-selected focus-visible:outline-2 focus-visible:outline-offset-2">
            <span className="font-medium">{followUp.customerName}</span>
            <span className="text-sm">{followUp.title}</span>
            <span className="text-xs text-muted">{date.format(new Date(followUp.dueAt))}{followUp.ownerName ? ` · ${followUp.ownerName}` : ''}</span>
          </button>
        </li>)}
      </ul>}
      {queueAvailable ? <div className="mt-3 space-y-2">
        {queueTotal > queue.length ? <Hint>Showing the first {queue.length} of {queueTotal} open call follow-ups, earliest due first.</Hint> : null}
        <ButtonLink tone="text" href={`/organizations/${organizationId}/follow-ups?status=open&kind=call`}>All call follow-ups</ButtonLink>
      </div> : null}
    </Section>
    <Section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SectionHeading>{selected ? `Call ${selected.customer?.name ?? selected.followUp.customerName}` : 'New call'}</SectionHeading>
        {selected ? <Button type="button" tone="text" onClick={() => setSelectedId(null)}>Dial another number</Button> : null}
      </div>
      {activeCall || incoming ? <div className="mb-3 space-y-2" role="status">
        <p>{activeCall ? `Current call: ${activeCall.contactLabel}` : 'Incoming call'}</p>
        {popout ? <Button type="button" tone="secondary" onClick={() => popout.open()}>Open live call controls</Button> : null}
      </div> : null}
      {options.unavailableReason ? <Hint className="mb-3">{options.unavailableReason}</Hint> : null}
      {selected && !selected.customer?.phone ? <Hint className="mb-3">No customer phone number is recorded. Open the customer to add one, or dial another number.</Hint> : null}
      <NewCallForm key={selected?.followUp.id ?? 'manual'} organizationId={organizationId} numbers={options.numbers} defaultNumber={options.defaultNumber} toNumber={selected?.customer?.phone ?? ''} customerId={selected?.customer?.id} customerName={selected?.customer?.name} />
    </Section>
    <Section>
      <SectionHeading>Customer context</SectionHeading>
      {selected ? <div className="mt-3 space-y-3">
        <Link className="font-medium underline underline-offset-4" href={`/organizations/${organizationId}/customers/${selected.followUp.customerId}`}>{selected.customer?.name ?? selected.followUp.customerName}</Link>
        {selected.customer ? <dl className="space-y-2 text-sm">
          <div><dt className="text-muted">Phone</dt><dd>{selected.customer.phone ?? 'Not recorded'}</dd></div>
          <div><dt className="text-muted">Email</dt><dd>{selected.customer.email ?? 'Not recorded'}</dd></div>
        </dl> : <Hint>Customer details are unavailable.</Hint>}
        <p className="text-sm font-medium">{selected.followUp.title}</p>
        {selected.followUp.notes ? <p className="whitespace-pre-wrap text-sm">{selected.followUp.notes}</p> : null}
        {selected.followUp.opportunityId ? <Link className="block text-sm underline underline-offset-4" href={`/organizations/${organizationId}/opportunities/${selected.followUp.opportunityId}`}>{selected.followUp.opportunityTitle ?? 'Open opportunity'}</Link> : null}
      </div> : <Hint className="mt-3">Select a call follow-up to see the customer and its recorded context.</Hint>}
    </Section>
  </div>;
}
