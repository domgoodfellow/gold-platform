// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DialerWorkspace } from '@/features/communications/voice/dialer-workspace';
import { resetCallingSessions } from '@/features/communications/voice/calling-session';
import type { CallingOptions, OutboundLine } from '@/lib/application/communications/calling-options';
import type { DialerQueueEntry } from '@/lib/application/communications/dialer-queue';
import type { CallListCounts } from '@/lib/domain/tasks/call-list-views';
import { chooseOption, optionLabels, optionValues } from '../support/select-field';

/**
 * The call list as a working list: the server's views, counts and pages; skipping; the calling
 * modes; moving on after a call; and the permission to type in a number. The server actions are
 * stand-ins here; `call-list-workflow.test.ts` holds the database to the same rules.
 */

const actions = vi.hoisted(() => ({
  removeFromCallListAction: vi.fn(), loadCallListAction: vi.fn(), nextCallListEntryAction: vi.fn(), callListEntryAction: vi.fn(),
  completeCallTaskAction: vi.fn(), rescheduleCallTaskAction: vi.fn(), reassignCallTaskAction: vi.fn(), scheduleCallbackAction: vi.fn(), callTaskEditOptions: vi.fn(),
}));
const refresh = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const dial = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const endedRecord = vi.hoisted(() => vi.fn());
const callContext = vi.hoisted(() => vi.fn());
const telephone = vi.hoisted(() => ({ value: { activeCall: null as unknown, incoming: null as unknown, ended: null as unknown, dismissEnded: vi.fn(), status: 'offline', error: null, register: vi.fn(), unregister: vi.fn() } }));
vi.mock('@/app/organizations/[organizationId]/calls/call-list-actions', () => actions);
vi.mock('@/app/organizations/[organizationId]/calls/actions', () => ({ matchDialerContact: vi.fn().mockResolvedValue({ state: 'none' }), endedCallRecord: endedRecord, callContactContext: callContext }));
vi.mock('next/navigation', async (original) => ({ ...(await original<typeof import('next/navigation')>()), useRouter: () => ({ refresh }) }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/features/communications/voice/use-dial', () => ({ useDial: () => ({ dial, dialing: false, error: null }) }));
vi.mock('@/features/communications/voice/telephone-device', () => ({ useTelephoneDevice: () => telephone.value }));
vi.mock('@/features/communications/voice/add-to-call-list', () => ({ AddToCallList: () => null }));
vi.mock('@/features/communications/voice/active-call-dock', () => ({ ActiveCallDock: () => <div data-testid="live-call">Live call controls</div> }));
// The real drawer saves through the runtime; here pressing it stands for a saved outcome.
vi.mock('@/features/communications/voice/wrap-up-sheet', () => ({ WrapUpCallSheet: ({ onSaved }: { onSaved?: () => void }) => <button type="button" onClick={() => onSaved?.()}>Wrap up call</button> }));

const entry = (id: string, name: string, phone: string | null = `+1416555${String(1000 + id.length * 7).slice(0, 4)}`, standing: Partial<DialerQueueEntry['standing']> = {}, ownerName: string | null = null): DialerQueueEntry => ({
  task: { id, customerId: id, customerName: name, title: `Call ${name}`, notes: null, dueAt: '2026-10-17T12:00:00Z', kind: 'call', status: 'open', opportunityId: null, opportunityTitle: null, ownerMembershipId: ownerName ? `member-${ownerName}` : null, ownerName, completedAt: null, createdAt: '2026-10-16T12:00:00Z' },
  customer: { id, name, phone, email: null },
  standing: { mine: false, due: true, overdue: false, callback: false, ...standing },
});
const counts = (over: Partial<CallListCounts> = {}): CallListCounts => ({ all: 0, mine: 0, due: 0, overdue: 0, upcoming: 0, callbacks: 0, ...over });
const page = (items: DialerQueueEntry[], over: Partial<CallListCounts> = {}, selected?: DialerQueueEntry | null) => {
  const all = counts({ all: items.length, ...over });
  return { error: null, items, counts: all, total: items.length, ...(selected !== undefined ? { selected } : {}) };
};
const office: OutboundLine = { id: 'office', e164: '+14165550100', label: 'Office', source: 'member_default', group: 'assigned' };
/** A member who works the call list and may not type in a number. */
const listOnly: CallingOptions = { numbers: [office], defaultNumber: office, unavailableReason: null, blocker: null, manualDialing: false };
const anyNumber: CallingOptions = { ...listOnly, manualDialing: true };

const alice = entry('alice', 'Alice', '+14165550101');
const bob = entry('bob', 'Bob', '+14165550102');
const cara = entry('cara', 'Cara', '+14165550103');

type Props = Partial<ComponentProps<typeof DialerWorkspace>> & { queue: DialerQueueEntry[] };
function Dialer({ queue, ...props }: Props) {
  return <DialerWorkspace organizationId="tenant" timezone="America/Toronto" queueAvailable options={listOnly} queue={queue} queueTotal={queue.length} queueCounts={counts({ all: queue.length, due: queue.length })} {...props} />;
}
const rows = (name: string) => screen.queryAllByRole('button', { name: new RegExp(name) }).filter(button => button.hasAttribute('aria-pressed'));
const row = (name: string) => { const found = rows(name); if (found.length !== 1) throw new Error(`Expected one call list row for ${name}, found ${found.length}.`); return found[0]; };
const workspace = () => screen.getByRole('region', { name: 'Calling console' });
const menu = async (user: ReturnType<typeof userEvent.setup>, name: string, item: string) => {
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
};
const endedCall = { callId: 'call', contactLabel: 'Alice', customerId: 'alice', direction: 'outgoing', ringSeconds: 4, durationSeconds: 60 };
const completed = { id: 'call', status: 'completed', note: '', outcome: null, ringSeconds: 4, talkSeconds: 60 };

beforeEach(() => {
  actions.callListEntryAction.mockResolvedValue({ error: 'unavailable', entry: null, recentCalls: [] });
  actions.loadCallListAction.mockResolvedValue(page([]));
  actions.nextCallListEntryAction.mockResolvedValue({ error: null, entry: null });
  callContext.mockResolvedValue(null);
  endedRecord.mockResolvedValue(completed);
});
afterEach(() => {
  cleanup(); vi.clearAllMocks(); resetCallingSessions();
  for (const action of Object.values(actions)) action.mockReset();
  dial.mockReset().mockResolvedValue(true);
  telephone.value = { ...telephone.value, activeCall: null, incoming: null, ended: null, status: 'offline' };
});

describe('call list views, counts and pages', () => {
  it('offers each view with the server’s count for it, and shows the count of the view chosen', async () => {
    render(<Dialer queue={[alice, bob]} queueTotal={40} queueCounts={counts({ all: 40, mine: 6, due: 9, overdue: 2, upcoming: 31, callbacks: 3 })} />);
    expect(await optionLabels(screen.getByLabelText('Call list view'))).toEqual(['All calls · 40', 'My calls · 6', 'Due now · 9', 'Overdue · 2', 'Upcoming · 31', 'Callbacks · 3']);
    const mine = entry('mia', 'Mia', '+14165550140', { mine: true }, 'Me');
    actions.loadCallListAction.mockResolvedValue({ error: null, items: [mine], total: 6, counts: counts({ all: 40, mine: 6, due: 9, overdue: 2, upcoming: 31, callbacks: 3 }) });
    await chooseOption(screen.getByLabelText('Call list view'), 'mine');
    await waitFor(() => row('Mia'));
    expect(actions.loadCallListAction).toHaveBeenLastCalledWith('tenant', { view: 'mine', search: '', skipped: [] }, expect.objectContaining({ offset: 0, limit: 25 }));
    expect(rows('Alice')).toHaveLength(0);
    // The heading's count is the chosen view's own count, not the size of the whole list.
    expect(within(screen.getByRole('region', { name: 'Call list' })).getByText('6')).toBeVisible();
    expect(screen.getByText('Showing 1 of 6')).toBeVisible();
  });

  it('loads the next page from the server and adds it, without repeating a call', async () => {
    render(<Dialer queue={[alice, bob]} queueTotal={3} />);
    actions.loadCallListAction.mockResolvedValue({ error: null, items: [bob, cara], total: 3, counts: counts({ all: 3 }) });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => row('Cara'));
    expect(actions.loadCallListAction).toHaveBeenCalledWith('tenant', { view: 'all', search: '', skipped: [] }, { offset: 2, limit: 25 });
    expect(rows('Bob')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('says a failed read failed, with a way to try again, and never shows an empty list in its place', async () => {
    render(<Dialer queue={[alice]} />);
    actions.loadCallListAction.mockResolvedValue({ error: 'Your role cannot see the call list.', items: [], total: 0, counts: counts() });
    await chooseOption(screen.getByLabelText('Call list view'), 'overdue');
    const alert = await within(screen.getByRole('region', { name: 'Call list' })).findByRole('alert');
    expect(alert).toHaveTextContent('Your role cannot see the call list.');
    expect(screen.queryByText(/No calls in/)).not.toBeInTheDocument();
    actions.loadCallListAction.mockResolvedValue(page([bob], { overdue: 1 }));
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => row('Bob'));
  });

  it('shows when each call is due, whether it is overdue, a callback, and who owns it', () => {
    render(<Dialer queue={[entry('late', 'Late Lena', '+14165550150', { overdue: true, callback: true }, 'Sam'), entry('soon', 'Soon Sol', '+14165550151', { due: false })]} />);
    expect(row('Late Lena')).toHaveTextContent('Oct 17');
    expect(row('Late Lena')).toHaveTextContent('Callback · Call Late Lena');
    expect(row('Late Lena')).toHaveTextContent('Overdue · (416)555-0150 · Sam');
    expect(row('Late Lena').querySelector('[data-slot="call-due"]')).toHaveAttribute('data-standing', 'overdue');
    expect(row('Soon Sol').querySelector('[data-slot="call-due"]')).toHaveAttribute('data-standing', 'upcoming');
    expect(row('Soon Sol')).not.toHaveTextContent('Callback');
  });

  it('keeps the view and search when the Dialer is left and opened again', async () => {
    actions.loadCallListAction.mockResolvedValue(page([bob], { all: 2, callbacks: 1 }));
    const first = render(<Dialer queue={[alice, bob]} />);
    await chooseOption(screen.getByLabelText('Call list view'), 'callbacks');
    await waitFor(() => expect(rows('Alice')).toHaveLength(0));
    first.unmount();
    actions.loadCallListAction.mockClear();
    render(<Dialer queue={[alice, bob]} />);
    // The route drew the default view; the session's view is read from the server in its place.
    await waitFor(() => expect(actions.loadCallListAction).toHaveBeenCalledWith('tenant', { view: 'callbacks', search: '', skipped: [] }, expect.anything()));
    await waitFor(() => expect(rows('Alice')).toHaveLength(0));
    expect(screen.getByLabelText('Call list view')).toHaveTextContent('Callbacks · 1');
  });
});

describe('skipping a call for this session', () => {
  it('sets the entry aside without touching its task, and brings it back on request', async () => {
    const user = userEvent.setup();
    render(<Dialer queue={[alice, bob]} mayRemoveFromList mayManageTasks />);
    actions.loadCallListAction.mockResolvedValue(page([alice]));
    await menu(user, 'Bob', 'Skip for this session');
    await waitFor(() => expect(rows('Bob')).toHaveLength(0));
    // The server leaves skipped calls out of rows and counts alike.
    expect(actions.loadCallListAction).toHaveBeenLastCalledWith('tenant', { view: 'all', search: '', skipped: ['bob'] }, expect.anything());
    expect(actions.removeFromCallListAction).not.toHaveBeenCalled();
    expect(actions.completeCallTaskAction).not.toHaveBeenCalled();
    expect(actions.rescheduleCallTaskAction).not.toHaveBeenCalled();
    expect(screen.getByText('1 skipped this session')).toBeVisible();
    actions.loadCallListAction.mockResolvedValue(page([alice, bob]));
    await user.click(screen.getByRole('button', { name: 'Restore skipped' }));
    await waitFor(() => row('Bob'));
    await waitFor(() => expect(actions.loadCallListAction).toHaveBeenLastCalledWith('tenant', { view: 'all', search: '', skipped: [] }, expect.anything()));
  });

  it('stops preparing the skipped entry, and in Preview chooses nobody in their place', async () => {
    const user = userEvent.setup();
    render(<Dialer queue={[alice, bob]} />);
    expect(workspace()).toHaveAttribute('data-state', 'contact');
    actions.loadCallListAction.mockResolvedValue(page([bob]));
    await menu(user, 'Alice', 'Skip for this session');
    await waitFor(() => expect(workspace()).toHaveAttribute('data-state', 'idle'));
    expect(actions.nextCallListEntryAction).not.toHaveBeenCalled();
    expect(dial).not.toHaveBeenCalled();
  });
});

describe('calling modes', () => {
  it('offers Manual only to a member who may type in a number', async () => {
    const app = render(<Dialer queue={[alice]} />);
    expect(await optionValues(screen.getByLabelText('Calling mode'))).toEqual(['preview', 'auto']);
    expect(screen.queryByRole('button', { name: 'Dial another number' })).not.toBeInTheDocument();
    app.unmount();
    render(<Dialer queue={[alice]} options={anyNumber} />);
    expect(await optionValues(screen.getByLabelText('Calling mode'))).toEqual(['preview', 'auto', 'manual']);
    await chooseOption(screen.getByLabelText('Calling mode'), 'manual');
    expect(workspace()).toHaveAttribute('data-state', 'manual');
    expect(screen.getByLabelText('Number to call')).toHaveValue('');
    expect(row('Alice')).toHaveAttribute('aria-pressed', 'false');
    // Choosing a contact leaves Manual: the call is theirs again.
    fireEvent.click(row('Alice'));
    expect(workspace()).toHaveAttribute('data-state', 'contact');
    expect(screen.getByLabelText('Calling mode')).toHaveTextContent('Preview');
  });

  it('gives a member without manual dialing no number to type, with or without a contact chosen', () => {
    const app = render(<Dialer queue={[]} queueCounts={counts()} />);
    expect(workspace()).toHaveAttribute('data-state', 'idle');
    expect(workspace()).toHaveTextContent('Select a contact from the call list.');
    expect(screen.queryByLabelText('Number to call')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Call' })).not.toBeInTheDocument();
    app.unmount();
    render(<Dialer queue={[alice]} />);
    expect(within(workspace()).getByText('(416)555-0101')).toBeVisible();
    expect(screen.queryByLabelText('Number to call')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Call' })).toBeEnabled();
  });

  it('shows a number handed over by a link as it is, not as a field, to a member without manual dialing', async () => {
    render(<Dialer queue={[alice]} prefill="+14165550199" />);
    expect(workspace()).toHaveAttribute('data-state', 'manual');
    expect(within(workspace()).getByText('(416)555-0199')).toBeVisible();
    expect(screen.queryByLabelText('Number to call')).not.toBeInTheDocument();
    // The server decides whether it may be rung: a contact's number or a caller's is; another is refused.
    fireEvent.click(screen.getByRole('button', { name: 'Call' }));
    await waitFor(() => expect(dial).toHaveBeenCalledWith(expect.objectContaining({ toNumber: '+14165550199' })));
  });

  it('in Preview stays with the call after its outcome is saved, and moves on only when the operator chooses', async () => {
    telephone.value = { ...telephone.value, ended: endedCall };
    render(<Dialer queue={[alice, bob]} outcomes={[]} />);
    fireEvent.click(await within(workspace()).findByRole('button', { name: 'Wrap up call' }));
    expect(toast.success).toHaveBeenCalledWith('Outcome saved.');
    expect(actions.nextCallListEntryAction).not.toHaveBeenCalled();
    expect(within(workspace()).getByRole('button', { name: 'Done' })).toBeEnabled();
    expect(within(workspace()).queryByRole('button', { name: 'Next call' })).not.toBeInTheDocument();
  });
});

describe('auto-advance', () => {
  const auto = async () => { await chooseOption(screen.getByLabelText('Calling mode'), 'auto'); };

  it('marks who was called, and after the outcome is saved prepares the next eligible call without dialing it', async () => {
    const app = render(<Dialer queue={[alice, bob]} outcomes={[]} />);
    await auto();
    fireEvent.click(screen.getByRole('button', { name: 'Call' }));
    await waitFor(() => expect(dial).toHaveBeenCalledTimes(1));
    expect(row('Alice')).toHaveTextContent('Called');
    // The call ends; hanging up completes no task and chooses nobody.
    telephone.value = { ...telephone.value, ended: endedCall };
    app.rerender(<Dialer queue={[alice, bob]} outcomes={[]} />);
    expect(workspace()).toHaveAttribute('data-state', 'ended');
    expect(actions.completeCallTaskAction).not.toHaveBeenCalled();
    expect(actions.nextCallListEntryAction).not.toHaveBeenCalled();
    actions.nextCallListEntryAction.mockResolvedValue({ error: null, entry: bob });
    actions.loadCallListAction.mockResolvedValue(page([alice, bob]));
    fireEvent.click(await within(workspace()).findByRole('button', { name: 'Wrap up call' }));
    await waitFor(() => expect(actions.nextCallListEntryAction).toHaveBeenCalledWith('tenant', { view: 'all', search: '', skipped: [] }, ['alice']));
    await waitFor(() => expect(telephone.value.dismissEnded).toHaveBeenCalled());
    await waitFor(() => expect(row('Bob')).toHaveAttribute('aria-pressed', 'true'));
    // Only prepared: the one call placed is the one the operator pressed Call for.
    expect(dial).toHaveBeenCalledTimes(1);
  });

  it('asks for the next call within the current view and search, leaving out skipped calls', async () => {
    const user = userEvent.setup();
    telephone.value = { ...telephone.value, ended: endedCall };
    actions.loadCallListAction.mockResolvedValue(page([alice, cara], { overdue: 2 }));
    render(<Dialer queue={[alice, bob, cara]} outcomes={[]} />);
    await auto();
    await chooseOption(screen.getByLabelText('Call list view'), 'overdue');
    await waitFor(() => expect(rows('Bob')).toHaveLength(0));
    actions.loadCallListAction.mockResolvedValue(page([alice], { overdue: 1 }));
    await menu(user, 'Cara', 'Skip for this session');
    await waitFor(() => expect(rows('Cara')).toHaveLength(0));
    await user.click(within(workspace()).getByRole('button', { name: 'Next call' }));
    await waitFor(() => expect(actions.nextCallListEntryAction).toHaveBeenLastCalledWith('tenant', { view: 'overdue', search: '', skipped: ['cara'] }, []));
  });

  it('never moves on while a call is live', async () => {
    const user = userEvent.setup();
    telephone.value = { ...telephone.value, status: 'ready', activeCall: { status: 'in_progress', direction: 'outgoing', muted: false, startedAt: Date.now(), callId: 'call', contactLabel: 'Alice', customerId: 'alice' } };
    render(<Dialer queue={[alice, bob]} outcomes={[]} />);
    await auto();
    actions.loadCallListAction.mockResolvedValue(page([bob]));
    // Skipping the entry being called sets it aside; the call stays where it is and nobody is chosen for it.
    await menu(user, 'Alice', 'Skip for this session');
    await waitFor(() => expect(rows('Alice')).toHaveLength(0));
    expect(actions.nextCallListEntryAction).not.toHaveBeenCalled();
    expect(screen.getByTestId('live-call')).toBeInTheDocument();
    expect(workspace()).toHaveAttribute('data-state', 'live');
    expect(screen.queryByRole('button', { name: 'Next call' })).not.toBeInTheDocument();
  });

  it('says so when nobody is left, and offers the skipped calls back', async () => {
    const user = userEvent.setup();
    telephone.value = { ...telephone.value, ended: endedCall };
    const app = render(<Dialer queue={[alice, bob]} outcomes={[]} />);
    await auto();
    actions.loadCallListAction.mockResolvedValue(page([alice]));
    await menu(user, 'Bob', 'Skip for this session');
    actions.nextCallListEntryAction.mockResolvedValue({ error: null, entry: null });
    await user.click(within(workspace()).getByRole('button', { name: 'Next call' }));
    // Moving on lets go of the ended call, as the real telephone does when asked.
    await waitFor(() => expect(telephone.value.dismissEnded).toHaveBeenCalled());
    telephone.value = { ...telephone.value, ended: null };
    app.rerender(<Dialer queue={[alice, bob]} outcomes={[]} />);
    await waitFor(() => expect(workspace()).toHaveAttribute('data-state', 'complete'));
    expect(within(workspace()).getByRole('heading', { name: 'No more calls in this view' })).toBeVisible();
    expect(workspace()).toHaveTextContent('1 skipped this session.');
    await user.click(within(workspace()).getByRole('button', { name: 'Restore skipped' }));
    expect(workspace()).not.toHaveAttribute('data-state', 'complete');
    expect(actions.removeFromCallListAction).not.toHaveBeenCalled();
    expect(actions.completeCallTaskAction).not.toHaveBeenCalled();
  });

  it('pauses by returning to Preview, changing no task', async () => {
    telephone.value = { ...telephone.value, ended: endedCall };
    render(<Dialer queue={[alice, bob]} outcomes={[]} />);
    await auto();
    await chooseOption(screen.getByLabelText('Calling mode'), 'preview');
    fireEvent.click(await within(workspace()).findByRole('button', { name: 'Wrap up call' }));
    expect(actions.nextCallListEntryAction).not.toHaveBeenCalled();
    expect(actions.completeCallTaskAction).not.toHaveBeenCalled();
  });

  it('with a task still to settle, waits for the operator after the outcome, then moves on once the task is completed', async () => {
    telephone.value = { ...telephone.value, ended: endedCall };
    callContext.mockResolvedValue({ callId: 'call', contact: alice.customer, recentCalls: [], task: alice });
    actions.completeCallTaskAction.mockResolvedValue({ error: null });
    actions.nextCallListEntryAction.mockResolvedValue({ error: null, entry: bob });
    actions.loadCallListAction.mockResolvedValue(page([bob]));
    render(<Dialer queue={[alice, bob]} outcomes={[]} mayManageTasks />);
    await auto();
    fireEvent.click(await within(workspace()).findByRole('button', { name: 'Wrap up call' }));
    expect(actions.nextCallListEntryAction).not.toHaveBeenCalled();
    fireEvent.click(await within(workspace()).findByRole('button', { name: 'Complete call task' }));
    await waitFor(() => expect(actions.completeCallTaskAction).toHaveBeenCalledWith('tenant', 'alice'));
    expect(toast.success).toHaveBeenCalledWith('Call task completed for Alice.');
    await waitFor(() => expect(actions.nextCallListEntryAction).toHaveBeenCalled());
    await waitFor(() => expect(row('Bob')).toHaveAttribute('aria-pressed', 'true'));
  });
});

describe('what follows a call', () => {
  it('offers the callback and the task’s completion only to a member who may manage tasks', async () => {
    telephone.value = { ...telephone.value, ended: endedCall };
    callContext.mockResolvedValue({ callId: 'call', contact: alice.customer, recentCalls: [], task: alice });
    const app = render(<Dialer queue={[alice]} outcomes={[]} />);
    await within(workspace()).findByRole('button', { name: 'Wrap up call' });
    expect(screen.queryByRole('button', { name: 'Schedule callback' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Complete call task' })).not.toBeInTheDocument();
    app.unmount();
    render(<Dialer queue={[alice]} outcomes={[]} mayManageTasks />);
    expect(await within(workspace()).findByRole('button', { name: 'Schedule callback' })).toBeVisible();
    expect(within(workspace()).getByRole('button', { name: 'Complete call task' })).toBeVisible();
  });

  it('schedules a callback by moving the contact’s open call task, asking for no new reason', async () => {
    const user = userEvent.setup();
    telephone.value = { ...telephone.value, ended: endedCall };
    callContext.mockResolvedValue({ callId: 'call', contact: alice.customer, recentCalls: [], task: alice });
    actions.callTaskEditOptions.mockResolvedValue({ timezone: 'America/Toronto', dueAt: '2026-11-15T09:00', members: [] });
    actions.scheduleCallbackAction.mockResolvedValue({ error: null });
    render(<Dialer queue={[alice]} outcomes={[]} mayManageTasks />);
    await user.click(await within(workspace()).findByRole('button', { name: 'Schedule callback' }));
    const dialog = await screen.findByRole('dialog', { name: 'Schedule a callback for Alice' });
    expect(within(dialog).queryByLabelText(/Reason for calling/)).not.toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByLabelText(/Call back/)).toHaveValue('2026-11-15T09:00'));
    fireEvent.change(within(dialog).getByLabelText(/Call back/), { target: { value: '2026-11-18T14:30' } });
    await user.click(within(dialog).getByRole('button', { name: 'Schedule callback' }));
    await waitFor(() => expect(actions.scheduleCallbackAction).toHaveBeenCalledWith('tenant', 'call', '2026-11-18T14:30', undefined));
    expect(toast.success).toHaveBeenCalledWith('Callback scheduled for Alice.');
    expect(actions.completeCallTaskAction).not.toHaveBeenCalled();
  });

  it('asks for the reason when the contact has no open call task, and never invents one', async () => {
    const user = userEvent.setup();
    telephone.value = { ...telephone.value, ended: endedCall };
    callContext.mockResolvedValue({ callId: 'call', contact: alice.customer, recentCalls: [], task: null });
    actions.callTaskEditOptions.mockResolvedValue({ timezone: 'America/Toronto', dueAt: '2026-11-15T09:00', members: [] });
    actions.scheduleCallbackAction.mockResolvedValue({ error: null });
    render(<Dialer queue={[bob]} outcomes={[]} mayManageTasks />);
    await user.click(await within(workspace()).findByRole('button', { name: 'Schedule callback' }));
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Schedule callback' });
    await waitFor(() => expect(within(dialog).getByLabelText(/Call back/)).toHaveValue('2026-11-15T09:00'));
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Reason for calling/), 'Asked to be rung after lunch');
    await user.click(submit);
    await waitFor(() => expect(actions.scheduleCallbackAction).toHaveBeenCalledWith('tenant', 'call', '2026-11-15T09:00', 'Asked to be rung after lunch'));
    // There was no open call task to complete for them.
    expect(within(workspace()).queryByRole('button', { name: 'Complete call task' })).not.toBeInTheDocument();
  });

  it('keeps the dialog open with the reason when the server refuses the callback', async () => {
    const user = userEvent.setup();
    telephone.value = { ...telephone.value, ended: endedCall };
    callContext.mockResolvedValue({ callId: 'call', contact: alice.customer, recentCalls: [], task: alice });
    actions.callTaskEditOptions.mockResolvedValue({ timezone: 'America/Toronto', dueAt: '2026-11-15T09:00', members: [] });
    actions.scheduleCallbackAction.mockResolvedValue({ error: 'Your role cannot manage tasks.' });
    render(<Dialer queue={[alice]} outcomes={[]} mayManageTasks />);
    await user.click(await within(workspace()).findByRole('button', { name: 'Schedule callback' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByLabelText(/Call back/)).toHaveValue('2026-11-15T09:00'));
    await user.click(within(dialog).getByRole('button', { name: 'Schedule callback' }));
    expect(await within(dialog).findByText('Your role cannot manage tasks.')).toBeVisible();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe('changing a call on the list', () => {
  it('reschedules the entry’s own task in the business’s timezone', async () => {
    const user = userEvent.setup();
    actions.rescheduleCallTaskAction.mockResolvedValue({ error: null });
    render(<Dialer queue={[alice, bob]} mayManageTasks />);
    await menu(user, 'Bob', 'Reschedule');
    const dialog = await screen.findByRole('dialog', { name: 'Reschedule the call to Bob' });
    // 12:00 UTC on 17 October is 08:00 in Toronto.
    expect(within(dialog).getByLabelText(/Due/)).toHaveValue('2026-10-17T08:00');
    expect(dialog).toHaveTextContent('America/Toronto');
    fireEvent.change(within(dialog).getByLabelText(/Due/), { target: { value: '2026-10-20T09:30' } });
    await user.click(within(dialog).getByRole('button', { name: 'Reschedule' }));
    await waitFor(() => expect(actions.rescheduleCallTaskAction).toHaveBeenCalledWith('tenant', 'bob', '2026-10-20T09:30'));
    expect(toast.success).toHaveBeenCalledWith('Rescheduled the call to Bob.');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // The list is read again from the server rather than patched here.
    expect(refresh).toHaveBeenCalled();
    expect(actions.loadCallListAction).toHaveBeenCalled();
  });

  it('reassigns the entry to a member, or to nobody', async () => {
    const user = userEvent.setup();
    actions.callTaskEditOptions.mockResolvedValue({ timezone: 'America/Toronto', dueAt: '2026-11-15T09:00', members: [{ id: 'sam', name: 'Sam' }, { id: 'ola', name: 'Ola' }] });
    actions.reassignCallTaskAction.mockResolvedValue({ error: null });
    render(<Dialer queue={[alice]} mayManageTasks />);
    await menu(user, 'Alice', 'Reassign');
    const dialog = await screen.findByRole('dialog', { name: 'Reassign the call to Alice' });
    await chooseOption(await within(dialog).findByLabelText('Owner'), 'ola');
    await user.click(within(dialog).getByRole('button', { name: 'Reassign' }));
    await waitFor(() => expect(actions.reassignCallTaskAction).toHaveBeenCalledWith('tenant', 'alice', 'ola'));
    expect(toast.success).toHaveBeenCalledWith('Reassigned the call to Alice.');
  });

  it('links to the contact and the task only for a member who may view contacts', async () => {
    const user = userEvent.setup();
    const app = render(<Dialer queue={[alice]} mayViewContacts />);
    await user.click(screen.getByRole('button', { name: 'Actions for Alice' }));
    expect(await screen.findByRole('menuitem', { name: 'Open contact' })).toHaveAttribute('href', '/organizations/tenant/crm/contacts/alice');
    expect(screen.getByRole('menuitem', { name: 'Task details' })).toHaveAttribute('href', '/organizations/tenant/crm/tasks?status=open&kind=call&selected=alice');
    await user.keyboard('{Escape}');
    app.unmount();
    render(<Dialer queue={[alice]} mayViewContacts={false} />);
    await user.click(screen.getByRole('button', { name: 'Actions for Alice' }));
    await screen.findByRole('menuitem', { name: 'Skip for this session' });
    expect(screen.queryByRole('menuitem', { name: 'Open contact' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Task details' })).not.toBeInTheDocument();
  });
});

describe('a selection that has gone stale', () => {
  it('stops preparing an entry someone else completed or removed, and says who', async () => {
    actions.callListEntryAction.mockResolvedValue({ error: null, entry: null, recentCalls: [] });
    actions.loadCallListAction.mockResolvedValue(page([bob], {}, null));
    render(<Dialer queue={[alice, bob]} />);
    expect(await screen.findByText('Alice is no longer on the call list.')).toBeVisible();
    await waitFor(() => expect(workspace()).toHaveAttribute('data-state', 'idle'));
    await waitFor(() => expect(rows('Alice')).toHaveLength(0));
    expect(dial).not.toHaveBeenCalled();
  });

  it('takes the entry’s current details when the route reads the page again', () => {
    const app = render(<Dialer queue={[alice, bob]} />);
    expect(within(workspace()).getByText('(416)555-0101')).toBeVisible();
    // Someone corrected Alice's number and rescheduled Bob away meanwhile.
    const moved = { ...alice, customer: { ...alice.customer, phone: '+14165550177' } };
    app.rerender(<Dialer queue={[moved]} />);
    expect(within(workspace()).getByText('(416)555-0177')).toBeVisible();
    expect(rows('Bob')).toHaveLength(0);
  });

  it('clears the selection when the route’s whole list no longer holds it, leaving a live call alone', () => {
    telephone.value = { ...telephone.value, status: 'ready', activeCall: { status: 'in_progress', direction: 'outgoing', muted: false, startedAt: Date.now(), callId: 'call', contactLabel: 'Alice', customerId: 'alice' } };
    const app = render(<Dialer queue={[alice]} />);
    app.rerender(<Dialer queue={[]} queueCounts={counts()} />);
    expect(screen.getByText('Alice is no longer on the call list.')).toBeVisible();
    expect(screen.getByTestId('live-call')).toBeInTheDocument();
    expect(telephone.value.unregister).not.toHaveBeenCalled();
  });
});
