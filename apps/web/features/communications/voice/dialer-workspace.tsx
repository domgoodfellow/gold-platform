'use client';

import { formatPhoneForDisplay } from '@/lib/display/phone';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowDownLeft, CircleAlert, ExternalLink, Lock, Phone, PanelLeft, PanelRight, Search, Settings2 } from 'lucide-react';
import { Avatar, AvatarFallback } from '@gold/ui/components/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import { tabListStyles, tabTriggerStyles } from '@gold/ui/components/tab-styles';
import { Button, ButtonLink } from '@/components/controls/button';
import { Hint, TextInput } from '@/components/controls/inputs';
import { cx, FOCUS_RING } from '@/components/class-names';
import { IconWell, OperationalPanel, OwnerIdentity, PanelState, StatePill, type StatusTone } from '@/components/operational/primitives';
import { ReadinessBadge } from '@/components/operational/readiness-badge';
import type { CallingBlocker, CallingOptions } from '@/lib/application/communications/calling-options';
import type { DialerQueueEntry } from '@/lib/application/communications/dialer-queue';
import { ActiveCallDock } from './active-call-dock';
import { NewCallForm } from './new-call-form';
import { AddToCallList } from './add-to-call-list';
import { useTelephoneDevice, type DeviceStatus } from './telephone-device';
import { useDialerPopout } from './dialer-popout-context';

type Mode = 'standard' | 'focus';
type Region = 'queue' | 'call' | 'context';
type Draft = { toNumber: string; phoneNumberId: string };

const FORM_ID = 'dialer-call-form';
const DEVICE: Record<DeviceStatus, { label: string; tone: StatusTone }> = {
  offline: { label: 'Not connected', tone: 'neutral' },
  connecting: { label: 'Connecting', tone: 'neutral' },
  ready: { label: 'Connected', tone: 'success' },
  error: { label: 'Connection failed', tone: 'danger' },
};
const BLOCKER_STATE = { restricted: 'restricted', 'not-configured': 'configuration-required', unavailable: 'unavailable' } as const;
const BLOCKER_ICON = { restricted: Lock, 'not-configured': Settings2, unavailable: CircleAlert } as const;
const REGIONS: { key: Region; label: string }[] = [
  { key: 'queue', label: 'Call list' },
  { key: 'call', label: 'Calling' },
  { key: 'context', label: 'Customer' },
];

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\s]/gu, '').trim().split(/\s+/).filter(Boolean);
  return words.length ? words.slice(0, 2).map(word => word[0]).join('').toUpperCase() : '#';
}

/**
 * The Dialer's operating console (`docs/ui-system.md`, A11): the call list, the calling console
 * and the customer context, with the call history and its summary figures last.
 * The composition holds whatever the data: an empty call list, no outbound number or no selection
 * each say what is absent and why in their own region rather than collapsing the layout.
 *
 * **Presentation.** Standard shows every region the operator has not hidden; Focus keeps only the
 * calling console and its workflow; Pop-out moves the live controls into the separate window
 * through the same telephone. Regions are hidden, never unmounted, so a live call's controls keep
 * their state when the presentation changes.
 *
 * **Choosing someone in the call list never dials.** It fills the number and the customer context. A live call
 * keeps its own controls: the console shows the call, not whichever row is highlighted.
 *
 * **The call list search covers only the calls loaded here** (the first page, earliest due
 * first), and says so when that is not the whole list.
 *
 * On screen this is the call list. In the code each row is an open CRM task of kind Call; a
 * follow-up is only one reason a call is on the list, never the list's name.
 *
 * Server-drawn pieces are passed in by the route: `wrapUp`,
 * `recentCalls` per customer and the page `actions`. The route draws call history after the
 * console itself; the console's root publishes `data-presentation` so Focus can hide it.
 */
