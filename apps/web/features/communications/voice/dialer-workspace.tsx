'use client';

import { formatPhoneForDisplay } from '@/lib/display/phone';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type CSSProperties, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ArrowDownLeft, CircleAlert, ExternalLink, Lock, MoreHorizontal, PanelLeft, PanelRight, Settings2 } from 'lucide-react';
import { Avatar, AvatarFallback } from '@gold/ui/components/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@gold/ui/components/dropdown-menu';
import { tabListStyles, tabTriggerStyles } from '@gold/ui/components/tab-styles';
import { surfaceVariants } from '@gold/ui/design-system';
import { Button, ButtonLink } from '@/components/controls/button';
import { cx } from '@/components/class-names';
import { CompactEmptyState, OperationalPanel, OwnerIdentity, StatePill } from '@/components/operational/primitives';
import type { CallingBlocker, CallingOptions } from '@/lib/application/communications/calling-options';
import type { DialerQueueEntry } from '@/lib/application/communications/dialer-queue';
import type { CallOutcome } from '@/lib/domain/reception/outcomes';
import { ActiveCallDock } from './active-call-dock';
import { BrowserPhone } from './browser-phone';
import { NewCallForm } from './new-call-form';
import { AddToCallList } from './add-to-call-list';
import { ScheduleCallback } from './call-list-entry-actions';
import { CallListPanel, contactBusiness as business, contactInitials as initials } from './call-list-panel';
import { useCallingSession, type CallingSession } from './calling-session';
import { useCallList } from './use-call-list';
import { WrapUpCallSheet } from './wrap-up-sheet';
import { useTelephoneDevice } from './telephone-device';
import { useDialerPopout } from './dialer-popout-context';
import { RecentCallRows } from './recent-call-rows';
import { callContactContext, endedCallRecord, matchDialerContact, type CallContactContext, type EndedCallRecord } from '@/app/organizations/[organizationId]/calls/actions';
import { callListEntryAction, completeCallTaskAction, nextCallListEntryAction } from '@/app/organizations/[organizationId]/calls/call-list-actions';
import type { CallContact } from '@/lib/domain/reception/calls';
import type { CallListCounts } from '@/lib/domain/tasks/call-list-views';
import type { RecentCallRow } from './format';

type Mode = 'standard' | 'focus';
type Region = 'queue' | 'call' | 'context';
type Draft = { toNumber: string; phoneNumberId: string };
/**
 * What the calling workspace is showing. Exactly one at a time, decided from the one telephone
 * session and the draft, in this order: a call always outranks whatever is being prepared.
 */
export type CallingState = 'popped-out' | 'incoming' | 'live' | 'ended' | 'contact' | 'complete' | 'manual' | 'idle';

const FORM_ID = 'dialer-call-form';
const BLOCKER_ICON = { restricted: Lock, 'not-configured': Settings2, unavailable: CircleAlert } as const;
const REGIONS: { key: Region; label: string }[] = [
  { key: 'queue', label: 'Call list' },
  { key: 'call', label: 'Calling' },
  { key: 'context', label: 'Contact' },
];
/** Statuses a call record holds while the carrier has not yet reported how it finished. */
const UNSETTLED = new Set(['queued', 'initiated', 'ringing', 'in_progress']);
/**
 * How long to wait before each further read of a call that has ended here but is not yet recorded
 * as finished: quickly at first, because the carrier usually reports within seconds, then slowly,
 * then not at all. About five minutes in total; after that the operator asks, or returns to the tab.
 */
const SETTLE_WAITS_MS = [...Array<number>(6).fill(2_500), ...Array<number>(6).fill(10_000), ...Array<number>(8).fill(30_000)];
/** What a finished call that was never answered is called, by its recorded status. */
const UNANSWERED_LABEL: Record<string, string> = { no_answer: 'No answer', busy: 'Busy', failed: 'Failed' };

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Publishes, as `--dialer-available`, the height the page's own scroller leaves beneath the
 * console. The regions are capped to it, so they scroll inside themselves instead of pushing the
 * page; whatever sits above the console (page header, toolbar, a banner) is measured, not assumed.
 */
