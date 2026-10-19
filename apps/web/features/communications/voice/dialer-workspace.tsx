'use client';

import Link from 'next/link';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button, ButtonLink } from '@/components/controls/button';
import { Hint, TextInput } from '@/components/controls/inputs';
import { cx } from '@/components/class-names';
import { tabListStyles, tabTriggerStyles } from '@gold/ui/components/tab-styles';
import { Section, SectionHeading } from '@/components/surfaces/section';
import type { CallingOptions } from '@/lib/application/communications/calling-options';
import type { DialerQueueEntry } from '@/lib/application/communications/dialer-queue';
import { ActiveCallDock } from './active-call-dock';
import { NewCallForm } from './new-call-form';
import { useTelephoneDevice, type DeviceStatus } from './telephone-device';
import { useDialerPopout } from './dialer-popout-context';

type Mode = 'standard' | 'focus';
type Panel = 'queue' | 'call' | 'context';

const FORM_ID = 'dialer-call-form';
const DEVICE_LABEL: Record<DeviceStatus, string> = {
  offline: 'Connects when you call',
  connecting: 'Connecting',
  ready: 'Connected',
  error: 'Connection failed',
};
const PANELS: { key: Panel; label: string }[] = [
  { key: 'queue', label: 'Queue' },
  { key: 'call', label: 'Calling' },
  { key: 'context', label: 'Customer' },
];

/**
 * The Dialer's operating console: queue, calling and customer context as three regions of one page.
 * Standard is the default and shows every region the operator has not hidden; Focus keeps only the
 * calling region. Pop-out moves the live controls into a separate window through the same telephone.
 *
 * **Choosing a queue row never dials.** It fills the number and the customer context. A live call
 * keeps its own controls: the dock shows the call, not whichever row is highlighted.
 *
 * **The queue search covers only the follow-ups loaded here** (the first page, earliest due first),
 * so it says so rather than pretending to search the whole queue.
 *
 * `history` is the page's own call history and counters. It sits beneath the console and leaves
 * Focus mode with everything else that is not the call.
 */