export function DialerWorkspace({
  organizationId,
  timezone,
  queue,
  queueTotal,
  queueAvailable,
  options,
  prefill = '',
  actions,
  wrapUp,
  recentCalls = {},
  setupHref = null,
  mayAddToList = false,
}: {
  organizationId: string;
  timezone: string;
  queue: DialerQueueEntry[];
  queueTotal: number;
  queueAvailable: boolean;
  options: CallingOptions;
  /** A number to dial, from a link such as Call back. Chosen over the call list only when no one in it is selected. */
  prefill?: string;
  actions?: ReactNode;
  wrapUp?: ReactNode;
  /** Each queued customer's recent calls, drawn on the server, by customer id. */
  recentCalls?: Record<string, ReactNode>;
  /** Where the business fixes a calling blocker it owns, when the viewer may configure it. */
  setupHref?: string | null;
  /** Offers Add to list (pick contacts; each becomes an open Call task) when the viewer may manage tasks. */
  mayAddToList?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(prefill ? null : queue[0]?.task.id ?? null);
  const [mode, setMode] = useState<Mode>('standard');
  const [showQueue, setShowQueue] = useState(true);
  const [showContext, setShowContext] = useState(true);
  const [region, setRegion] = useState<Region>('call');
  const [search, setSearch] = useState('');
  const [dueOnly, setDueOnly] = useState(false);
  const [now] = useState(() => Date.now());
  const [returned, setReturned] = useState<(Draft & { at: number }) | null>(null);
  const draft = useRef<Draft>({ toNumber: '', phoneNumberId: '' });
  const onDraftChange = useCallback((next: Draft) => { draft.current = next; }, []);
  const selected = queue.find(entry => entry.task.id === selectedId);
  const { activeCall, incoming, status, register, unregister, error: deviceError } = useTelephoneDevice();
  const popout = useDialerPopout();
  const setInlineHost = popout?.setInlineHost;

  // While this page is open it draws the live controls itself, so the organization dock steps aside.
  useEffect(() => {
    setInlineHost?.(true);
    return () => setInlineHost?.(false);
  }, [setInlineHost]);

  const poppedOut = !!popout?.container;
  const focus = mode === 'focus' && !poppedOut;
  const queueShown = showQueue && !focus;
  const contextShown = showContext && !focus;
  const live = activeCall !== null || incoming !== null;
  const blocker = options.blocker ?? (options.unavailableReason ? { kind: 'unavailable', reason: options.unavailableReason, setup: null } satisfies CallingBlocker : null);
  const customerName = selected ? selected.customer?.name ?? selected.task.customerName : null;
  const customerPhone = selected?.customer?.phone ?? null;
  const formNumber = returned?.toNumber ?? customerPhone ?? prefill;
  const formCustomer = selected?.customer && formNumber === customerPhone ? selected.customer : undefined;
  const columns = [queueShown && 'minmax(14rem,1fr)', 'minmax(0,2fr)', contextShown && 'minmax(14rem,1fr)'].filter(Boolean).join(' ');

  const dayKey = (value: Date | number) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, dateStyle: 'short' }).format(value);
  const timeOf = new Intl.DateTimeFormat('en', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
  const dayOf = new Intl.DateTimeFormat('en', { timeZone: timezone, month: 'short', day: 'numeric' });
  const fullDate = new Intl.DateTimeFormat('en', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' });
  const isDue = (dueAt: string) => new Date(dueAt).getTime() <= now;
  const dueLabel = (dueAt: string) => {
    const due = new Date(dueAt);
    return dayKey(due) === dayKey(now) ? timeOf.format(due) : dayOf.format(due);
  };

  const needle = search.trim().toLowerCase();
  const dueCount = queue.filter(({ task }) => isDue(task.dueAt)).length;
  const visible = queue.filter(({ task, customer }) => {
    if (dueOnly && !isDue(task.dueAt)) return false;
    if (!needle) return true;
    return [task.customerName, task.title, task.ownerName, customer?.phone].filter(Boolean).join(' ').toLowerCase().includes(needle);
  });
  const otherOpen = selected ? queue.filter(entry => entry.task.customerId === selected.task.customerId && entry.task.id !== selected.task.id) : [];

  const choose = (id: string) => {
    setSelectedId(id);
    setReturned(null);
    setRegion('call');
  };
  const choosePresentation = (next: Mode) => {
    if (poppedOut) popout?.close();
    setMode(next);
  };
  const openPopout = () => {
    if (!popout) return;
    const current = draft.current;
    const forCustomer = selected && current.toNumber === (customerPhone ?? '');
    popout.open({
      numbers: options.numbers,
      defaultNumber: options.defaultNumber,
      toNumber: current.toNumber,
      phoneNumberId: current.phoneNumberId,
      customerId: forCustomer ? selected.customer?.id : undefined,
      customerName: forCustomer ? customerName ?? undefined : undefined,
      onReturn: (back) => setReturned({ ...back, at: Date.now() }),
    });
  };
  const regionClass = (key: Region, shownOnDesktop: boolean) => cx(!focus && region === key ? 'flex' : 'hidden', shownOnDesktop ? '@min-[64rem]/dialer:flex' : '@min-[64rem]/dialer:hidden');

  // --- Calling readiness -------------------------------------------------------------------
  const BlockerIcon = blocker ? BLOCKER_ICON[blocker.kind] : null;
  const fromLabel = options.defaultNumber
    ? options.defaultNumber.label ? `${options.defaultNumber.label} · ${formatPhoneForDisplay(options.defaultNumber.e164)}` : formatPhoneForDisplay(options.defaultNumber.e164)
    : options.numbers.length ? 'Choose a line when you call' : blocker && blocker.setup !== 'phone-numbers' ? 'Not available' : 'No outbound number';
  const readiness = (
    <section aria-label="Calling readiness" className="shrink-0">
      <dl className="grid grid-cols-3 overflow-hidden [&>div]:min-w-0 [&>div]:px-3 [&>div]:py-2 sm:[&>div]:px-4">
        <div>
          <dt className="text-xs text-muted">Calling from</dt>
          <dd className={cx('mt-0.5 truncate text-sm font-medium tabular-nums', !options.defaultNumber && !options.numbers.length && 'text-muted')}>{fromLabel}</dd>
        </div>
        <div className="border-l border-border">
          <dt className="truncate text-xs text-muted">Browser phone</dt>
          <dd className="mt-1 flex flex-wrap items-center gap-2">
            <StatePill tone={DEVICE[status].tone}>{DEVICE[status].label}</StatePill>
            {!blocker ? <Button type="button" tone="text" size="tiny" disabled={status === 'connecting'} onClick={() => { if (status === 'ready') unregister(); else void register().catch(() => undefined); }}>{status === 'ready' ? 'Stop receiving calls' : 'Receive calls here'}</Button> : null}
          </dd>
        </div>
        <div className="border-l border-border">
          <dt className="text-xs text-muted">Calling</dt>
          <dd className="mt-1"><ReadinessBadge state={blocker ? BLOCKER_STATE[blocker.kind] : 'configured'} /></dd>
        </div>
      </dl>
      {blocker && BlockerIcon ? (
        <div role="status" data-state={blocker.kind} className={cx('flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-4 py-2 text-sm', blocker.kind === 'restricted' ? 'text-muted' : blocker.kind === 'unavailable' ? 'bg-danger/5' : 'bg-warning/5')}>
          <BlockerIcon aria-hidden className={cx('size-4 shrink-0', blocker.kind === 'unavailable' ? 'text-danger' : blocker.kind === 'not-configured' ? 'text-warning' : 'text-muted')} />
          <p className="min-w-0 flex-1">{blocker.reason}</p>
          {blocker.setup && setupHref ? <ButtonLink href={setupHref} tone="secondary" size="small">Set up numbers</ButtonLink> : null}
        </div>
      ) : null}
      {deviceError ? <p role="alert" className="border-t border-border px-4 py-2 text-sm text-danger">{deviceError}</p> : null}
    </section>
  );

  // --- Calling surface -----------------------------------------------------------------------
  const identity = selected ? (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar className="size-10 shrink-0"><AvatarFallback className="bg-secondary text-sm font-semibold text-muted">{initials(customerName ?? '')}</AvatarFallback></Avatar>
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold tracking-tight">{customerName}</h2>
          <p className="truncate text-sm text-muted">{selected.task.title}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {isDue(selected.task.dueAt) ? <StatePill tone="warning">Due now</StatePill> : <span className="text-muted">Due {dueLabel(selected.task.dueAt)}</span>}
          </p>
        </div>
      </div>
      <Button type="button" tone="secondary" size="small" aria-label="Dial another number" onClick={() => { setSelectedId(null); setReturned(null); }}>New number</Button>
    </div>
  ) : (
    <h2 className="text-base font-semibold tracking-tight">New call</h2>
  );

  const callSurface = poppedOut ? (
    <section aria-label="Calling console" className="flex min-h-72 flex-col items-center justify-center gap-3 border-t border-border p-5 text-center">
      <IconWell icon={ExternalLink} round />
      <p className="text-base font-semibold">{live ? 'This call is in the separate dialer window.' : 'The dialer is open in a separate window.'}</p>
      <p className="max-w-sm text-sm text-muted">Keep this window open while calling. Choose Standard or Focus to bring the dialer back here.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button type="button" tone="secondary" onClick={() => popout?.close()}><ArrowDownLeft aria-hidden /> Return to GildOps</Button>
      </div>
    </section>
  ) : live ? (
    <section aria-label="Calling console" className="border-t border-border [&>div]:rounded-none [&>div]:border-0 [&>div]:p-5">
      <ActiveCallDock organizationId={organizationId} placement="inline" />
    </section>
  ) : (
    <section aria-label="Calling console" className="flex flex-col gap-4 border-t border-border p-4 @sm/dialer:p-5">
      {identity}
      {selected && !customerPhone ? <Hint>No customer phone number is recorded. Open the customer to add one, or dial another number.</Hint> : null}
      <NewCallForm
        key={returned ? `returned-${returned.at}` : selected?.task.id ?? `manual-${prefill}`}
        formId={FORM_ID}
        presentation="console"
        onDraftChange={onDraftChange}
        organizationId={organizationId}
        numbers={options.numbers}
        defaultNumber={options.defaultNumber}
        toNumber={formNumber}
        phoneNumberId={returned?.phoneNumberId}
        customerId={formCustomer?.id}
        customerName={formCustomer?.name}
      />
    </section>
  );

  const workflow = (
    <section aria-label="Call workflow" className="shrink-0 border-t border-border">
      <Tabs defaultValue="details">
        <TabsList variant="line" aria-label="Call workflow" className="w-full px-3">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="wrap-up">Wrap-up</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="p-4">
          {selected ? (
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
              <dt className="text-muted">Reason</dt>
              <dd className="font-medium">{selected.task.title}</dd>
              <dt className="text-muted">Due</dt>
              <dd className="tabular-nums">{fullDate.format(new Date(selected.task.dueAt))}</dd>
              <dt className="text-muted">Owner</dt>
              <dd><OwnerIdentity name={selected.task.ownerName} /></dd>
              <dt className="text-muted">Notes</dt>
              <dd className={cx('whitespace-pre-wrap', !selected.task.notes && 'text-muted')}>{selected.task.notes ?? 'No notes recorded.'}</dd>
              {selected.task.opportunityId ? <>
                <dt className="text-muted">Opportunity</dt>
                <dd><Link className="underline underline-offset-4" href={`/organizations/${organizationId}/crm/opportunities/${selected.task.opportunityId}`}>{selected.task.opportunityTitle ?? 'Open opportunity'}</Link></dd>
              </> : null}
            </dl>
          ) : <p className="text-sm text-muted">Choose someone in the call list to see their details.</p>}
        </TabsContent>
        <TabsContent value="wrap-up" className="p-4">
          {wrapUp ?? <PanelState kind="restricted">Your role cannot wrap up calls.</PanelState>}
        </TabsContent>
      </Tabs>
    </section>
  );

  // --- Queue -----------------------------------------------------------------------------------
  const partial = queueTotal > queue.length;
  const addToList = mayAddToList && queueAvailable ? <AddToCallList organizationId={organizationId} /> : null;
  const queuePanel = (
    <OperationalPanel
      title="Call list"
      count={queueAvailable ? queueTotal : undefined}
      density="compact"
      body="edge-to-edge"
      fill={queueAvailable && queue.length > 0}
      href={queueAvailable ? `/organizations/${organizationId}/crm/tasks?status=open&kind=call` : undefined}
      hrefLabel="Show all"
      action={queue.length > 0 ? addToList : undefined}
      className="min-h-0 flex-1"
    >
      {!queueAvailable ? <PanelState kind="not-configured">Tasks are not included for this business, so there is no call list.</PanelState> : queue.length === 0 ? (
        <div className="space-y-3 p-3">
          <p className="text-sm text-muted">No one to call.</p>
          {addToList}
        </div>
      ) : <>
        <div className="shrink-0 space-y-2 border-b border-border p-3">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <TextInput type="search" aria-label="Search call list" placeholder="Search name or number" value={search} onChange={event => setSearch(event.target.value)} className="pl-8" />
          </div>
          <div role="group" aria-label="Call list filter" data-slot="tabs-list" data-variant="segmented" className={cx(tabListStyles(), 'w-full')}>
            <button type="button" data-slot="tabs-trigger" aria-pressed={!dueOnly} className={cx(tabTriggerStyles, 'flex-1')} onClick={() => setDueOnly(false)}>All <span className="text-xs tabular-nums text-muted">{queue.length}</span></button>
            <button type="button" data-slot="tabs-trigger" aria-pressed={dueOnly} className={cx(tabTriggerStyles, 'flex-1')} onClick={() => setDueOnly(true)}>Due now <span className="text-xs tabular-nums text-muted">{dueCount}</span></button>
          </div>
          {partial ? <Hint>Searches the {queue.length} calls shown here, not the whole list.</Hint> : null}
        </div>
        {visible.length === 0 ? <PanelState>No calls match.</PanelState> : (
          <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto" aria-label="Calls">
            {visible.map(({ task, customer }) => {
              const name = customer?.name ?? task.customerName;
              const chosen = selectedId === task.id;
              return <li key={task.id}>
                <button type="button" aria-pressed={chosen} onClick={() => choose(task.id)} className={cx('flex w-full items-start gap-3 border-l-2 px-3 py-2.5 text-left transition-colors', chosen ? 'border-accent bg-selected' : 'border-transparent hover:bg-hover', FOCUS_RING)}>
                  <Avatar className="mt-0.5 size-9 shrink-0"><AvatarFallback className="bg-secondary text-xs font-semibold text-muted">{initials(name)}</AvatarFallback></Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{name}</span>
                      {isDue(task.dueAt) ? <span className="shrink-0 text-xs font-medium text-warning">Due now</span> : <span className="shrink-0 text-xs tabular-nums text-muted">{dueLabel(task.dueAt)}</span>}
                    </span>
                    <span className="block truncate text-xs text-muted">{task.title}</span>
                    <span className="block truncate text-xs tabular-nums text-muted">{customer?.phone ? formatPhoneForDisplay(customer.phone) : 'No phone number'}{task.ownerName ? ` · ${task.ownerName}` : ''}</span>
                  </span>
                </button>
              </li>;
            })}
          </ul>
        )}
        {partial ? <p className="shrink-0 border-t border-border px-3 py-2 text-xs text-muted">Showing the first {queue.length} of {queueTotal} calls, earliest due first.</p> : null}
        <div className="shrink-0 border-t border-border p-3">
          <Button type="submit" form={FORM_ID} className="w-full" disabled={live || poppedOut || !customerPhone || !!blocker}><Phone aria-hidden /> Start calling</Button>
        </div>
      </>}
    </OperationalPanel>
  );

  // --- Customer context ----------------------------------------------------------------------------
  const contextPanel = (
    <OperationalPanel title="Customer" density="compact" fill={!!selected} className="min-h-0 flex-1">
      {!selected ? (
        <p className="text-sm text-muted">{queue.length ? 'Choose someone in the call list to see their details and recent calls.' : 'Customer details appear here when you call someone from the call list.'}</p>
      ) : !selected.customer ? <PanelState kind="unavailable">Customer details are unavailable.</PanelState> : (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <Avatar className="size-10 shrink-0"><AvatarFallback className="bg-secondary text-sm font-semibold text-muted">{initials(selected.customer.name)}</AvatarFallback></Avatar>
            <div className="min-w-0">
              <Link className="block truncate font-semibold underline-offset-4 hover:underline" href={`/organizations/${organizationId}/crm/contacts/${selected.customer.id}`}>{selected.customer.name}</Link>
              <p className="truncate text-xs text-muted">{selected.task.title}</p>
            </div>
          </div>
          <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted">Phone</dt>
            <dd className={cx('truncate tabular-nums', !selected.customer.phone && 'text-muted')}>{selected.customer.phone ? formatPhoneForDisplay(selected.customer.phone) : 'Not recorded'}</dd>
            <dt className="text-muted">Email</dt>
            <dd className={cx('truncate', !selected.customer.email && 'text-muted')}>{selected.customer.email ?? 'Not recorded'}</dd>
          </dl>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Other calls for this customer</h3>
            {otherOpen.length ? <ul className="space-y-1">{otherOpen.map(entry => <li key={entry.task.id}>
              <button type="button" onClick={() => choose(entry.task.id)} className={cx('-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover', FOCUS_RING)}>
                <span className="truncate">{entry.task.title}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted">{dueLabel(entry.task.dueAt)}</span>
              </button>
            </li>)}</ul> : <p className="text-sm text-muted">No other calls in the list.</p>}
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Recent calls</h3>
            {recentCalls[selected.customer.id] ?? <p className="text-sm text-muted">No recorded calls with this customer yet.</p>}
          </div>
          <ButtonLink href={`/organizations/${organizationId}/crm/contacts/${selected.customer.id}`} tone="secondary" size="small" className="w-full">Open customer</ButtonLink>
        </div>
      )}
    </OperationalPanel>
  );

  return <div data-presentation={focus ? 'focus' : poppedOut ? 'pop-out' : 'standard'} className="peer @container/dialer flex flex-col gap-3">
    <div role="group" aria-label="Dialer toolbar" className="flex flex-wrap items-center gap-2" onClickCapture={event => {
      if ((event.target as Element).closest('a[href="#call-history"]')) choosePresentation('standard');
    }}>
      <div role="group" aria-label="Presentation" data-slot="tabs-list" data-variant="segmented" className={tabListStyles()}>
        <button type="button" data-slot="tabs-trigger" aria-pressed={mode === 'standard'} className={tabTriggerStyles} onClick={() => choosePresentation('standard')}>Standard</button>
        <button type="button" data-slot="tabs-trigger" aria-pressed={mode === 'focus'} className={tabTriggerStyles} onClick={() => choosePresentation('focus')}>Focus</button>
      </div>
      <div role="group" aria-label="Panel visibility" className="hidden items-center gap-2 @min-[64rem]/dialer:flex">
        <Button type="button" tone="secondary" size="small" aria-label="Call list panel" aria-pressed={queueShown} disabled={focus} onClick={() => setShowQueue(value => !value)}><PanelLeft aria-hidden /> Call list</Button>
        <Button type="button" tone="secondary" size="small" aria-label="Context panel" aria-pressed={contextShown} disabled={focus} onClick={() => setShowContext(value => !value)}><PanelRight aria-hidden /> Customer context</Button>
      </div>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {popout ? <Button type="button" tone="secondary" aria-label={poppedOut ? 'Show dialer window' : 'Pop out dialer'} data-dialer-popout-trigger onClick={openPopout}><ExternalLink aria-hidden /> {poppedOut ? 'Show dialer window' : 'Pop out'}</Button> : null}
        {actions}
      </div>
    </div>
    {popout?.error ? <p role="alert" className="text-sm text-danger">{popout.error}</p> : null}

    {/* Below desktop width one region is shown at a time; a live call is never out of reach. */}
    {!focus ? <div role="group" aria-label="Dialer region" data-slot="tabs-list" data-variant="segmented" className={cx(tabListStyles(), 'w-full @min-[64rem]/dialer:hidden')}>
      {REGIONS.map(({ key, label }) => <button key={key} type="button" data-slot="tabs-trigger" aria-pressed={region === key} className={cx(tabTriggerStyles, 'flex-1')} onClick={() => setRegion(key)}>{label}</button>)}
    </div> : null}
    {live && !focus && region !== 'call' ? <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-sm @min-[64rem]/dialer:hidden">
      <span>{incoming ? 'Incoming call' : `On a call with ${formatPhoneForDisplay(activeCall?.contactLabel ?? 'a caller')}`}</span>
      <Button type="button" tone="secondary" size="small" onClick={() => setRegion('call')}>Show call controls</Button>
    </div> : null}

    <div
      className="grid min-w-0 gap-3 @min-[64rem]/dialer:max-h-[calc(100dvh-10rem)] @min-[64rem]/dialer:grid-cols-(--dialer-columns)"
      style={{ '--dialer-columns': columns } as CSSProperties}
    >
      <div className={cx(regionClass('queue', queueShown), 'min-h-0 min-w-0 flex-col', !queue.length && 'self-start')}>{queuePanel}</div>
      <div className={cx(focus ? 'flex' : region === 'call' ? 'flex' : 'hidden', 'min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface @min-[64rem]/dialer:flex @min-[64rem]/dialer:overflow-y-auto', focus && 'mx-auto w-full max-w-4xl')}>
        {readiness}
        {callSurface}
        {workflow}
      </div>
      <div className={cx(regionClass('context', contextShown), 'min-h-0 min-w-0 flex-col', !selected && 'self-start')}>{contextPanel}</div>
    </div>
  </div>;
}
