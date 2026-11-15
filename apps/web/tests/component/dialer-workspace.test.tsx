// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DialerWorkspace } from '@/features/communications/voice/dialer-workspace';
import { DialerPopoutContext } from '@/features/communications/voice/dialer-popout-context';
import type { CallingOptions, OutboundLine } from '@/lib/application/communications/calling-options';
import type { DialerQueueEntry } from '@/lib/application/communications/dialer-queue';
import { chooseOption, fieldValue, optionLabels, optionValues } from '../support/select-field';
import userEvent from '@testing-library/user-event';

const removal = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/app/organizations/[organizationId]/calls/call-list-actions', () => ({ removeFromCallListAction: removal }));
vi.mock('next/navigation', async (original) => ({ ...(await original<typeof import('next/navigation')>()), useRouter: () => ({ refresh }) }));
vi.mock('sonner', () => ({ toast }));

const dial = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const lookup = vi.hoisted(() => vi.fn());
const endedRecord = vi.hoisted(() => vi.fn());
const callContext = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock('@/app/organizations/[organizationId]/calls/actions', () => ({ matchDialerContact: lookup, endedCallRecord: endedRecord, callContactContext: callContext }));
vi.mock('@/features/communications/voice/wrap-up-sheet', () => ({ WrapUpCallSheet: () => <button type="button">Wrap up call</button> }));
const telephone = vi.hoisted(() => ({ value: { activeCall: null as unknown, incoming: null as unknown, ended: null as unknown, dismissEnded: vi.fn(), status: 'offline', error: null, register: vi.fn(), unregister: vi.fn() } }));
vi.mock('@/features/communications/voice/use-dial', () => ({ useDial: () => ({ dial, dialing: false, error: null }) }));
vi.mock('@/features/communications/voice/telephone-device', () => ({ useTelephoneDevice: () => telephone.value }));
vi.mock('@/features/communications/voice/add-to-call-list', () => ({ AddToCallList: () => <button type="button">Add to list</button> }));
vi.mock('@/features/communications/voice/active-call-dock', () => ({ ActiveCallDock: ({ placement, contactName }: { placement: string; contactName?: string | null }) => <div data-testid="live-call" data-contact={contactName ?? ''}>Live call controls ({placement})</div> }));
const entry = (id: string, name: string, phone: string | null, customerId = id): DialerQueueEntry => ({
  task: { id, customerId, customerName: name, title: `Call ${name}`, notes: `Recorded notes for ${name}`, dueAt: '2026-10-17T12:00:00Z', kind: 'call', status: 'open', opportunityId: null, opportunityTitle: null, ownerMembershipId: null, ownerName: null, completedAt: null, createdAt: '2026-10-16T12:00:00Z' },
  customer: { id: customerId, name, phone, email: null },
  recentCalls: [],
});
const office: OutboundLine = { id: 'office', e164: '+14165550100', label: 'Office', source: 'member_default', group: 'assigned' };
const options: CallingOptions = { numbers: [office], defaultNumber: office, unavailableReason: null, blocker: null };
const blocked = (kind: 'restricted' | 'not-configured' | 'unavailable', reason: string, setup: 'phone-numbers' | null = null): CallingOptions => ({ numbers: [], defaultNumber: null, unavailableReason: reason, blocker: { kind, code: kind === 'restricted' ? 'no-permission' : kind === 'not-configured' ? 'no-eligible-number' : 'service-unavailable', reason, setup } });
const numbersDoor = { href: '/organizations/tenant/comms/configuration/numbers', label: 'Numbers & assignments' };
const common = { organizationId: 'tenant', timezone: 'America/Toronto', queueTotal: 2, queueAvailable: true, options };
afterEach(() => { cleanup(); vi.clearAllMocks(); callContext.mockReset().mockResolvedValue(null); endedRecord.mockReset(); dial.mockReset().mockResolvedValue(true); telephone.value = { ...telephone.value, activeCall: null, incoming: null, ended: null, status: 'offline' }; });
/** The calling workspace: the one region whose content follows the call state. */
const workspace = () => screen.getByRole('region', { name: 'Calling console' });
const liveCall = (over: Record<string, unknown> = {}) => ({ status: 'in_progress', direction: 'outgoing', muted: false, startedAt: Date.now(), callId: 'call', contactLabel: 'Alice', ...over });

