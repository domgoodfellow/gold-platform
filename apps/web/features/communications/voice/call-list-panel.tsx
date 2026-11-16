'use client';

import { useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Avatar, AvatarFallback } from '@gold/ui/components/avatar';
import { Button, ButtonLink } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import { SelectField } from '@/components/controls/select-field';
import { cx, FOCUS_RING } from '@/components/class-names';
import { OperationalPanel, PanelState, StatePill } from '@/components/operational/primitives';
import { formatPhoneForDisplay } from '@/lib/display/phone';
import type { DialerQueueEntry } from '@/lib/application/communications/dialer-queue';
import type { CallContact } from '@/lib/domain/reception/calls';
import { CALL_LIST_SEARCH_MAX, CALL_LIST_VIEWS, type CallListCounts, type CallListView } from '@/lib/domain/tasks/call-list-views';
import { CallListEntryActions } from './call-list-entry-actions';
import type { CallingMode, CallingSession } from './calling-session';

const VIEW_LABEL: Record<CallListView, string> = {
  all: 'All calls',
  mine: 'My calls',
  due: 'Due now',
  overdue: 'Overdue',
  upcoming: 'Upcoming',
  callbacks: 'Callbacks',
};
const MODE_LABEL: Record<CallingMode, string> = { preview: 'Preview', auto: 'Auto-advance', manual: 'Manual' };

export function contactInitials(name: string): string {
  const words = name.replace(/[^\p{L}\s]/gu, '').trim().split(/\s+/).filter(Boolean);
  return words.length ? words.slice(0, 2).map(word => word[0]).join('').toUpperCase() : '#';
}

/** The business a person belongs to, with their title there. A company is its own business, so it has none to add. */
export function contactBusiness(contact: CallContact | null | undefined): string | null {
  if (!contact?.companyName || contact.companyId === contact.id) return null;
  return contact.title ? `${contact.title}, ${contact.companyName}` : contact.companyName;
}

/**
 * The Dialer's call list: open Call tasks, searched, filtered, counted and paged by the server.
 *
 * It owns the view, the search, the calling mode and each entry's actions. It places no call:
 * choosing an entry only prepares one in the calling workspace. Every count is the server's count
 * of that view for the current search, with skipped calls left out of rows and counts alike.
 */