export function DialerWorkspace({ organizationId, timezone, queue, queueTotal, queueAvailable, options, prefill = '', history }: {
  organizationId: string;
  timezone: string;
  queue: DialerQueueEntry[];
  queueTotal: number;
  queueAvailable: boolean;
  options: CallingOptions;
  /** A number to dial, from a link such as Call back. Chosen over a queue row only when no row is selected. */
  prefill?: string;
  history?: ReactNode;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(prefill ? null : queue[0]?.followUp.id ?? null);
  const [mode, setMode] = useState<Mode>('standard');
  const [showQueue, setShowQueue] = useState(true);
  const [showContext, setShowContext] = useState(true);
  const [panel, setPanel] = useState<Panel>('call');
  const [search, setSearch] = useState('');
  const [dueOnly, setDueOnly] = useState(false);
  const [now] = useState(() => Date.now());
  const selected = queue.find(entry => entry.followUp.id === selectedId);
  const { activeCall, incoming, status } = useTelephoneDevice();
  const popout = useDialerPopout();
  const setInlineHost = popout?.setInlineHost;
  const date = new Intl.DateTimeFormat('en', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' });

  // While this page is open it draws the live controls itself, so the organization dock steps aside.
  useEffect(() => {
    setInlineHost?.(true);
    return () => setInlineHost?.(false);
  }, [setInlineHost]);

  const focus = mode === 'focus';
  const queueShown = showQueue && !focus;
  const contextShown = showContext && !focus;
  const columns = [queueShown && 'minmax(15rem,1fr)', 'minmax(0,2fr)', contextShown && 'minmax(15rem,1fr)'].filter(Boolean).join(' ');
  const needle = search.trim().toLowerCase();
  const visible = queue.filter(({ followUp, customer }) => {
    if (dueOnly && new Date(followUp.dueAt).getTime() > now) return false;
    if (!needle) return true;
    return [followUp.customerName, followUp.title, followUp.ownerName, customer?.phone].filter(Boolean).join(' ').toLowerCase().includes(needle);
  });
  const panelClass = (active: boolean, shownOnDesktop: boolean) => cx(active ? 'block' : 'hidden', shownOnDesktop ? 'lg:block' : 'lg:hidden');
  const live = activeCall !== null || incoming !== null;

  return <div className="mt-6 space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div role="group" aria-label="Presentation" data-slot="tabs-list" data-variant="segmented" className={tabListStyles()}>
        <button type="button" data-slot="tabs-trigger" aria-pressed={mode === 'standard'} className={tabTriggerStyles} onClick={() => setMode('standard')}>Standard</button>
        <button type="button" data-slot="tabs-trigger" aria-pressed={focus} className={tabTriggerStyles} onClick={() => setMode('focus')}>Focus</button>
        {popout ? <button type="button" data-slot="tabs-trigger" data-dialer-popout-trigger aria-pressed={popout.container !== null} className={tabTriggerStyles} onClick={() => popout.open()}><ExternalLink aria-hidden className="size-4" /> Pop-out</button> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" tone="secondary" size="small" aria-pressed={queueShown} disabled={focus} onClick={() => setShowQueue(value => !value)}>Call queue</Button>
        <Button type="button" tone="secondary" size="small" aria-pressed={contextShown} disabled={focus} onClick={() => setShowContext(value => !value)}>Customer context</Button>
      </div>
    </div>

    {/* Below desktop width one region is shown at a time; a live call is never out of reach. */}
    <div role="group" aria-label="Dialer region" className="flex gap-1 lg:hidden">
      {PANELS.map(({ key, label }) => <Button key={key} type="button" tone="secondary" size="small" aria-pressed={panel === key} onClick={() => setPanel(key)}>{label}</Button>)}
    </div>
    {live && panel !== 'call' ? <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm lg:hidden">
      <span>{incoming ? 'Incoming call' : `On a call with ${activeCall?.contactLabel ?? 'a caller'}`}</span>
      <Button type="button" tone="secondary" size="small" onClick={() => setPanel('call')}>Show call controls</Button>
    </div> : null}

    <div className="grid min-w-0 gap-4 lg:gap-6 lg:grid-cols-(--dialer-columns)" style={{ '--dialer-columns': columns } as CSSProperties}>
      <Section className={panelClass(panel === 'queue', queueShown)}>
        <div className="flex items-baseline justify-between gap-2">
          <SectionHeading>Call queue</SectionHeading>
          {queueAvailable ? <span className="text-sm text-muted">{queueTotal} open</span> : null}
        </div>
        {!queueAvailable ? <Hint className="mt-3">Call follow-ups are unavailable for this business.</Hint> : queue.length === 0 ? <Hint className="mt-3">No open call follow-ups.</Hint> : <>
          <div className="mt-3 flex flex-col gap-2">
            <TextInput type="search" aria-label="Search loaded call follow-ups" placeholder="Search loaded follow-ups" value={search} onChange={event => setSearch(event.target.value)} />
            <div role="group" aria-label="Queue filter" className="flex gap-1">
              <Button type="button" tone="secondary" size="small" aria-pressed={!dueOnly} onClick={() => setDueOnly(false)}>All</Button>
              <Button type="button" tone="secondary" size="small" aria-pressed={dueOnly} onClick={() => setDueOnly(true)}>Due now</Button>
            </div>
            <Hint>Searches the {queue.length} follow-ups loaded here, not the whole queue.</Hint>
          </div>
          {visible.length === 0 ? <Hint className="mt-3">No loaded follow-ups match.</Hint> : <ul className="mt-3 space-y-2">
            {visible.map(({ followUp, customer }) => <li key={followUp.id}>
              <button type="button" aria-pressed={selectedId === followUp.id} onClick={() => setSelectedId(followUp.id)} className="flex min-h-11 w-full flex-col gap-1 rounded-md border border-border p-3 text-left hover:bg-hover aria-pressed:bg-selected focus-visible:outline-2 focus-visible:outline-offset-2">
                <span className="font-medium">{followUp.customerName}</span>
                <span className="text-sm">{followUp.title}</span>
                <span className="text-xs text-muted">{date.format(new Date(followUp.dueAt))}{followUp.ownerName ? ` · ${followUp.ownerName}` : ''}{customer?.phone ? ` · ${customer.phone}` : ''}</span>
              </button>
            </li>)}
          </ul>}
          {queueTotal > queue.length ? <Hint className="mt-3">Showing the first {queue.length} of {queueTotal} open call follow-ups, earliest due first.</Hint> : null}
          {selected?.customer?.phone ? <Button type="submit" form={FORM_ID} className="mt-4 w-full" disabled={live}>Start calling</Button> : null}
        </>}
        {queueAvailable ? <div className="mt-3"><ButtonLink tone="text" href={`/organizations/${organizationId}/follow-ups?status=open&kind=call`}>All call follow-ups</ButtonLink></div> : null}
      </Section>

      <Section className={panelClass(panel === 'call', true)}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <SectionHeading>{selected ? `Call ${selected.customer?.name ?? selected.followUp.customerName}` : 'New call'}</SectionHeading>
          {selected ? <Button type="button" tone="text" onClick={() => setSelectedId(null)}>Dial another number</Button> : null}
        </div>
        <dl className="mb-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div><dt className="text-muted">Calling from</dt><dd>{options.defaultNumber ? options.defaultNumber.label ?? options.defaultNumber.e164 : options.numbers.length ? 'Choose a number below' : 'No outbound number'}</dd></div>
          <div><dt className="text-muted">Browser telephone</dt><dd>{DEVICE_LABEL[status ?? 'offline']}</dd></div>
        </dl>
        <ActiveCallDock organizationId={organizationId} placement="inline" />
        {options.unavailableReason ? <Hint className="mb-3">{options.unavailableReason}</Hint> : null}
        {selected && !selected.customer?.phone ? <Hint className="mb-3">No customer phone number is recorded. Open the customer to add one, or dial another number.</Hint> : null}
        <NewCallForm
          key={selected?.followUp.id ?? `manual-${prefill}`}
          formId={FORM_ID}
          organizationId={organizationId}
          numbers={options.numbers}
          defaultNumber={options.defaultNumber}
          toNumber={selected?.customer?.phone ?? prefill}
          customerId={selected?.customer?.id}
          customerName={selected?.customer?.name}
        />
      </Section>

      <Section className={panelClass(panel === 'context', contextShown)}>
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
    </div>

    {focus ? null : history}
  </div>;
}