function useAvailableHeight() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    let scroller: HTMLElement | null = element.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const measure = () => {
      const bottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
      const top = element.getBoundingClientRect().top + (scroller ? scroller.scrollTop : window.scrollY);
      // 1.5rem keeps the console clear of the page's end, as the page padding does at its sides.
      element.style.setProperty('--dialer-available', `${Math.max(352, Math.round(bottom - top - 24))}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller ?? document.documentElement);
    if (element.parentElement) observer.observe(element.parentElement);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  return ref;
}

/**
 * The Dialer's operating console (`docs/ui-system.md`, A11): the call list, the calling workspace
 * and the contact context, with the call history and its summary figures after it.
 *
 * **The calling workspace is state-driven** (`CallingState`). With nobody chosen it is manual
 * dialing; with someone chosen from the call list it is that contact, their number and one Call;
 * during a call it is the call; after one it offers what follows a call. One region changes; the
 * console around it does not, so later capabilities that belong to a call have a place to live.
 *
 * **One telephone.** Every presentation here (Standard, Focus, the pop-out window and the dock on
 * other pages) draws the session the organization layout holds. Nothing on this page owns a call,
 * so no change of presentation can end one.
 *
 * **Choosing someone in the call list never dials.** It fills the number and the contact context.
 *
 * **A call keeps its own identity.** While a call is live or has just ended, the workspace and the
 * contact context show who that call is with, read from the call's own record as the viewer, never
 * whichever list entry is highlighted and never matched by phone number. It does not matter whether
 * that contact is on the page of the call list loaded here.
 *
 * **After a call the operator is never left waiting on the carrier.** Wrap-up is offered once the
 * call is recorded as completed. Until then the workspace says it is waiting, keeps checking at a
 * slowing pace for a few minutes, checks again when the operator returns to the tab or asks, and
 * always lets them move on; a call recorded later appears under Needs wrap-up.
 *
 * **Attribution follows the number.** A call is tied to a contact only while the number is the one
 * that contact was resolved from; dialing another number clears it.
 *
 * **The call list is the server's.** Its view, search, counts and pages are read from the server
 * (`useCallList`); nothing is filtered here. The selected entry is read again whenever the list
 * is, so an entry someone else completed, removed or cancelled is cleared rather than called.
 *
 * **A calling session is a way through the list, not a second telephone session**
 * (`calling-session.ts`). Preview: the operator chooses each contact. Auto-advance: once a call's
 * outcome is resolved, the next eligible contact in the current view is chosen for them. Neither
 * ever dials: Call is always pressed. Nothing advances while a call is live. Skipping sets an
 * entry aside for the session and changes no task; hanging up completes no task.
 *
 * **Typing a number is its own permission** (`options.manualDialing`). Without it the workspace
 * offers no number field; the database refuses such a call whatever a screen offers.
 *
 * On screen this is the call list. In the code each row is an open CRM task of kind Call; a
 * follow-up is only one reason a call is on the list, never the list's name.
 *
 * Server-drawn pieces are passed in by the route: `wrapUp`, `recentCalls` per contact and the page
 * `actions`. The route draws call history after the console itself; the console's root publishes
 * `data-presentation` so Focus can hide it.
 */
export function DialerWorkspace({
  organizationId,
  timezone,
  queue,
  queueTotal,
  queueCounts,
  queueAvailable,
  options,
  prefill = '',
  actions,
  settings = [],
  wrapUp,
  outcomes,
  setup = null,
  mayAddToList = false,
  mayCreateContacts = false,
  mayRemoveFromList = false,
  mayManageTasks = false,
  mayMatchContacts = false,
  mayViewContacts = true,
}: {
  organizationId: string;
  timezone: string;
  /** The first page of the call list's default view (all calls, earliest due first), as the route read it. */
  queue: DialerQueueEntry[];
  queueTotal: number;
  /** How many calls each view holds, read with that page. */
  queueCounts: CallListCounts;
  queueAvailable: boolean;
  options: CallingOptions;
  /** A number to dial, from a link such as Call back. Chosen over the call list only when no one in it is selected. */
  prefill?: string;
  /** Page actions that stay in view, such as Call history. */
  actions?: ReactNode;
  /** Configuration destinations the viewer may open; they sit in the toolbar's overflow menu. */
  settings?: { key: string; label: string; href: string }[];
  wrapUp?: ReactNode;
  /** The business's call outcomes, passed only when the viewer may wrap up calls. */
  outcomes?: CallOutcome[];
  /** Where a calling blocker is fixed or its state can be seen, when the viewer may open it. */
  setup?: { href: string; label: string } | null;
  /** Offers Add to list (pick contacts; each becomes an open Call task) when the viewer may manage tasks. */
  mayAddToList?: boolean;
  /** Offers Create contact inside Add to list, for a member who may add contacts. */
  mayCreateContacts?: boolean;
  /** Offers Remove from list on each call list entry, for a member who holds `call_list.remove`. */
  mayRemoveFromList?: boolean;
  /** Offers Reschedule, Reassign, Schedule callback and Complete call task, for a member who may manage tasks. */
  mayManageTasks?: boolean;
  mayMatchContacts?: boolean;
  /** Links into Contacts, for a member who holds `customer.read`; without it the list still shows each entry's name and number. */
  mayViewContacts?: boolean;
}) {
  const router = useRouter();
  // Read through a ref so the after-call read below runs once per call, whatever the router's identity does.
  const refreshPage = useRef(() => {});
  useEffect(() => { refreshPage.current = () => router.refresh(); });
  const first = prefill ? undefined : queue[0];
  const [chosen, setChosen] = useState<DialerQueueEntry | null>(first ?? null);
  const [session, updateSession] = useCallingSession(organizationId);
  const manualDialing = options.manualDialing ?? false;
  // A session that asks for Manual is Preview for a member who may not type a number.
  const callingMode = session.mode === 'manual' && !manualDialing ? 'preview' : session.mode;
  const [sessionOver, setSessionOver] = useState(false);
  const [gone, setGone] = useState<string | null>(null);
  const [entryInfo, setEntryInfo] = useState<{ taskId: string; recentCalls: RecentCallRow[] } | null>(null);
  const [advancing, startAdvance] = useTransition();
  const [mode, setMode] = useState<Mode>('standard');
  const [showQueue, setShowQueue] = useState(true);
  const [showContext, setShowContext] = useState(true);
  const [region, setRegion] = useState<Region>('call');
  const [returned, setReturned] = useState<(Draft & { at: number }) | null>(null);
  const [numberDraft, setNumberDraft] = useState(first ? first.customer.phone ?? '' : prefill);
  const [lookup, setLookup] = useState<{ number: string; result: Awaited<ReturnType<typeof matchDialerContact>> } | null>(null);
  const [dialed, setDialed] = useState<CallContact | null>(null);
  const [record, setRecord] = useState<EndedCallRecord | null>(null);
  const [settling, setSettling] = useState<{ callId: string; state: 'checking' | 'paused' } | null>(null);
  const [recheck, setRecheck] = useState(0);
  const [callInfo, setCallInfo] = useState<CallContactContext | null>(null);
  const draft = useRef<Draft>({ toNumber: '', phoneNumberId: '' });
  const onDraftChange = useCallback((next: Draft) => { draft.current = next; setNumberDraft(next.toNumber); }, []);
  const { activeCall, incoming, ended = null, dismissEnded } = useTelephoneDevice();

  // --- The call list ---------------------------------------------------------------------------
  const initialList = useMemo(() => ({ items: queue, counts: queueCounts, total: queueTotal }), [queue, queueCounts, queueTotal]);
  // What a read of the list found for the selected entry: the entry as it now stands, or that it has gone.
  const onSelectedRead = useCallback((entry: DialerQueueEntry | null) => {
    setChosen(current => {
      if (!current) return current;
      if (entry) return entry.task.id === current.task.id ? entry : current;
      setGone(current.customer.name);
      return null;
    });
  }, []);
  const list = useCallList({
    organizationId, initial: initialList, enabled: queueAvailable,
    query: { view: session.view, search: session.search, skipped: session.skipped },
    selectedId: chosen?.task.id ?? null, onSelected: onSelectedRead,
  });
  const reloadList = list.reload;
  const popout = useDialerPopout();
  const setInlineHost = popout?.setInlineHost;
  const grid = useAvailableHeight();

  // While this page is open it draws the live controls itself, so the organization dock steps aside.
  useEffect(() => {
    setInlineHost?.(true);
    return () => setInlineHost?.(false);
  }, [setInlineHost]);

  const poppedOut = !!popout?.container;
  const focus = mode === 'focus' && !poppedOut;
  const queueShown = showQueue && !focus;
  const live = activeCall !== null || incoming !== null;
  const blocker = options.blocker ?? (options.unavailableReason ? { kind: 'unavailable', code: 'service-unavailable', reason: options.unavailableReason, setup: null } satisfies CallingBlocker : null);

  // --- What is being prepared --------------------------------------------------------------
  // In Manual nobody is selected, by definition. Otherwise the entry as the list last read it.
  const selected = callingMode === 'manual' ? undefined : chosen ? list.items.find(entry => entry.task.id === chosen.task.id) ?? chosen : undefined;
  const selectedId = selected?.task.id ?? null;
  const customerPhone = selected?.customer.phone ?? null;
  const formNumber = returned?.toNumber ?? (selected ? customerPhone ?? '' : prefill);
  // The list entry stays the subject only while the number is still theirs: the one the list now
  // reads for them, or the one held from when they were chosen, until the form takes the new one.
  const selectedTask = selected && (numberDraft === (customerPhone ?? '') || numberDraft === (chosen?.customer.phone ?? '')) ? selected : null;
  const formCustomer = selected?.customer && customerPhone && formNumber === customerPhone ? selected.customer : undefined;
  const currentLookup = !selectedTask && lookup?.number === numberDraft ? lookup.result : null;
  const draftContact: CallContact | null = selectedTask ? selectedTask.customer : currentLookup?.state === 'matched' ? currentLookup.contact : null;
  useEffect(() => {
    if (!mayMatchContacts || selectedTask || numberDraft.replace(/\D/g, '').length < 8) return undefined;
    let active = true;
    const timer = setTimeout(() => { void matchDialerContact(organizationId, numberDraft).then(result => {
      if (active) setLookup({ number: numberDraft, result });
    }).catch(() => { if (active) setLookup({ number: numberDraft, result: { state: 'unavailable' } }); }); }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [organizationId, numberDraft, mayMatchContacts, selectedTask]);

  // --- Who a call is with, from the call itself ----------------------------------------------
  // The call's own record is the authority. What this page already holds for the same contact (a
  // list entry, the contact just dialed) only fills the moment before that read returns.
  const contactById = (id: string | null | undefined): CallContact | null => (id ? [...list.items.map(entry => entry.customer), selected?.customer, dialed].find(contact => contact?.id === id) ?? null : null);
  const mayType = manualDialing || !!returned;
  const state: CallingState = poppedOut ? 'popped-out' : incoming ? 'incoming' : activeCall ? 'live' : ended ? 'ended' : selectedTask ? 'contact'
    : sessionOver && callingMode === 'auto' ? 'complete' : mayType || prefill ? 'manual' : 'idle';
  const callId = activeCall ? activeCall.callId : ended?.callId ?? null;
  const afterCall = live || state === 'ended';
  useEffect(() => {
    if (!callId) return undefined;
    let active = true;
    void callContactContext(organizationId, callId).then(next => { if (active && next) setCallInfo(next); }).catch(() => undefined);
    return () => { active = false; };
  }, [organizationId, callId]);
  const callContext = callInfo && callInfo.callId === callId ? callInfo : null;
  const callCustomerId = callContext ? callContext.contact?.id ?? null : activeCall ? activeCall.customerId : ended?.customerId;
  const callContactNow = callContext ? callContext.contact : contactById(callCustomerId);
  // The call's own open Call task, as the server found it by the contact; until that read returns, the selected entry when it is theirs.
  const taskFor = (id: string | null | undefined) => (callContext?.task !== undefined ? callContext.task : id && selected?.customer.id === id ? selected : null);
  const contextCustomer = afterCall ? (incoming ? null : callContactNow) : draftContact;
  const task = afterCall ? (incoming ? null : taskFor(callCustomerId)) : selectedTask;

  // The selected entry is read again when it is chosen: its recent calls, and whether it is still on the list.
  useEffect(() => {
    if (!selectedId || !queueAvailable) return undefined;
    let active = true;
    void callListEntryAction(organizationId, selectedId).then(result => {
      if (!active || !result || result.error) return;
      if (!result.entry) { onSelectedRead(null); void reloadList(); return; }
      setEntryInfo({ taskId: selectedId, recentCalls: result.recentCalls });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [organizationId, selectedId, queueAvailable, onSelectedRead, reloadList]);
  const contextShown = showContext && !focus && !!contextCustomer;

  // After a call: bring the page's own figures up to date, and learn how the call was recorded.
  const endedCallId = ended?.callId ?? null;
  useEffect(() => {
    if (!endedCallId) return undefined;
    let active = true;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let paused = false;
    const read = async () => {
      clearTimeout(timer);
      paused = false;
      setSettling({ callId: endedCallId, state: 'checking' });
      const next = await endedCallRecord(organizationId, endedCallId).catch(() => null);
      if (!active) return;
      setRecord(next);
      // The carrier reports the finish a moment after the telephone hangs up, and sometimes much later.
      if (next && !UNSETTLED.has(next.status)) {
        settled = true;
        setSettling(null);
        refreshPage.current();
        return;
      }
      const wait = SETTLE_WAITS_MS[attempts];
      attempts += 1;
      if (wait === undefined) {
        paused = true;
        setSettling({ callId: endedCallId, state: 'paused' });
      } else timer = setTimeout(() => void read(), wait);
    };
    // Coming back to the tab is a reason to look once more, without resuming the timed checks.
    const onReturn = () => { if (!settled && paused && document.visibilityState === 'visible') void read(); };
    refreshPage.current();
    void read();
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
    };
  }, [organizationId, endedCallId, recheck]);
  const endedRecord = record && record.id === endedCallId ? record : null;
  const endedPending = !!endedCallId && settling?.callId === endedCallId && (!endedRecord || UNSETTLED.has(endedRecord.status)) ? settling.state : null;

  const columns = [queueShown && 'minmax(15rem,1fr)', 'minmax(0,2.4fr)', contextShown && 'minmax(15rem,1fr)'].filter(Boolean).join(' ');

  const fullDate = new Intl.DateTimeFormat('en', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' });

  // --- Choosing, skipping and moving on ----------------------------------------------------------
  const prepare = (entry: DialerQueueEntry | null) => {
    setChosen(entry);
    setReturned(null);
    setGone(null);
    setNumberDraft(entry ? entry.customer.phone ?? '' : prefill);
  };
  const choose = (entry: DialerQueueEntry) => {
    prepare(entry);
    setSessionOver(false);
    if (callingMode === 'manual') updateSession({ mode: 'preview' });
    setRegion('call');
    if (!live) dismissEnded?.();
  };
  const dialAnother = () => {
    prepare(null);
    updateSession({ mode: 'manual' });
  };
  /**
   * Moves to the next eligible contact in the current view, read from the server at this moment.
   * Never while a call is live, and it only prepares the call: the operator still presses Call.
   */
  const advance = (also: { skipped?: string } = {}) => {
    if (live || !queueAvailable) return;
    const skipped = [...session.skipped, ...(also.skipped ? [also.skipped] : [])];
    startAdvance(async () => {
      const result = await nextCallListEntryAction(organizationId, { view: session.view, search: session.search, skipped }, session.called).catch(() => null);
      if (!result || result.error) { toast.error(result?.error ?? 'The next call could not be loaded.'); return; }
      dismissEnded?.();
      prepare(result.entry);
      setSessionOver(!result.entry);
      setRegion('call');
    });
  };
  const changeSession = (change: Partial<CallingSession>) => {
    updateSession(change);
    setSessionOver(false);
    if (change.mode === 'manual') prepare(null);
  };
  const skip = (entry: DialerQueueEntry) => {
    updateSession(current => ({ skipped: [...current.skipped, entry.task.id] }));
    if (selectedId !== entry.task.id) return;
    // The entry being prepared was set aside: in Auto-advance the next one takes its place.
    if (callingMode === 'auto' && !live) advance({ skipped: entry.task.id });
    else prepare(null);
  };
  const listChanged = () => { refreshPage.current(); void reloadList(); };
  /** A call's outcome is resolved: in Auto-advance, move on; otherwise the operator chooses. */
  const outcomeResolved = () => {
    void reloadList();
    if (callingMode === 'auto') advance();
  };
  const choosePresentation = (next: Mode) => {
    if (poppedOut) popout?.close();
    setMode(next);
  };
  const openPopout = () => {
    if (!popout) return;
    const current = draft.current;
    const forCustomer = draftContact && current.toNumber === numberDraft;
    popout.open({
      numbers: options.numbers,
      defaultNumber: options.defaultNumber,
      toNumber: current.toNumber,
      phoneNumberId: current.phoneNumberId,
      customerId: forCustomer ? draftContact.id : undefined,
      customerName: forCustomer ? draftContact.name : undefined,
      manualDialing,
      blocker: blocker ? { kind: blocker.kind, reason: blocker.reason, setup: blocker.setup ? setup : null } : null,
      onReturn: (back) => { setReturned({ ...back, at: Date.now() }); setNumberDraft(back.toNumber); },
    });
  };
  const regionClass = (key: Region, shownOnDesktop: boolean) => cx(!focus && region === key ? 'flex' : 'hidden', shownOnDesktop ? '@min-[64rem]/dialer:flex' : '@min-[64rem]/dialer:hidden');

  // --- Calling readiness -------------------------------------------------------------------
  const BlockerIcon = blocker ? BLOCKER_ICON[blocker.kind] : null;
  const readiness = (
    <section aria-label="Calling readiness" className="shrink-0 border-b border-border px-4 py-3 @sm/calling:px-5">
      {blocker && BlockerIcon ? (
        <div role="status" data-state={blocker.kind} className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <BlockerIcon aria-hidden className="size-4 shrink-0 text-muted" />
          <p id="dialer-readiness" className="min-w-0 flex-1">{blocker.reason}</p>
          {blocker.setup && setup ? <ButtonLink href={setup.href} tone="secondary" size="small">{setup.label}</ButtonLink> : null}
        </div>
      ) : <BrowserPhone />}
    </section>
  );

  // --- Calling workspace ---------------------------------------------------------------------
  const pad = 'p-4 @sm/calling:p-5';
  const callForm = (
    <NewCallForm
      key={returned ? `returned-${returned.at}` : selected ? `${selected.task.id}:${customerPhone ?? ''}` : `manual-${prefill}`}
      formId={FORM_ID}
      destination={selectedTask || !mayType ? 'contact' : 'entry'}
      onChangeNumber={manualDialing && selectedTask ? dialAnother : undefined}
      onDraftChange={onDraftChange}
      onDial={(contact) => {
        setDialed(contact && draftContact?.id === contact.id ? draftContact : null);
        // Called this session: still listed, and not offered again by Auto-advance.
        if (selectedTask) updateSession(current => ({ called: [...current.called.filter(id => id !== selectedTask.task.id), selectedTask.task.id] }));
      }}
      onRefused={() => refreshPage.current()}
      organizationId={organizationId}
      numbers={options.numbers}
      defaultNumber={options.defaultNumber}
      toNumber={formNumber}
      phoneNumberId={returned?.phoneNumberId}
      customerId={formCustomer?.id}
      customerName={formCustomer?.name}
      resolvedContact={draftContact ? { ...draftContact, number: numberDraft } : undefined}
      blockedReason={blocker?.reason}
      blockedDescriptionId={blocker ? 'dialer-readiness' : undefined}
      numberStatus={
        currentLookup?.state === 'ambiguous' ? <p role="status" className="text-sm text-muted">Several contacts use this number. No contact is selected.</p>
          : currentLookup?.state === 'unavailable' ? <p role="status" className="text-sm text-muted">Contact lookup is unavailable.</p>
          : null
      }
    />
  );

  // What may still follow a call for its contact's task: scheduling a callback, or completing the task.
  const nextAction = mayManageTasks && queueAvailable && !!callContactNow && !!ended?.callId;
  const [completing, startCompleting] = useTransition();
  const completeTask = (entry: DialerQueueEntry) => startCompleting(async () => {
    const result = await completeCallTaskAction(organizationId, entry.task.id).catch(() => ({ error: 'The call task could not be completed.' }));
    if (result.error) { toast.error(result.error); void reloadList(); return; }
    toast.success(`Call task completed for ${entry.customer.name}.`);
    if (chosen?.task.id === entry.task.id) setChosen(null);
    if (callId) void callContactContext(organizationId, callId).then(next => { if (next) setCallInfo(next); }).catch(() => undefined);
    refreshPage.current();
    outcomeResolved();
  });

  let surface: ReactNode;
  if (state === 'popped-out') {
    surface = (
      <div className={cx(pad, 'flex flex-wrap items-center justify-between gap-3')}>
        <p className="min-w-0 flex-1 text-sm font-medium">{live ? 'This call is in the separate dialer window.' : 'The dialer is open in a separate window.'}</p>
        <Button type="button" tone="secondary" onClick={() => popout?.close()}><ArrowDownLeft aria-hidden /> Return to GildOps</Button>
      </div>
    );
  } else if (state === 'incoming' || state === 'live') {
    surface = <ActiveCallDock organizationId={organizationId} placement="console" contactName={incoming ? null : callContactNow?.name} />;
  } else if (state === 'ended' && ended) {
    const label = formatPhoneForDisplay(callContactNow?.name ?? ended.contactLabel ?? 'Call');
    // Once the call is recorded as finished, its recorded times are the ones shown; until then,
    // what this telephone measured. Ringing and talking are never added together.
    const recorded = endedRecord && !UNSETTLED.has(endedRecord.status) ? endedRecord : null;
    const talkSeconds = recorded ? recorded.talkSeconds : ended.durationSeconds;
    const ringSeconds = recorded ? recorded.ringSeconds : ended.ringSeconds ?? null;
    const timing = [
      ended.direction === 'outgoing' ? 'Outgoing' : 'Incoming',
      talkSeconds !== null ? `Talk time ${clock(talkSeconds)}` : recorded ? UNANSWERED_LABEL[recorded.status] ?? 'Not answered' : 'Not answered',
      ringSeconds !== null ? `Rang ${clock(ringSeconds)}` : null,
      ended.fromNumber ? `from ${formatPhoneForDisplay(ended.fromNumber)}` : null,
    ].filter(Boolean).join(' · ');
    surface = (
      <div className={cx(pad, 'flex flex-col gap-5')}>
        <div className="flex min-w-0 items-center gap-4">
          <Avatar className="size-14 shrink-0"><AvatarFallback className="bg-secondary text-lg font-semibold text-muted">{initials(callContactNow?.name ?? ended.contactLabel ?? '')}</AvatarFallback></Avatar>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="min-w-0 truncate text-2xl font-semibold tracking-tight">{label}</h2>
              <StatePill>Call ended</StatePill>
            </div>
            <p data-slot="call-timing" className="text-sm text-muted tabular-nums">{timing}</p>
          </div>
        </div>
        {endedPending ? (
          <div role="status" data-state={endedPending} className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <p className="min-w-0 flex-1 text-muted">{outcomes ? 'Waiting for the carrier to confirm this call has ended. Wrap-up opens once it does.' : 'Waiting for the carrier to confirm this call has ended.'}</p>
            <Button type="button" tone="secondary" size="small" onClick={() => setRecheck(value => value + 1)}>Check again</Button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {outcomes && endedRecord?.status === 'completed' ? (
            <WrapUpCallSheet organizationId={organizationId} call={endedRecord} outcomes={outcomes} prominent onSaved={() => {
              toast.success('Outcome saved.');
              setRecheck(value => value + 1);
              // With a task still to settle, the operator decides what follows; otherwise the outcome is the last step.
              if (!nextAction) outcomeResolved();
            }} />
          ) : null}
          {nextAction && ended.callId && callContactNow ? (
            <ScheduleCallback organizationId={organizationId} timezone={timezone} callId={ended.callId} name={callContactNow.name} hasOpenTask={!!task} onScheduled={() => { refreshPage.current(); outcomeResolved(); }} />
          ) : null}
          {mayManageTasks && task ? <Button type="button" tone="secondary" disabled={completing} onClick={() => completeTask(task)}>Complete call task</Button> : null}
          {ended.callId ? <ButtonLink href={`/organizations/${organizationId}/calls/${ended.callId}`} tone="secondary">Open call record</ButtonLink> : null}
          {callingMode === 'auto' && queueAvailable
            ? <Button type="button" tone="secondary" disabled={advancing} onClick={() => advance()}>Next call</Button>
            : <Button type="button" tone="secondary" onClick={() => dismissEnded?.()}>Done</Button>}
        </div>
      </div>
    );
  } else if (selectedTask) {
    const name = selectedTask.customer?.name ?? selectedTask.task.customerName;
    surface = (
      <div className={cx(pad, 'flex flex-col gap-5')}>
        <div className="flex min-w-0 items-start gap-4">
          <Avatar className="size-14 shrink-0"><AvatarFallback className="bg-secondary text-lg font-semibold text-muted">{initials(name)}</AvatarFallback></Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="min-w-0 truncate text-2xl font-semibold tracking-tight">{name}</h2>
              {selectedTask.customer?.archived ? <StatePill tone="warning">Archived</StatePill> : null}
            </div>
            {business(selectedTask.customer) ? <p className="truncate text-sm text-muted">{business(selectedTask.customer)}</p> : null}
            <p className="mt-0.5 text-sm">{selectedTask.task.title}</p>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {selectedTask.standing.overdue ? <StatePill tone="danger">Overdue</StatePill> : selectedTask.standing.due ? <StatePill tone="warning">Due now</StatePill> : null}
              {selectedTask.standing.callback ? <StatePill>Callback</StatePill> : null}
              <span className="text-muted tabular-nums">Due {fullDate.format(new Date(selectedTask.task.dueAt))}</span>
            </p>
          </div>
        </div>
        {callForm}
      </div>
    );
  } else if (state === 'complete') {
    surface = (
      <div className={cx(pad, 'flex flex-col gap-3')}>
        <h2 className="text-base font-semibold tracking-tight">No more calls in this view</h2>
        <p className="text-sm text-muted">{session.skipped.length ? `${session.skipped.length} skipped this session.` : 'Every call here has been called or has no phone number.'}</p>
        <div className="flex flex-wrap items-center gap-2">
          {session.skipped.length ? <Button type="button" tone="secondary" onClick={() => changeSession({ skipped: [] })}>Restore skipped</Button> : null}
          {session.called.length ? <Button type="button" tone="secondary" onClick={() => changeSession({ called: [] })}>Start again</Button> : null}
        </div>
      </div>
    );
  } else if (state === 'idle') {
    surface = <div className={pad}><p className="text-sm text-muted">Select a contact from the call list.</p></div>;
  } else {
    surface = (
      <div className={cx(pad, 'flex flex-col gap-4')}>
        <h2 className="truncate text-base font-semibold tracking-tight">{draftContact?.name ?? 'New call'}</h2>
        {callForm}
      </div>
    );
  }

  // The task a call is about: what was asked for and by whom. Reason and due date sit with the
  // contact while preparing; during and after a call the call's own identity leads, so they move here.
  const taskDetails = task && state !== 'popped-out' ? (
    <section aria-label="Call task" className={cx(pad, 'shrink-0 border-t border-border')}>
      <dl className="mx-auto grid w-full max-w-3xl grid-cols-[5.5rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm @min-[28rem]/calling:grid-cols-[7rem_minmax(0,1fr)] @min-[28rem]/calling:gap-x-6">
        {state !== 'contact' ? <>
          <dt className="text-muted">Reason</dt>
          <dd className="font-medium">{task.task.title}</dd>
          <dt className="text-muted">Due</dt>
          <dd className="tabular-nums">{fullDate.format(new Date(task.task.dueAt))}</dd>
        </> : null}
        <dt className="text-muted">Owner</dt>
        <dd><OwnerIdentity name={task.task.ownerName} /></dd>
        <dt className="text-muted">Notes</dt>
        <dd className={cx('whitespace-pre-wrap', !task.task.notes && 'text-muted')}>{task.task.notes ?? 'No notes recorded.'}</dd>
        {task.task.opportunityId ? <>
          <dt className="text-muted">Opportunity</dt>
          <dd><Link className="underline underline-offset-4" href={`/organizations/${organizationId}/crm/opportunities/${task.task.opportunityId}`}>{task.task.opportunityTitle ?? 'Open opportunity'}</Link></dd>
        </> : null}
      </dl>
    </section>
  ) : null;

  const needsWrapUp = wrapUp ? (
    <section aria-labelledby="dialer-wrap-up" className={cx(pad, 'shrink-0 border-t border-border')}>
      <div className="mx-auto w-full max-w-3xl">
        <h3 id="dialer-wrap-up" className="mb-2 text-sm font-semibold tracking-tight">Needs wrap-up</h3>
        {wrapUp}
      </div>
    </section>
  ) : null;

  // --- Call list -------------------------------------------------------------------------------
  const nobodyListed = list.counts.all === 0 && !session.search.trim() && session.skipped.length === 0;
  const queuePanel = (
    <CallListPanel
      organizationId={organizationId}
      timezone={timezone}
      available={queueAvailable}
      items={list.items}
      counts={list.counts}
      total={list.total}
      loading={list.loading}
      loadingMore={list.loadingMore}
      error={list.error}
      onLoadMore={() => void list.loadMore()}
      onRetry={() => void reloadList()}
      session={session}
      onSession={changeSession}
      mode={callingMode}
      manualDialing={manualDialing}
      selectedId={selectedTask?.task.id ?? null}
      onChoose={choose}
      onSkip={skip}
      onChanged={listChanged}
      addToList={mayAddToList && queueAvailable ? <AddToCallList organizationId={organizationId} mayCreateContacts={mayCreateContacts} /> : null}
      mayViewContacts={mayViewContacts}
      mayManageTasks={mayManageTasks && queueAvailable}
      mayRemoveFromList={mayRemoveFromList}
    />
  );

  // --- Contact context -----------------------------------------------------------------------------
  const contextPanel = (
    <OperationalPanel title="Contact" density="compact" fill={!!contextCustomer} className="min-h-0 flex-1">
      {!contextCustomer ? (
        <CompactEmptyState>{afterCall ? 'No contact is linked to this call.' : 'Select a contact from the call list.'}</CompactEmptyState>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <Avatar className="size-10 shrink-0"><AvatarFallback className="bg-secondary text-sm font-semibold text-muted">{initials(contextCustomer.name)}</AvatarFallback></Avatar>
            <div className="min-w-0">
              {mayViewContacts ? <Link className="block truncate font-semibold underline-offset-4 hover:underline" href={`/organizations/${organizationId}/crm/contacts/${contextCustomer.id}`}>{contextCustomer.name}</Link> : <p className="truncate font-semibold">{contextCustomer.name}</p>}
              {contextCustomer.title ? <p className="truncate text-sm text-muted">{contextCustomer.title}</p> : null}
              {contextCustomer.archived ? <StatePill tone="warning">Archived</StatePill> : null}
            </div>
          </div>
          <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
            {contextCustomer.companyName && contextCustomer.companyId !== contextCustomer.id ? <>
              <dt className="text-muted">Business</dt>
              <dd className="truncate">{mayViewContacts && contextCustomer.companyId ? <Link className="underline underline-offset-4" href={`/organizations/${organizationId}/crm/contacts/${contextCustomer.companyId}`}>{contextCustomer.companyName}</Link> : contextCustomer.companyName}</dd>
            </> : null}
            <dt className="text-muted">Phone</dt>
            <dd className={cx('truncate tabular-nums', !contextCustomer.phone && 'text-muted')}>{contextCustomer.phone ? formatPhoneForDisplay(contextCustomer.phone) : 'Not recorded'}</dd>
            <dt className="text-muted">Email</dt>
            <dd className={cx('truncate', !contextCustomer.email && 'text-muted')}>{contextCustomer.email ?? 'Not recorded'}</dd>
          </dl>
          <div>
            <h3 className="mb-2 text-sm font-medium">Recent calls</h3>
            {(afterCall && callContext?.contact?.id === contextCustomer.id ? <RecentCallRows organizationId={organizationId} rows={callContext.recentCalls} /> : null)
              ?? (!afterCall && selectedTask && entryInfo?.taskId === selectedTask.task.id ? <RecentCallRows organizationId={organizationId} rows={entryInfo.recentCalls} /> : null) ?? (mayViewContacts ? <ButtonLink tone="text" size="small" href={`/organizations/${organizationId}/crm/contacts/${contextCustomer.id}?section=activity&view=calls`}>Open call history</ButtonLink> : <p className="text-sm text-muted">No recent calls.</p>)}
          </div>
          {mayViewContacts ? <ButtonLink href={`/organizations/${organizationId}/crm/contacts/${contextCustomer.id}`} tone="secondary" size="small" className="w-full">Open contact</ButtonLink> : null}
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
        <Button type="button" tone="secondary" size="small" aria-label="Context panel" aria-pressed={contextShown} disabled={focus || !contextCustomer} onClick={() => setShowContext(value => !value)}><PanelRight aria-hidden /> Contact</Button>
      </div>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {popout ? <Button type="button" tone="secondary" aria-label={poppedOut ? 'Show dialer window' : 'Pop out dialer'} data-dialer-popout-trigger onClick={openPopout}><ExternalLink aria-hidden /> {poppedOut ? 'Show dialer window' : 'Pop out'}</Button> : null}
        {actions}
        {settings.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" tone="secondary" aria-label="More Dialer actions" title="More" className="px-2.5"><MoreHorizontal aria-hidden /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuGroup aria-label="Calling settings">
                <DropdownMenuLabel className="text-xs font-medium text-muted">Calling settings</DropdownMenuLabel>
                {settings.map(item => <DropdownMenuItem key={item.key} asChild><Link href={item.href}>{item.label}</Link></DropdownMenuItem>)}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
    {popout?.error ? <p role="alert" className="text-sm text-danger">{popout.error}</p> : null}
    {gone ? <p role="status" className="text-sm text-muted">{gone} is no longer on the call list.</p> : null}

    {/* Below desktop width one region is shown at a time; a live call is never out of reach. */}
    {!focus ? <div role="group" aria-label="Dialer region" data-slot="tabs-list" data-variant="segmented" className={cx(tabListStyles(), 'w-full @min-[64rem]/dialer:hidden')}>
      {REGIONS.map(({ key, label }) => <button key={key} type="button" data-slot="tabs-trigger" aria-pressed={region === key} className={cx(tabTriggerStyles, 'flex-1')} onClick={() => setRegion(key)}>{label}</button>)}
    </div> : null}
    {live && !focus && region !== 'call' ? <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-sm @min-[64rem]/dialer:hidden">
      <span>{incoming ? 'Incoming call' : `On a call with ${formatPhoneForDisplay(activeCall?.contactLabel ?? 'a caller')}`}</span>
      <Button type="button" tone="secondary" size="small" onClick={() => setRegion('call')}>Show call controls</Button>
    </div> : null}

    <div
      ref={grid}
      className="grid min-w-0 gap-3 @min-[64rem]/dialer:max-h-(--dialer-available) @min-[64rem]/dialer:grid-cols-(--dialer-columns) @min-[64rem]/dialer:grid-rows-[minmax(0,1fr)]"
      style={{ '--dialer-columns': columns } as CSSProperties}
    >
      <div className={cx(regionClass('queue', queueShown), 'min-h-0 min-w-0 flex-col', nobodyListed && 'self-start')}>{queuePanel}</div>
      {/* The same shared surface as the panels beside it, so Appearance presets reach all three alike. */}
      <div data-slot="operational-panel" data-surface-variant="default" className={cx(focus ? 'flex' : region === 'call' ? 'flex' : 'hidden', surfaceVariants.default, '@container/calling min-h-0 min-w-0 flex-col self-start overflow-hidden rounded-lg border border-border bg-surface @min-[64rem]/dialer:flex @min-[64rem]/dialer:max-h-full @min-[64rem]/dialer:overflow-y-auto', focus && 'mx-auto w-full max-w-4xl')}>
        {readiness}
        <section aria-label="Calling console" data-state={state} className="shrink-0">
          <div className="mx-auto w-full max-w-3xl">{surface}</div>
        </section>
        {taskDetails}
        {needsWrapUp}
      </div>
      <div className={cx(regionClass('context', contextShown), 'min-h-0 min-w-0 flex-col', !contextCustomer && 'self-start')}>{contextPanel}</div>
    </div>
  </div>;
}