export function CallListPanel({
  organizationId, timezone, available, items, counts, total, loading, loadingMore, error, onLoadMore, onRetry,
  session, onSession, mode, manualDialing, selectedId, onChoose, onSkip, onChanged,
  addToList, mayViewContacts, mayManageTasks, mayRemoveFromList,
}: {
  organizationId: string;
  timezone: string;
  /** False when the business has no Tasks, so there is no call list. */
  available: boolean;
  items: DialerQueueEntry[];
  counts: CallListCounts;
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  onLoadMore: () => void;
  onRetry: () => void;
  session: CallingSession;
  onSession: (change: Partial<CallingSession>) => void;
  /** The mode in effect: the session's, or Preview when the session asks for a mode this member may not use. */
  mode: CallingMode;
  manualDialing: boolean;
  selectedId: string | null;
  onChoose: (entry: DialerQueueEntry) => void;
  onSkip: (entry: DialerQueueEntry) => void;
  onChanged: () => void;
  addToList: ReactNode;
  mayViewContacts: boolean;
  mayManageTasks: boolean;
  mayRemoveFromList: boolean;
}) {
  const dayKey = (value: Date | number) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, dateStyle: 'short' }).format(value);
  const timeOf = new Intl.DateTimeFormat('en', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
  const dayOf = new Intl.DateTimeFormat('en', { timeZone: timezone, month: 'short', day: 'numeric' });
  const fullDate = new Intl.DateTimeFormat('en', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' });
  // Fixed when the list is drawn: which day is today, for showing a time rather than a date.
  const [drawnAt] = useState(() => Date.now());
  const today = dayKey(drawnAt);
  const when = (dueAt: string) => {
    const due = new Date(dueAt);
    return dayKey(due) === today ? timeOf.format(due) : dayOf.format(due);
  };

  const skipped = session.skipped.length;
  const searching = session.search.trim().length > 0;
  // Nobody is on the list at all: not an empty view, an empty search or a list of skipped calls.
  const nobody = counts.all === 0 && !searching && skipped === 0 && !loading && !error;
  const modes: CallingMode[] = manualDialing ? ['preview', 'auto', 'manual'] : ['preview', 'auto'];
  const called = new Set(session.called);

  return (
    <OperationalPanel
      title="Call list"
      count={available ? total : undefined}
      density="compact"
      body="edge-to-edge"
      fill={available && !nobody}
      href={available && counts.all > 0 ? `/organizations/${organizationId}/crm/tasks?status=open&kind=call` : undefined}
      hrefLabel="All call tasks"
      action={!nobody ? addToList : undefined}
      className="min-h-0 flex-1"
    >
      {!available ? <PanelState kind="not-configured">Tasks are not included for this business, so there is no call list.</PanelState> : nobody ? (
        <div className="space-y-3 p-3">
          <p className="text-sm text-muted">No contacts on the call list.</p>
          {addToList}
          {mayViewContacts ? <ButtonLink tone="text" size="small" href={`/organizations/${organizationId}/crm/contacts`}>Open Contacts</ButtonLink> : null}
        </div>
      ) : <>
        <div className="shrink-0 space-y-2 border-b border-border p-3">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <TextInput type="search" aria-label="Search call list" placeholder="Search name, business or number" maxLength={CALL_LIST_SEARCH_MAX} value={session.search} onChange={event => onSession({ search: event.target.value })} className="pl-8" />
          </div>
          {/* Side by side where both fit; stacked in a narrow column, so neither cuts its words or count. */}
          <div className="flex flex-wrap gap-2">
            <SelectField
              aria-label="Call list view" size="small" className="min-w-36 flex-1" value={session.view}
              onValueChange={view => onSession({ view: view as CallListView })}
              options={CALL_LIST_VIEWS.map(view => ({ value: view, label: `${VIEW_LABEL[view]} · ${counts[view]}` }))}
            />
            <SelectField
              aria-label="Calling mode" size="small" className="min-w-36 flex-1" value={mode}
              onValueChange={next => onSession({ mode: next as CallingMode })}
              options={modes.map(value => ({ value, label: MODE_LABEL[value] }))}
            />
          </div>
        </div>
        {error ? (
          <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3 text-sm">
            <p className="min-w-0 flex-1">{error}</p>
            <Button type="button" tone="secondary" size="small" onClick={onRetry}>Try again</Button>
          </div>
        ) : items.length === 0 ? <PanelState>{loading ? 'Loading calls…' : searching ? 'No calls match.' : `No calls in ${VIEW_LABEL[session.view]}.`}</PanelState> : (
          <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto" aria-label="Calls" aria-busy={loading}>
            {items.map(entry => {
              const { task, customer, standing } = entry;
              const name = customer.name;
              const chosen = selectedId === task.id;
              const business = contactBusiness(customer);
              return <li key={task.id} className={cx('flex items-start', chosen && 'bg-selected')}>
                <button type="button" aria-pressed={chosen} onClick={() => onChoose(entry)} className={cx('flex min-w-0 flex-1 items-start gap-3 border-l-2 px-3 py-2.5 text-left transition-colors', chosen ? 'border-accent' : 'border-transparent hover:bg-hover', FOCUS_RING)}>
                  <Avatar className="mt-0.5 size-9 shrink-0"><AvatarFallback className="bg-secondary text-xs font-semibold text-muted">{contactInitials(name)}</AvatarFallback></Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-semibold">{name}</span>{customer.archived ? <StatePill tone="warning">Archived</StatePill> : null}</span>
                      <span title={fullDate.format(new Date(task.dueAt))} className="shrink-0 text-xs tabular-nums text-muted">{when(task.dueAt)}</span>
                    </span>
                    {business ? <span data-slot="contact-business" className="block truncate text-xs">{business}</span> : null}
                    <span className="block truncate text-xs text-muted">{standing.callback ? 'Callback · ' : ''}{task.title}</span>
                    <span className="block truncate text-xs tabular-nums text-muted">
                      {standing.overdue || standing.due ? <><span data-slot="call-due" data-standing={standing.overdue ? 'overdue' : 'due'} className={cx('font-medium', standing.overdue ? 'text-danger' : 'text-warning')}>{standing.overdue ? 'Overdue' : 'Due now'}</span> · </> : <span data-slot="call-due" data-standing="upcoming" hidden />}
                      {customer.phone ? formatPhoneForDisplay(customer.phone) : 'No phone number'}{task.ownerName ? ` · ${task.ownerName}` : ''}{called.has(task.id) ? ' · Called' : ''}
                    </span>
                  </span>
                </button>
                <div className="shrink-0 py-2 pr-1">
                  <CallListEntryActions
                    organizationId={organizationId} timezone={timezone}
                    entry={{ taskId: task.id, customerId: customer.id, name, dueAt: task.dueAt, ownerMembershipId: task.ownerMembershipId }}
                    mayViewContacts={mayViewContacts} mayManageTasks={mayManageTasks} mayRemove={mayRemoveFromList}
                    onSkip={() => onSkip(entry)} onChanged={onChanged}
                  />
                </div>
              </li>;
            })}
          </ul>
        )}
        {!error && (items.length < total || skipped > 0) ? (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border px-3 py-2 text-xs text-muted">
            {items.length < total ? <>
              <span className="tabular-nums">Showing {items.length} of {total}</span>
              <Button type="button" tone="text" size="tiny" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? 'Loading…' : 'Load more'}</Button>
            </> : null}
            {skipped > 0 ? <>
              <span className="tabular-nums">{skipped} skipped this session</span>
              <Button type="button" tone="text" size="tiny" onClick={() => onSession({ skipped: [] })}>Restore skipped</Button>
            </> : null}
          </div>
        ) : null}
      </>}
    </OperationalPanel>
  );
}