describe('dialer workspace', () => {
  it('shows a unique typed-number contact and clears that attribution for an ambiguous replacement', async () => {
    lookup.mockResolvedValueOnce({ state: 'matched', contact: { id: 'matched', name: 'Matched contact', phone: '+14165550122', email: null } }).mockResolvedValueOnce({ state: 'ambiguous' });
    render(<DialerWorkspace {...common} queue={[]} queueTotal={0} mayMatchContacts />);
    fireEvent.change(screen.getByLabelText('Number to call'), { target: { value: '+14165550122' } });
    expect(await screen.findByRole('link', { name: 'Matched contact' })).toBeInTheDocument();
    expect(within(workspace()).getByRole('heading', { name: 'Matched contact', level: 2 })).toBeVisible();
    expect(workspace()).toHaveAttribute('data-state', 'manual');
    fireEvent.click(screen.getByRole('button', { name: 'Call' }));
    expect(dial).toHaveBeenLastCalledWith(expect.objectContaining({ toNumber: '+14165550122', customerId: 'matched', contactLabel: 'Matched contact' }));
    fireEvent.change(screen.getByLabelText('Number to call'), { target: { value: '+14165550123' } });
    expect(screen.queryByRole('link', { name: 'Matched contact' })).not.toBeInTheDocument();
    expect(within(workspace()).getByRole('heading', { name: 'New call', level: 2 })).toBeVisible();
    expect(await screen.findByText('Several contacts use this number. No contact is selected.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Call' }));
    expect(dial).toHaveBeenLastCalledWith(expect.objectContaining({ toNumber: '+14165550123', customerId: undefined }));
  });
  it('selects a real follow-up, shows its context and binds the call to that customer', async () => {
    render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101'), entry('bob', 'Bob', '+14165550102')]} />);
    expect(workspace()).toHaveAttribute('data-state', 'contact');
    expect(within(workspace()).getByText('(416)555-0101')).toBeVisible();
    // The contact's number is shown, not offered for editing, and the keypad stays away.
    expect(screen.queryByLabelText('Number to call')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Dial pad' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Bob/ }));
    expect(within(workspace()).getByText('(416)555-0102')).toBeVisible();
    expect(within(workspace()).queryByText('(416)555-0101')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bob', level: 2 })).toBeVisible();
    expect(within(workspace()).getByText('Call Bob')).toBeVisible();
    expect(screen.getByText('Recorded notes for Bob')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Call' }));
    await waitFor(() => expect(dial).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'bob', toNumber: '+14165550102', contactLabel: 'Bob' })));
    expect(screen.getByRole('link', { name: 'Bob' })).toHaveAttribute('href', '/organizations/tenant/crm/contacts/bob');
  });
  it('clears customer attribution when dialing another number', async () => {
    render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101')]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dial another number' }));
    expect(workspace()).toHaveAttribute('data-state', 'manual');
    expect(screen.getByLabelText('Number to call')).toHaveValue('');
    expect(screen.getByRole('button', { name: /Alice/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('region', { name: 'Call task' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Number to call'), { target: { value: '+14165550199' } });
    fireEvent.click(screen.getByRole('button', { name: 'Call' }));
    await waitFor(() => expect(dial).toHaveBeenCalledWith(expect.objectContaining({ customerId: undefined, contactLabel: '+14165550199' })));
  });
  it('shows missing phone numbers and does not invent a callable customer', () => {
    render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', null)]} />);
    expect(screen.getAllByText('No phone number is recorded for this contact.')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Call' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Call' })).toHaveAccessibleDescription('No phone number is recorded for this contact.');
    expect(within(screen.getByRole('region', { name: 'Contact' })).getByText('Alice')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Dial another number' })).toBeEnabled();
  });
  it('still says a contact has no phone number when calling is blocked for another reason', () => {
    render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', null)]} options={blocked('unavailable', 'Calling is temporarily unavailable.')} />);
    expect(screen.getAllByText('No phone number is recorded for this contact.')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Call' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Call' })).toHaveAccessibleDescription('Calling is temporarily unavailable.');
  });
  it('keeps every region of the console when the business has nothing recorded and cannot call yet', () => {
    render(<DialerWorkspace {...common} queue={[]} queueTotal={0} options={blocked('not-configured', 'No ready outbound number is assigned.', 'phone-numbers')} setup={numbersDoor} />);
    expect(screen.getByRole('region', { name: 'Call list' })).toHaveTextContent(/No contacts on the call list/);
    expect(screen.queryByRole('link', { name: 'All call tasks' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Contacts' })).toHaveAttribute('href', '/organizations/tenant/crm/contacts');
    expect(screen.getByRole('region', { name: 'Contact' })).toHaveTextContent(/Select a contact from the call list/);
    const readiness = screen.getByRole('region', { name: 'Calling readiness' });
    expect(within(readiness).getAllByText('No ready outbound number is assigned.')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Call' })).toHaveAccessibleDescription('No ready outbound number is assigned.');
    expect(screen.queryByRole('region', { name: 'Call task' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Needs wrap-up' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(within(readiness).getByRole('status')).toHaveTextContent('No ready outbound number is assigned.');
    expect(within(readiness).getByRole('link', { name: 'Numbers & assignments' })).toHaveAttribute('href', '/organizations/tenant/comms/configuration/numbers');
    // The keypad is there on request, not permanently.
    expect(screen.queryByRole('group', { name: 'Dial pad' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keypad' }));
    expect(screen.getByRole('group', { name: 'Dial pad' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Dial 4' }));
    expect(screen.getByLabelText('Number to call')).toHaveValue('4');
    fireEvent.click(screen.getByRole('button', { name: 'Keypad' }));
    expect(screen.queryByRole('group', { name: 'Dial pad' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Number to call')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Call' })).toBeDisabled();
  });
  it.each([
    ['restricted', 'Your role cannot place calls.'],
    ['unavailable', 'Calling isn’t ready yet.'],
  ] as const)('words a %s blocker as its own state, with no setup link', (kind, reason) => {
    render(<DialerWorkspace {...common} queue={[]} queueTotal={0} options={blocked(kind, reason)} setup={{ href: '/never', label: 'Never' }} />);
    const readiness = screen.getByRole('region', { name: 'Calling readiness' });
    expect(within(readiness).getAllByText(reason)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Call' })).toHaveAccessibleDescription(reason);
    expect(within(readiness).getByRole('status')).toHaveAttribute('data-state', kind);
    expect(within(readiness).queryByRole('link')).not.toBeInTheDocument();
  });
  it('offers Add to list in the empty list and in the list header, only to members who may manage tasks', () => {
    const app = render(<DialerWorkspace {...common} queue={[]} queueTotal={0} mayAddToList />);
    expect(within(screen.getByRole('region', { name: 'Call list' })).getByRole('button', { name: 'Add to list' })).toBeVisible();
    app.rerender(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101')]} mayAddToList />);
    expect(within(screen.getByRole('region', { name: 'Call list' })).getAllByRole('button', { name: 'Add to list' })).toHaveLength(1);
    app.rerender(<DialerWorkspace {...common} queue={[]} queueTotal={0} />);
    expect(screen.queryByRole('button', { name: 'Add to list' })).not.toBeInTheDocument();
    app.rerender(<DialerWorkspace {...common} queue={[]} queueAvailable={false} mayAddToList />);
    expect(screen.queryByRole('button', { name: 'Add to list' })).not.toBeInTheDocument();
  });
  it('states the bounded call list and an unavailable call list', () => {
    const app = render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', null)]} queueTotal={45} />);
    expect(screen.getByText(/Showing the first 1 of 45/)).toBeVisible();
    app.rerender(<DialerWorkspace {...common} queue={[]} queueAvailable={false} />);
    expect(screen.getByText(/Tasks are not included for this business, so there is no call list/)).toBeVisible();
    expect(screen.queryByRole('link', { name: 'All call tasks' })).not.toBeInTheDocument();
  });
});

describe('dialer console presentation', () => {
  it('opens in Standard with every region, and Focus keeps only the calling console until Standard is chosen again', () => {
    const { container } = render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101')]} />);
    const root = container.firstElementChild!;
    expect(root).toHaveAttribute('data-presentation', 'standard');
    expect(screen.getByRole('button', { name: 'Standard' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Call list panel' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Context panel' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
    expect(screen.getByRole('button', { name: 'Focus' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Call list panel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Context panel' })).toBeDisabled();
    expect(within(workspace()).getByText('(416)555-0101')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Call' })).toBeEnabled();
    expect(root).toHaveAttribute('data-presentation', 'focus');
    fireEvent.click(screen.getByRole('button', { name: 'Standard' }));
    expect(screen.getByRole('button', { name: 'Call list panel' })).toBeEnabled();
  });
  it('selecting a queue row fills the number without dialing', () => {
    render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101'), entry('bob', 'Bob', '+14165550102')]} />);
    fireEvent.click(screen.getByRole('button', { name: /Bob/ }));
    expect(within(workspace()).getByText('(416)555-0102')).toBeVisible();
    expect(screen.getByRole('button', { name: /Bob/ })).toHaveAttribute('aria-pressed', 'true');
    expect(dial).not.toHaveBeenCalled();
  });
  it('searches only the calls loaded and says so when that is not the whole list', () => {
    render(<DialerWorkspace {...common} queueTotal={30} queue={[entry('alice', 'Alice', '+14165550101'), entry('bob', 'Bob', '+14165550102')]} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search call list' }), { target: { value: 'bob' } });
    expect(screen.queryByRole('button', { name: /Alice/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bob/ })).toBeVisible();
    expect(screen.getAllByText('Showing the first 2 of 30 calls, earliest due first. Search covers these only.')).toHaveLength(1);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search call list' }), { target: { value: 'nobody' } });
    expect(screen.getByText('No calls match.')).toBeVisible();
  });
  it('dials a number handed over by a link, with no one in the call list selected', async () => {
    render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101')]} prefill="+14165550199" />);
    expect(screen.getByLabelText('Number to call')).toHaveValue('(416)555-0199');
    expect(screen.getByRole('heading', { name: 'New call' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Alice/ })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Call' }));
    await waitFor(() => expect(dial).toHaveBeenCalledWith(expect.objectContaining({ toNumber: '+14165550199', customerId: undefined })));
  });
  it('choosing someone after a link handed over a number calls their number, never the handed-over one', async () => {
    render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101'), entry('carol', 'Carol', null)]} prefill="+14165550199" />);
    fireEvent.click(screen.getByRole('button', { name: /Carol/ }));
    expect(within(workspace()).queryByText('(416)555-0199')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Call' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Alice/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Call' }));
    await waitFor(() => expect(dial).toHaveBeenCalledWith(expect.objectContaining({ toNumber: '+14165550101', customerId: 'alice' })));
  });
  it('offers one control that places a call, in the calling workspace', () => {
    render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101')]} />);
    const call = screen.getByRole('button', { name: 'Call' });
    expect(workspace()).toContainElement(call);
    expect(call).toHaveAttribute('type', 'submit');
    expect(call).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Start calling' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Call list' })).queryByRole('button', { name: /^(Call|Start calling)$/ })).not.toBeInTheDocument();
  });
  it('shows the chosen contact’s recorded calls, and gives the reason for the call once outside the list', () => {
    render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101')]} recentCalls={{ alice: <p>Recorded call with Alice</p> }} />);
    const context = screen.getByRole('region', { name: 'Contact' });
    expect(within(context).getByText('Recorded call with Alice')).toBeVisible();
    expect(screen.queryByText('Other call tasks')).not.toBeInTheDocument();
    // The reason for the call is in the list entry and with the contact in the workspace, nowhere else.
    expect(within(workspace()).getAllByText('Call Alice')).toHaveLength(1);
    expect(within(context).queryByText('Call Alice')).not.toBeInTheDocument();
    const task = screen.getByRole('region', { name: 'Call task' });
    expect(within(task).queryByText('Call Alice')).not.toBeInTheDocument();
    expect(within(task).getByText('Recorded notes for Alice')).toBeVisible();
  });
  it('carries the current draft into the pop-out and takes it back on return', () => {
    const open = vi.fn();
    const value = { container: null, error: null, open, close: vi.fn(), updateDraft: vi.fn(), inlineHost: true, setInlineHost: vi.fn() };
    render(<DialerPopoutContext.Provider value={value}><DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101')]} /></DialerPopoutContext.Provider>);
    expect(screen.getAllByRole('button', { name: 'Pop out dialer' })).toHaveLength(1);
    expect(within(screen.getByRole('group', { name: 'Presentation' })).queryByRole('button', { name: /Pop/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pop out dialer' }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ toNumber: '+14165550101', customerId: 'alice', customerName: 'Alice', numbers: options.numbers }));
  });
  it('shows the separate window state while popped out, and Standard brings the dialer back', () => {
    const close = vi.fn();
    const value = { container: document.createElement('div'), error: null, open: vi.fn(), close, updateDraft: vi.fn(), inlineHost: true, setInlineHost: vi.fn() };
    render(<DialerPopoutContext.Provider value={value}><DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101')]} /></DialerPopoutContext.Provider>);
    expect(screen.getByRole('button', { name: 'Show dialer window' })).not.toHaveAttribute('aria-pressed');
    expect(screen.getByRole('button', { name: 'Standard' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('The dialer is open in a separate window.')).toBeVisible();
    expect(screen.queryByLabelText('Number to call')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Standard' }));
    expect(close).toHaveBeenCalled();
  });
  it('gives a live call the console in place of the dialing form', () => {
    telephone.value = { ...telephone.value, status: 'ready', activeCall: { status: 'in_progress', direction: 'outgoing', muted: false, startedAt: Date.now(), callId: 'call', contactLabel: 'Alice' } };
    render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101')]} />);
    expect(screen.getByTestId('live-call')).toHaveTextContent('console');
    expect(workspace()).toHaveAttribute('data-state', 'live');
    expect(screen.queryByLabelText('Number to call')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Call' })).not.toBeInTheDocument();
    const readiness = screen.getByRole('region', { name: 'Calling readiness' });
    expect(within(readiness).getByText('Connected')).toBeVisible();
    // Stopping would close the telephone the call is on.
    expect(within(readiness).getByRole('button', { name: 'Stop receiving calls' })).toBeDisabled();
  });
});

describe('the calling workspace follows the call', () => {
  const queue = [entry('alice', 'Alice', '+14165550101'), entry('bob', 'Bob', '+14165550102')];
  it('is manual dialing with nobody chosen and the contact with someone chosen', () => {
    const app = render(<DialerWorkspace {...common} queue={[]} queueTotal={0} />);
    expect(workspace()).toHaveAttribute('data-state', 'manual');
    expect(screen.getByLabelText('Number to call')).toBeVisible();
    expect(screen.getByLabelText('Call from')).toBeVisible();
    app.unmount();
    render(<DialerWorkspace {...common} queue={queue} />);
    expect(workspace()).toHaveAttribute('data-state', 'contact');
    expect(screen.getByRole('heading', { name: 'Alice', level: 2 })).toBeVisible();
    expect(screen.getByLabelText('Call from')).toBeVisible();
  });
  it('states the outbound line once, in the call form', () => {
    render(<DialerWorkspace {...common} queue={queue} />);
    // Automatic names the number it resolves to, and says once why that one.
    expect(screen.getByLabelText('Call from')).toHaveTextContent('Automatic · Office · (416)555-0100');
    expect(screen.getByLabelText('Call from')).toHaveAccessibleDescription('Your default number');
    expect(screen.queryByText(/Calling from/)).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Call list' })).not.toHaveTextContent('Office');
    expect(screen.getByRole('region', { name: 'Contact' })).not.toHaveTextContent('Office');
    expect(screen.getByRole('region', { name: 'Calling readiness' })).not.toHaveTextContent('Office');
  });
  it('shows an incoming call in place of whatever was being prepared', () => {
    telephone.value = { ...telephone.value, incoming: { accept: vi.fn(), reject: vi.fn() } };
    render(<DialerWorkspace {...common} queue={queue} />);
    expect(workspace()).toHaveAttribute('data-state', 'incoming');
    expect(screen.getByTestId('live-call')).toHaveTextContent('console');
    expect(screen.queryByRole('button', { name: 'Call' })).not.toBeInTheDocument();
    // Nobody is known to be calling yet, so the highlighted entry is not presented as the caller.
    expect(screen.queryByRole('region', { name: 'Call task' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Contact' })).queryByText('Alice')).not.toBeInTheDocument();
  });
  it('keeps a live call’s own contact when a different list entry is highlighted', () => {
    telephone.value = { ...telephone.value, status: 'ready', activeCall: liveCall({ contactLabel: 'Bob', customerId: 'bob' }) };
    render(<DialerWorkspace {...common} queue={queue} />);
    // Alice is the highlighted entry; the call is with Bob.
    const context = screen.getByRole('region', { name: 'Contact' });
    expect(within(context).getByRole('link', { name: 'Bob' })).toHaveAttribute('href', '/organizations/tenant/crm/contacts/bob');
    expect(within(context).queryByText('Alice')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Call task' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Bob/ }));
    const task = screen.getByRole('region', { name: 'Call task' });
    expect(within(task).getByText('Call Bob')).toBeVisible();
    expect(within(task).getByText('Recorded notes for Bob')).toBeVisible();
    expect(screen.getByTestId('live-call')).toBeInTheDocument();
  });
  it('shows no contact for a call that is linked to nobody', () => {
    telephone.value = { ...telephone.value, status: 'ready', activeCall: liveCall({ contactLabel: '+14165550777', customerId: null }) };
    render(<DialerWorkspace {...common} queue={queue} />);
    expect(screen.getByRole('region', { name: 'Contact' })).toHaveTextContent('No contact is linked to this call.');
    expect(screen.getByRole('button', { name: 'Context panel' })).toBeDisabled();
    expect(screen.queryByRole('region', { name: 'Call task' })).not.toBeInTheDocument();
  });
  it('after a call, offers wrap-up once the call is recorded as completed, the call record, and a way on', async () => {
    endedRecord.mockResolvedValueOnce({ id: 'call', status: 'in_progress', note: '', outcome: null, ringSeconds: null, talkSeconds: null }).mockResolvedValue({ id: 'call', status: 'completed', note: '', outcome: null, ringSeconds: 14, talkSeconds: 131 });
    telephone.value = { ...telephone.value, ended: { callId: 'call', contactLabel: 'Bob', customerId: 'bob', direction: 'outgoing', ringSeconds: 12, durationSeconds: 137 } };
    render(<DialerWorkspace {...common} queue={queue} outcomes={[]} />);
    expect(workspace()).toHaveAttribute('data-state', 'ended');
    expect(within(workspace()).getByText('Call ended')).toBeVisible();
    expect(within(workspace()).getByRole('heading', { name: 'Bob', level: 2 })).toBeVisible();
    // Ringing and talking are two figures, never one sum; until the call is recorded they are this telephone's own.
    expect(workspace()).toHaveTextContent('Outgoing · Talk time 2:17 · Rang 0:12');
    expect(within(workspace()).getByRole('link', { name: 'Open call record' })).toHaveAttribute('href', '/organizations/tenant/calls/call');
    // The page's own figures are brought up to date; the call is not offered for wrap-up on a guess.
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(endedRecord).toHaveBeenCalledWith('tenant', 'call'));
    expect(screen.queryByRole('button', { name: 'Wrap up call' })).not.toBeInTheDocument();
    // The carrier's report arrives a moment later; the record is read again until it does.
    expect(await within(workspace()).findByRole('button', { name: 'Wrap up call' }, { timeout: 5000 })).toBeVisible();
    expect(endedRecord).toHaveBeenCalledTimes(2);
    // Once recorded, the carrier's own times replace the telephone's, and the waiting line is gone.
    expect(workspace()).toHaveTextContent('Outgoing · Talk time 2:11 · Rang 0:14');
    expect(within(workspace()).queryByRole('status')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Contact' })).getByRole('link', { name: 'Bob' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Call' })).not.toBeInTheDocument();
    fireEvent.click(within(workspace()).getByRole('button', { name: 'Done' }));
    expect(telephone.value.dismissEnded).toHaveBeenCalledTimes(1);
  }, 10_000);
  it('after a call, does not offer wrap-up to someone who may not wrap up calls, and choosing an entry moves on', async () => {
    endedRecord.mockResolvedValue({ id: 'call', status: 'completed', note: '', outcome: null, ringSeconds: 3, talkSeconds: 40 });
    telephone.value = { ...telephone.value, ended: { callId: 'call', contactLabel: '+14165550777', customerId: null, direction: 'incoming', ringSeconds: 3, durationSeconds: null } };
    render(<DialerWorkspace {...common} queue={queue} />);
    await waitFor(() => expect(endedRecord).toHaveBeenCalled());
    expect(workspace()).toHaveTextContent('Incoming');
    expect(screen.queryByRole('button', { name: /Wrap up/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Bob/ }));
    expect(telephone.value.dismissEnded).toHaveBeenCalledTimes(1);
  });
});


describe('after a call the operator is not left waiting on the carrier', () => {
  const queue = [entry('alice', 'Alice', '+14165550101'), entry('bob', 'Bob', '+14165550102')];
  const unsettled = { id: 'call', status: 'in_progress', note: '', outcome: null, ringSeconds: null, talkSeconds: null };
  const ended = { callId: 'call', contactLabel: 'Bob', customerId: 'bob', direction: 'outgoing', ringSeconds: 9, durationSeconds: 60 };

  it('says it is waiting, lets the operator check again or move on, and offers wrap-up when the call is recorded', async () => {
    endedRecord.mockResolvedValue(unsettled);
    telephone.value = { ...telephone.value, ended };
    render(<DialerWorkspace {...common} queue={queue} outcomes={[]} />);
    const waiting = await within(workspace()).findByRole('status');
    expect(waiting).toHaveTextContent('Waiting for the carrier to confirm this call has ended. Wrap-up opens once it does.');
    expect(screen.queryByRole('button', { name: 'Wrap up call' })).not.toBeInTheDocument();
    // Moving on is never blocked by the wait.
    expect(within(workspace()).getByRole('button', { name: 'Done' })).toBeEnabled();
    expect(within(workspace()).getByRole('link', { name: 'Open call record' })).toBeVisible();

    const reads = endedRecord.mock.calls.length;
    fireEvent.click(within(waiting).getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(endedRecord.mock.calls.length).toBeGreaterThan(reads));
    expect(screen.queryByRole('button', { name: 'Wrap up call' })).not.toBeInTheDocument();

    // The carrier's late report arrives; asking again finds it.
    endedRecord.mockResolvedValue({ ...unsettled, status: 'completed', ringSeconds: 9, talkSeconds: 62 });
    fireEvent.click(within(workspace()).getByRole('button', { name: 'Check again' }));
    expect(await within(workspace()).findByRole('button', { name: 'Wrap up call' })).toBeVisible();
    expect(within(workspace()).queryByRole('status')).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it('stops its timed checks after a few minutes, then checks only when asked or when the operator returns to the tab', async () => {
    vi.useFakeTimers();
    try {
      endedRecord.mockResolvedValue(unsettled);
      telephone.value = { ...telephone.value, ended };
      render(<DialerWorkspace {...common} queue={queue} outcomes={[]} />);
      // Six quick reads, six slower, eight slow: about five minutes, and one first read.
      await act(async () => { await vi.advanceTimersByTimeAsync(6 * 2_500 + 6 * 10_000 + 8 * 30_000 + 1_000); });
      expect(endedRecord).toHaveBeenCalledTimes(21);
      expect(within(workspace()).getByRole('status')).toHaveAttribute('data-state', 'paused');
      // Nothing more is asked of the server while the operator is away, however long that is.
      await act(async () => { await vi.advanceTimersByTimeAsync(60 * 60_000); });
      expect(endedRecord).toHaveBeenCalledTimes(21);
      // Returning to the tab is one more read, not a new round of timed ones.
      await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(0); });
      expect(endedRecord).toHaveBeenCalledTimes(22);
      await act(async () => { await vi.advanceTimersByTimeAsync(60 * 60_000); });
      expect(endedRecord).toHaveBeenCalledTimes(22);
    } finally { vi.useRealTimers(); }
  });

  it('names a call nobody answered by its recorded status, with how long it rang and no talk time or wrap-up', async () => {
    endedRecord.mockResolvedValue({ id: 'call', status: 'no_answer', note: '', outcome: null, ringSeconds: 20, talkSeconds: null });
    telephone.value = { ...telephone.value, ended: { ...ended, ringSeconds: 19, durationSeconds: null } };
    render(<DialerWorkspace {...common} queue={queue} outcomes={[]} />);
    await waitFor(() => expect(workspace()).toHaveTextContent('Outgoing · No answer · Rang 0:20'));
    expect(workspace()).not.toHaveTextContent('Talk time');
    expect(screen.queryByRole('button', { name: 'Wrap up call' })).not.toBeInTheDocument();
    expect(within(workspace()).queryByRole('status')).not.toBeInTheDocument();
  });

  it('says only that it is waiting to someone who may not wrap up calls', async () => {
    endedRecord.mockResolvedValue(unsettled);
    telephone.value = { ...telephone.value, ended };
    render(<DialerWorkspace {...common} queue={queue} />);
    expect(await within(workspace()).findByRole('status')).toHaveTextContent(/^Waiting for the carrier to confirm this call has ended\.Check again$/);
  });
});

describe('a call shows its own contact, whoever is on the loaded call list', () => {
  const queue = [entry('alice', 'Alice', '+14165550101')];
  const zed = { id: 'zed', name: 'Zed Okafor', phone: '+14165550900', email: 'zed@example.test', archived: false, contactType: 'person' as const, companyId: 'northwind', companyName: 'Northwind Supply', title: 'Purchasing lead' };
  const recent = [{ id: 'earlier', inbound: true, status: 'Completed', tone: 'success' as const, detail: '3 Nov, 14:02 · 2m 05s' }];

  it('reads the contact from the call, not from the list, during a call', async () => {
    callContext.mockResolvedValue({ callId: 'call', contact: zed, recentCalls: recent });
    telephone.value = { ...telephone.value, status: 'ready', activeCall: liveCall({ contactLabel: '+14165550900', customerId: 'zed' }) };
    render(<DialerWorkspace {...common} queue={queue} />);
    const context = screen.getByRole('region', { name: 'Contact' });
    expect(await within(context).findByRole('link', { name: 'Zed Okafor' })).toHaveAttribute('href', '/organizations/tenant/crm/contacts/zed');
    expect(callContext).toHaveBeenCalledWith('tenant', 'call');
    // The live call is named by its contact, not left as the number that was dialed.
    expect(screen.getByTestId('live-call')).toHaveAttribute('data-contact', 'Zed Okafor');
    expect(within(context).getByText('Purchasing lead')).toBeVisible();
    expect(within(context).getByRole('link', { name: 'Northwind Supply' })).toHaveAttribute('href', '/organizations/tenant/crm/contacts/northwind');
    expect(within(context).getByRole('link', { name: /Inbound call/ })).toHaveAttribute('href', '/organizations/tenant/calls/earlier');
    expect(within(context).queryByText('Alice')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Context panel' })).toBeEnabled();
  });

  it('keeps that contact after the call ends, and names the ended call by them', async () => {
    callContext.mockResolvedValue({ callId: 'call', contact: zed, recentCalls: [] });
    endedRecord.mockResolvedValue({ id: 'call', status: 'completed', note: '', outcome: null, ringSeconds: 5, talkSeconds: 30 });
    telephone.value = { ...telephone.value, ended: { callId: 'call', contactLabel: '+14165550900', customerId: null, direction: 'outgoing', ringSeconds: 5, durationSeconds: 30 } };
    render(<DialerWorkspace {...common} queue={queue} />);
    expect(await within(workspace()).findByRole('heading', { name: 'Zed Okafor', level: 2 })).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Contact' })).getByText('No recorded calls with this contact yet.')).toBeVisible();
  });

  it('believes the call when it is linked to nobody, whatever this page assumed when dialing', async () => {
    callContext.mockResolvedValue({ callId: 'call', contact: null, recentCalls: [] });
    telephone.value = { ...telephone.value, status: 'ready', activeCall: liveCall({ contactLabel: 'Alice', customerId: 'alice' }) };
    render(<DialerWorkspace {...common} queue={queue} />);
    await waitFor(() => expect(screen.getByRole('region', { name: 'Contact' })).toHaveTextContent('No contact is linked to this call.'));
    expect(screen.queryByRole('region', { name: 'Call task' })).not.toBeInTheDocument();
  });

  it('shows what this page already holds only until the call answers, and ignores an answer about another call', async () => {
    callContext.mockResolvedValue({ callId: 'some-other-call', contact: zed, recentCalls: [] });
    telephone.value = { ...telephone.value, status: 'ready', activeCall: liveCall({ contactLabel: 'Alice', customerId: 'alice' }) };
    render(<DialerWorkspace {...common} queue={queue} />);
    await waitFor(() => expect(callContext).toHaveBeenCalled());
    const context = screen.getByRole('region', { name: 'Contact' });
    expect(within(context).getByRole('link', { name: 'Alice' })).toBeVisible();
    expect(within(context).queryByText('Zed Okafor')).not.toBeInTheDocument();
  });

  it('asks nothing for an incoming call that has no call record yet', () => {
    telephone.value = { ...telephone.value, status: 'ready', activeCall: liveCall({ direction: 'incoming', callId: null, contactLabel: null }) };
    render(<DialerWorkspace {...common} queue={queue} />);
    expect(callContext).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Contact' })).toHaveTextContent('No contact is linked to this call.');
  });
});

describe('the business a contact belongs to', () => {
  const person = { ...entry('ada', 'Ada Lovelace', '+14165550101'), customer: { id: 'ada', name: 'Ada Lovelace', phone: '+14165550101', email: null, contactType: 'person' as const, companyId: 'engines', companyName: 'Analytical Engines', title: 'Director' } };
  const company = { ...entry('engines', 'Analytical Engines', '+14165550102'), customer: { id: 'engines', name: 'Analytical Engines', phone: '+14165550102', email: null, contactType: 'company' as const, companyId: 'engines', companyName: 'Analytical Engines', title: null } };
  const plain = entry('bob', 'Bob', '+14165550103');

  it('is shown on a person’s call list row and found by searching it; a company is not repeated as its own business', () => {
    render(<DialerWorkspace {...common} queue={[person, company, plain]} queueTotal={3} />);
    const list = screen.getByRole('list', { name: 'Calls' });
    expect(within(list).getByRole('button', { name: /Ada Lovelace/ })).toHaveTextContent('Director, Analytical Engines');
    expect(list.querySelectorAll('[data-slot="contact-business"]')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Search call list'), { target: { value: 'analytical' } });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).queryByRole('button', { name: /Bob/ })).not.toBeInTheDocument();
  });

  it('is shown with the chosen contact and linked in the Contact region for someone who may view contacts', () => {
    render(<DialerWorkspace {...common} queue={[person, company]} />);
    expect(workspace()).toHaveTextContent('Director, Analytical Engines');
    const context = screen.getByRole('region', { name: 'Contact' });
    expect(within(context).getByText('Director')).toBeVisible();
    expect(within(context).getByRole('link', { name: 'Analytical Engines' })).toHaveAttribute('href', '/organizations/tenant/crm/contacts/engines');
    fireEvent.click(screen.getByRole('button', { name: /^AEAnalytical Engines|Analytical Engines.*Call Analytical/ }));
    expect(within(screen.getByRole('region', { name: 'Contact' })).queryByText('Business')).not.toBeInTheDocument();
  });

  it('is named without a link for someone who may not view contacts', () => {
    render(<DialerWorkspace {...common} queue={[person]} mayViewContacts={false} />);
    const context = screen.getByRole('region', { name: 'Contact' });
    expect(within(context).getByText('Analytical Engines')).toBeVisible();
    expect(within(context).queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('the outbound number a call will use', () => {
  const queue = [entry('alice', 'Alice', '+14165550101')];
  const mine: OutboundLine = { id: 'mine', e164: '+14165550111', label: null, source: 'member', group: 'assigned' };
  const front: OutboundLine = { id: 'front', e164: '+14165550122', label: 'Front desk', source: 'organization_default', group: 'shared' };
  const pool: OutboundLine = { id: 'pool', e164: '+14165550133', label: 'Sales line', source: 'shared', group: 'shared' };
  const several: CallingOptions = { numbers: [office, mine, front, pool], defaultNumber: office, unavailableReason: null, blocker: null };

  it.each([
    ['preference', 'The number you chose to call from'],
    ['member_default', 'Your default number'],
    ['member', 'Selected from your assigned numbers'],
    ['organization_default', 'The business’s default number'],
    ['shared', 'Selected from the shared numbers'],
  ] as const)('explains an Automatic choice that came from %s', (source, words) => {
    const line: OutboundLine = { ...office, source, group: source === 'shared' || source === 'organization_default' ? 'shared' : 'assigned' };
    render(<DialerWorkspace {...common} options={{ ...options, numbers: [line], defaultNumber: line }} queue={queue} />);
    expect(screen.getByLabelText('Call from')).toHaveTextContent('Automatic · Office · (416)555-0100');
    expect(within(workspace()).getAllByText(words)).toHaveLength(1);
  });

  it('offers no list to choose from when there is one number: Automatic is that number', async () => {
    render(<DialerWorkspace {...common} queue={queue} />);
    expect(await optionLabels(screen.getByLabelText('Call from'))).toEqual(['Automatic · Office · (416)555-0100']);
  });

  it('groups the alternatives as the caller’s own and shared, and sends the one chosen as an intent', async () => {
    render(<DialerWorkspace {...common} options={several} queue={queue} />);
    const from = screen.getByLabelText('Call from');
    expect(await optionValues(from)).toEqual(['', 'office', 'mine', 'front', 'pool']);
    fireEvent.click(from);
    const listbox = (await screen.findAllByRole('listbox')).at(-1)!;
    expect(within(within(listbox).getByRole('group', { name: 'Your numbers' })).getAllByRole('option').map(option => option.textContent)).toEqual(['Office · (416)555-0100', '(416)555-0111']);
    expect(within(within(listbox).getByRole('group', { name: 'Shared numbers' })).getAllByRole('option').map(option => option.textContent)).toEqual(['Front desk · (416)555-0122', 'Sales line · (416)555-0133']);
    fireEvent.click(within(listbox).getByRole('option', { name: 'Sales line · (416)555-0133' }));
    // A named number is its own explanation; the Automatic reason is not left beside it.
    expect(within(workspace()).queryByText('Your default number')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Call' }));
    await waitFor(() => expect(dial).toHaveBeenCalledWith(expect.objectContaining({ phoneNumberId: 'pool' })));
  });

  it('returns to Automatic by choosing it, and then names no number to the server', async () => {
    render(<DialerWorkspace {...common} options={several} queue={queue} />);
    await chooseOption(screen.getByLabelText('Call from'), 'mine');
    await chooseOption(screen.getByLabelText('Call from'), '');
    expect(within(workspace()).getByText('Your default number')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Call' }));
    await waitFor(() => expect(dial).toHaveBeenCalledWith(expect.objectContaining({ phoneNumberId: null })));
  });

  it('drops a chosen number the server stops offering, and calls with Automatic instead', async () => {
    const app = render(<DialerWorkspace {...common} options={several} queue={queue} />);
    await chooseOption(screen.getByLabelText('Call from'), 'pool');
    // Sharing ended; the refreshed page no longer lists that number.
    app.rerender(<DialerWorkspace {...common} options={{ ...several, numbers: [office, mine, front] }} queue={queue} />);
    expect(fieldValue(screen.getByLabelText('Call from'))).toBe('');
    expect(screen.getByLabelText('Call from')).toHaveTextContent('Automatic · Office · (416)555-0100');
    fireEvent.click(screen.getByRole('button', { name: 'Call' }));
    await waitFor(() => expect(dial).toHaveBeenCalledWith(expect.objectContaining({ phoneNumberId: null })));
  });

  it('reads the options again when the server refuses the call', async () => {
    dial.mockResolvedValue(false);
    render(<DialerWorkspace {...common} options={several} queue={queue} />);
    refresh.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Call' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('hands the pop-out window the same numbers, the chosen one and the blocker with its permitted link', async () => {
    const open = vi.fn();
    const value = { container: null, error: null, open, close: vi.fn(), updateDraft: vi.fn(), inlineHost: true, setInlineHost: vi.fn() };
    const app = render(<DialerPopoutContext.Provider value={value}><DialerWorkspace {...common} options={several} queue={queue} /></DialerPopoutContext.Provider>);
    await chooseOption(screen.getByLabelText('Call from'), 'front');
    fireEvent.click(screen.getByRole('button', { name: 'Pop out dialer' }));
    expect(open.mock.calls[0][0]).toMatchObject({ numbers: several.numbers, defaultNumber: office, phoneNumberId: 'front', blocker: null });
    app.unmount();
    open.mockClear();
    const noNumber = blocked('not-configured', 'No outbound number is assigned to you or shared in this business.', 'phone-numbers');
    const withDoor = render(<DialerPopoutContext.Provider value={value}><DialerWorkspace {...common} options={noNumber} queue={queue} setup={numbersDoor} /></DialerPopoutContext.Provider>);
    fireEvent.click(screen.getByRole('button', { name: 'Pop out dialer' }));
    expect(open.mock.calls[0][0].blocker).toEqual({ kind: 'not-configured', reason: 'No outbound number is assigned to you or shared in this business.', setup: numbersDoor });
    withDoor.unmount();
    open.mockClear();
    // Without the door, the window is told the reason and given no link.
    render(<DialerPopoutContext.Provider value={value}><DialerWorkspace {...common} options={noNumber} queue={queue} /></DialerPopoutContext.Provider>);
    fireEvent.click(screen.getByRole('button', { name: 'Pop out dialer' }));
    expect(open.mock.calls[0][0].blocker).toMatchObject({ kind: 'not-configured', setup: null });
  });
});

describe('dialer toolbar composition', () => {
  it('keeps modes, visibility controls and page actions in one group with distinct semantics', () => {
    render(<DialerWorkspace {...common} queue={[]} actions={<><a href="#call-history">Call history</a><button>Configuration</button></>} settings={[{ key: 'call-setup', label: 'Call setup', href: '/setup' }, { key: 'phone-numbers', label: 'Phone numbers', href: '/numbers' }]} />);
    const toolbar = screen.getByRole('group', { name: 'Dialer toolbar' });
    // Configuration is one press further away than calling, in a named menu.
    expect(within(toolbar).queryByRole('link', { name: 'Phone numbers' })).not.toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'More Dialer actions' })).toHaveAttribute('aria-haspopup', 'menu');
    expect(within(toolbar).getByRole('button', { name: 'Standard' })).toBeVisible();
    expect(within(toolbar).getByRole('link', { name: 'Call history' })).toHaveAttribute('href', '#call-history');
    expect(within(toolbar).getByRole('button', { name: 'Configuration' })).toBeVisible();
    const panels = within(toolbar).getByRole('group', { name: 'Panel visibility' });
    expect(panels).not.toHaveAttribute('data-slot', 'tabs-list');
    fireEvent.click(within(panels).getByRole('button', { name: 'Call list panel' }));
    fireEvent.click(within(panels).getByRole('button', { name: 'Context panel' }));
    expect(within(panels).getByRole('button', { name: 'Call list panel' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(panels).getByRole('button', { name: 'Context panel' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Focus' }));
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Standard' }));
    expect(within(panels).getByRole('button', { name: 'Call list panel' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Focus' }));
    fireEvent.click(within(toolbar).getByRole('link', { name: 'Call history' }));
    expect(within(toolbar).getByRole('button', { name: 'Standard' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('opens the calling settings from the overflow menu, and offers no menu to someone with nothing to configure', async () => {
    const user = userEvent.setup();
    const app = render(<DialerWorkspace {...common} queue={[]} settings={[{ key: 'call-setup', label: 'Call setup', href: '/setup' }, { key: 'phone-numbers', label: 'Phone numbers', href: '/numbers' }]} />);
    await user.click(screen.getByRole('button', { name: 'More Dialer actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Call setup' })).toHaveAttribute('href', '/setup');
    expect(screen.getByRole('menuitem', { name: 'Phone numbers' })).toHaveAttribute('href', '/numbers');
    await user.keyboard('{Escape}');
    app.rerender(<DialerWorkspace {...common} queue={[]} />);
    expect(screen.queryByRole('button', { name: 'More Dialer actions' })).not.toBeInTheDocument();
  });
  it('carries an edited number and caller selection in both directions without customer attribution', async () => {
    const open = vi.fn();
    const value = { container: null, error: null, open, close: vi.fn(), updateDraft: vi.fn(), inlineHost: true, setInlineHost: vi.fn() };
    render(<DialerPopoutContext.Provider value={value}><DialerWorkspace {...common} options={{ ...options, numbers: [...options.numbers, { id: 'other-line', e164: '+14165550999', label: 'Other', source: 'shared', group: 'shared' }] }} queue={[entry('alice', 'Alice', '+14165550101')]} /></DialerPopoutContext.Provider>);
    fireEvent.click(screen.getByRole('button', { name: 'Dial another number' }));
    fireEvent.change(screen.getByLabelText('Number to call'), { target: { value: '+14165550199' } });
    await chooseOption(screen.getByLabelText('Call from'), 'other-line');
    fireEvent.click(screen.getByRole('button', { name: 'Pop out dialer' }));
    const draft = open.mock.calls[0][0];
    expect(draft).toMatchObject({ toNumber: '+14165550199', phoneNumberId: 'other-line', customerId: undefined });
    fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
    // The provider invokes this callback when the popup closes.
    act(() => draft.onReturn({ toNumber: '+14165550188', phoneNumberId: 'other-line' }));
    expect(screen.getByLabelText('Number to call')).toHaveValue('(416)555-0188');
    expect(fieldValue(screen.getByLabelText('Call from'))).toBe('other-line');
    fireEvent.click(screen.getByRole('button', { name: 'Call' }));
    await waitFor(() => expect(dial).toHaveBeenCalledWith(expect.objectContaining({ toNumber: '+14165550188', customerId: undefined, phoneNumberId: 'other-line' })));
  });
});

describe('removing someone from the call list', () => {
  it('is offered on each entry only to members who hold the removal permission', () => {
    const app = render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101'), entry('bob', 'Bob', '+14165550102')]} mayRemoveFromList />);
    expect(screen.getByRole('button', { name: 'Actions for Alice' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Actions for Bob' })).toBeVisible();
    app.rerender(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101')]} />);
    expect(screen.queryByRole('button', { name: 'Actions for Alice' })).not.toBeInTheDocument();
  });

  it('asks first, says what is kept, then cancels only that entry and confirms with a toast', async () => {
    removal.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101'), entry('bob', 'Bob', '+14165550102')]} mayRemoveFromList />);
    await user.click(screen.getByRole('button', { name: 'Actions for Bob' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove from list' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Remove Bob from the call list?' });
    expect(confirm).toHaveTextContent('The contact, their notes and call history are kept, and a call in progress is not ended.');
    expect(removal).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Remove from list' }));
    await waitFor(() => expect(removal).toHaveBeenCalledWith('tenant', 'bob'));
    expect(toast.success).toHaveBeenCalledWith('Removed Bob from the call list.');
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('keeps the dialog open with the reason when removal is refused, and Cancel removes nothing', async () => {
    removal.mockResolvedValue({ error: 'Your role cannot remove contacts from the call list.' });
    const user = userEvent.setup();
    render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101')]} mayRemoveFromList />);
    await user.click(screen.getByRole('button', { name: 'Actions for Alice' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove from list' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Remove from list' }));
    expect(await within(confirm).findByText('Your role cannot remove contacts from the call list.')).toBeVisible();
    expect(toast.success).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(removal).toHaveBeenCalledTimes(1);
  });

  it('leaves a call in progress connected when its entry is removed', async () => {
    removal.mockResolvedValue({ error: null });
    telephone.value = { ...telephone.value, status: 'ready', activeCall: { status: 'in_progress', direction: 'outgoing', muted: false, startedAt: Date.now(), callId: 'call', contactLabel: 'Alice' } };
    const user = userEvent.setup();
    const app = render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101')]} mayRemoveFromList />);
    await user.click(screen.getByRole('button', { name: 'Actions for Alice' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove from list' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove from list' }));
    await waitFor(() => expect(removal).toHaveBeenCalledWith('tenant', 'alice'));
    // The refreshed page no longer lists them; the call carries on in the console.
    app.rerender(<DialerWorkspace {...common} queue={[]} queueTotal={0} mayRemoveFromList />);
    expect(screen.getByTestId('live-call')).toHaveTextContent('console');
    expect(telephone.value.unregister).not.toHaveBeenCalled();
  });

describe('a caller who may not view contacts', () => {
  it('still shows the listed contact’s name and number, without links into Contacts', () => {
    render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101')]} mayViewContacts={false} />);
    expect(screen.getAllByText('Alice').length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: 'Alice' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open contact' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open call history' })).toBeNull();
  });
  it('offers the contact record to a caller who may view contacts', () => {
    render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101')]} />);
    expect(screen.getByRole('link', { name: 'Open contact' })).toHaveAttribute('href', '/organizations/tenant/crm/contacts/alice');
  });
});
});

describe('an archived contact still on the call list', () => {
  it('stays listed and is marked Archived rather than hidden', () => {
    const archived = entry('alice', 'Alice', '+14165550101');
    render(<DialerWorkspace {...common} queue={[{ ...archived, customer: { ...archived.customer!, archived: true } }]} />);
    expect(screen.getByRole('button', { name: /Alice.*Archived/ })).toBeInTheDocument();
  });
});
