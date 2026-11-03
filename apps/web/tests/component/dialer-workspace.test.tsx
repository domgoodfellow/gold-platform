// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DialerWorkspace } from '@/features/communications/voice/dialer-workspace';
import { DialerPopoutContext } from '@/features/communications/voice/dialer-popout-context';
import type { CallingOptions } from '@/lib/application/communications/calling-options';
import type { DialerQueueEntry } from '@/lib/application/communications/dialer-queue';
import { chooseOption, fieldValue } from '../support/select-field';

const dial = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const telephone = vi.hoisted(() => ({ value: { activeCall: null as unknown, incoming: null as unknown, status: 'offline', error: null, register: vi.fn(), unregister: vi.fn() } }));
vi.mock('@/features/communications/voice/use-dial', () => ({ useDial: () => ({ dial, dialing: false, error: null }) }));
vi.mock('@/features/communications/voice/telephone-device', () => ({ useTelephoneDevice: () => telephone.value }));
vi.mock('@/features/communications/voice/active-call-dock', () => ({ ActiveCallDock: ({ placement }: { placement: string }) => <div data-testid="live-call">Live call controls ({placement})</div> }));
const entry = (id: string, name: string, phone: string | null, customerId = id): DialerQueueEntry => ({
  followUp: { id, customerId, customerName: name, title: `Call ${name}`, notes: `Recorded notes for ${name}`, dueAt: '2026-10-17T12:00:00Z', kind: 'call', status: 'open', opportunityId: null, opportunityTitle: null, ownerMembershipId: null, ownerName: null, completedAt: null, createdAt: '2026-10-16T12:00:00Z' },
  customer: { id: customerId, name, phone, email: null, stageId: null, custom: {}, createdAt: '2026-10-16T12:00:00Z' },
  recentCalls: [],
});
const options: CallingOptions = { numbers: [{ id: 'office', e164: '+14165550100', label: 'Office' }], defaultNumber: { id: 'office', e164: '+14165550100', label: 'Office' }, unavailableReason: null, blocker: null };
const blocked = (kind: 'restricted' | 'not-configured' | 'unavailable', reason: string, setup: 'phone-numbers' | null = null): CallingOptions => ({ numbers: [], defaultNumber: null, unavailableReason: reason, blocker: { kind, reason, setup } });
const common = { organizationId: 'tenant', timezone: 'America/Toronto', queueTotal: 2, queueAvailable: true, options };
afterEach(() => { cleanup(); vi.clearAllMocks(); telephone.value = { ...telephone.value, activeCall: null, incoming: null, status: 'offline' }; });

describe('dialer workspace', () => {
  it('selects a real follow-up, shows its context and binds the call to that customer', async () => {
    render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101'), entry('bob', 'Bob', '+14165550102')]} />);
    expect(screen.getByLabelText('Number to call')).toHaveValue('(416)555-0101');
    fireEvent.click(screen.getByRole('button', { name: /Bob/ }));
    expect(screen.getByLabelText('Number to call')).toHaveValue('(416)555-0102');
    expect(screen.getByRole('heading', { name: 'Bob', level: 2 })).toBeVisible();
    expect(screen.getByText('Recorded notes for Bob')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Call' }));
    await waitFor(() => expect(dial).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'bob', toNumber: '+14165550102', contactLabel: 'Bob' })));
    expect(screen.getByRole('link', { name: 'Bob' })).toHaveAttribute('href', '/organizations/tenant/crm/contacts/bob');
  });
  it('clears customer attribution when dialing another number', async () => {
    render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101')]} />);
    fireEvent.change(screen.getByLabelText('Number to call'), { target: { value: '+14165550199' } });
    fireEvent.click(screen.getByRole('button', { name: 'Call' }));
    await waitFor(() => expect(dial).toHaveBeenCalledWith(expect.objectContaining({ customerId: undefined, contactLabel: '+14165550199' })));
  });
  it('shows missing phone numbers and does not invent a callable customer', () => {
    render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', null)]} />);
    expect(screen.getByText(/No customer phone number is recorded/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Call' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start calling' })).toBeDisabled();
  });
  it('keeps every region of the console when the business has nothing recorded and cannot call yet', () => {
    render(<DialerWorkspace {...common} queue={[]} queueTotal={0} options={blocked('not-configured', 'No ready outbound number is assigned.', 'phone-numbers')} setupHref="/organizations/tenant/comms/configuration/numbers" />);
    expect(screen.getByRole('region', { name: 'Call queue' })).toHaveTextContent(/No open call follow-ups/);
    expect(screen.getByRole('link', { name: 'Open follow-ups' })).toHaveAttribute('href', '/organizations/tenant/crm/tasks');
    expect(screen.getByRole('region', { name: 'Customer' })).toHaveTextContent(/appear here when you call from a follow-up/);
    const readiness = screen.getByRole('region', { name: 'Calling readiness' });
    expect(within(readiness).getByText('No outbound number')).toBeVisible();
    expect(within(readiness).getByText('Needs configuration')).toBeVisible();
    expect(within(readiness).getByRole('status')).toHaveTextContent('No ready outbound number is assigned.');
    expect(within(readiness).getByRole('link', { name: 'Set up numbers' })).toHaveAttribute('href', '/organizations/tenant/comms/configuration/numbers');
    expect(screen.getByRole('group', { name: 'Dial pad' })).toBeVisible();
    expect(screen.getByLabelText('Number to call')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Call' })).toBeDisabled();
  });
  it.each([
    ['restricted', 'Your role cannot place calls.', 'Restricted'],
    ['unavailable', 'The calling provider is not ready.', 'Unavailable'],
  ] as const)('words a %s blocker as its own state, with no setup link', (kind, reason, state) => {
    render(<DialerWorkspace {...common} queue={[]} queueTotal={0} options={blocked(kind, reason)} setupHref="/never" />);
    const readiness = screen.getByRole('region', { name: 'Calling readiness' });
    expect(within(readiness).getByText(state)).toBeVisible();
    expect(within(readiness).getByRole('status')).toHaveAttribute('data-state', kind);
    expect(within(readiness).queryByRole('link')).not.toBeInTheDocument();
  });
  it('states the bounded queue and an unavailable queue', () => {
    const app = render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', null)]} queueTotal={45} />);
    expect(screen.getByText(/Showing the first 1 of 45/)).toBeVisible();
    app.rerender(<DialerWorkspace {...common} queue={[]} queueAvailable={false} />);
    expect(screen.getByText(/Follow-ups are not included for this business/)).toBeVisible();
    expect(screen.queryByRole('link', { name: /All call follow-ups/ })).not.toBeInTheDocument();
  });
});

describe('dialer console presentation', () => {
  it('opens in Standard with every region, and Focus keeps only the calling console until Standard is chosen again', () => {
    const { container } = render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101')]} />);
    const root = container.firstElementChild!;
    expect(root).toHaveAttribute('data-presentation', 'standard');
    expect(screen.getByRole('button', { name: 'Standard' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Queue panel' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Context panel' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
    expect(screen.getByRole('button', { name: 'Focus' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Queue panel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Context panel' })).toBeDisabled();
    expect(screen.getByLabelText('Number to call')).toBeVisible();
    expect(root).toHaveAttribute('data-presentation', 'focus');
    fireEvent.click(screen.getByRole('button', { name: 'Standard' }));
    expect(screen.getByRole('button', { name: 'Queue panel' })).toBeEnabled();
  });
  it('selecting a queue row fills the number without dialing', () => {
    render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101'), entry('bob', 'Bob', '+14165550102')]} />);
    fireEvent.click(screen.getByRole('button', { name: /Bob/ }));
    expect(screen.getByLabelText('Number to call')).toHaveValue('(416)555-0102');
    expect(dial).not.toHaveBeenCalled();
  });
  it('searches only the loaded follow-ups and says so when that is not the whole queue', () => {
    render(<DialerWorkspace {...common} queueTotal={30} queue={[entry('alice', 'Alice', '+14165550101'), entry('bob', 'Bob', '+14165550102')]} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search loaded call follow-ups' }), { target: { value: 'bob' } });
    expect(screen.queryByRole('button', { name: /Alice/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bob/ })).toBeVisible();
    expect(screen.getByText('Searches the 2 follow-ups loaded here, not the whole queue.')).toBeVisible();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search loaded call follow-ups' }), { target: { value: 'nobody' } });
    expect(screen.getByText('No loaded follow-ups match.')).toBeVisible();
  });
  it('dials a number handed over by a link, with no follow-up selected', () => {
    render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101')]} prefill="+14165550199" />);
    expect(screen.getByLabelText('Number to call')).toHaveValue('(416)555-0199');
    expect(screen.getByRole('heading', { name: 'New call' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Start calling' })).toBeDisabled();
  });
  it('offers Start calling for the selected customer, which submits the call form', () => {
    render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101')]} />);
    expect(screen.getByRole('button', { name: 'Start calling' })).toHaveAttribute('form', 'dialer-call-form');
    expect(screen.getByRole('button', { name: 'Start calling' })).toBeEnabled();
  });
  it('shows the customer’s other open follow-ups and their recorded calls', () => {
    render(<DialerWorkspace {...common} queue={[entry('first', 'Alice', '+14165550101', 'alice'), entry('second', 'Alice', '+14165550101', 'alice')]} recentCalls={{ alice: <p>Recorded call with Alice</p> }} />);
    const context = screen.getByRole('region', { name: 'Customer' });
    expect(within(context).getByText('Recorded call with Alice')).toBeVisible();
    fireEvent.click(within(context).getByRole('button', { name: /Call Alice/ }));
    expect(screen.getAllByRole('button', { name: /Alice/ }).find(button => button.getAttribute('aria-pressed') === 'true')).toBeTruthy();
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
    expect(screen.getByTestId('live-call')).toHaveTextContent('inline');
    expect(screen.queryByLabelText('Number to call')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start calling' })).toBeDisabled();
    expect(within(screen.getByRole('region', { name: 'Calling readiness' })).getByText('Connected')).toBeVisible();
  });
});


describe('dialer toolbar composition', () => {
  it('keeps modes, visibility controls and page actions in one group with distinct semantics', () => {
    render(<DialerWorkspace {...common} queue={[]} actions={<><a href="#call-history">Call history</a><button>Configuration</button></>} />);
    const toolbar = screen.getByRole('group', { name: 'Dialer toolbar' });
    expect(within(toolbar).getByRole('button', { name: 'Standard' })).toBeVisible();
    expect(within(toolbar).getByRole('link', { name: 'Call history' })).toHaveAttribute('href', '#call-history');
    expect(within(toolbar).getByRole('button', { name: 'Configuration' })).toBeVisible();
    const panels = within(toolbar).getByRole('group', { name: 'Panel visibility' });
    expect(panels).not.toHaveAttribute('data-slot', 'tabs-list');
    fireEvent.click(within(panels).getByRole('button', { name: 'Queue panel' }));
    fireEvent.click(within(panels).getByRole('button', { name: 'Context panel' }));
    expect(within(panels).getByRole('button', { name: 'Queue panel' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(panels).getByRole('button', { name: 'Context panel' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Focus' }));
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Standard' }));
    expect(within(panels).getByRole('button', { name: 'Queue panel' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Focus' }));
    fireEvent.click(within(toolbar).getByRole('link', { name: 'Call history' }));
    expect(within(toolbar).getByRole('button', { name: 'Standard' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('carries an edited number and caller selection in both directions without customer attribution', async () => {
    const open = vi.fn();
    const value = { container: null, error: null, open, close: vi.fn(), updateDraft: vi.fn(), inlineHost: true, setInlineHost: vi.fn() };
    render(<DialerPopoutContext.Provider value={value}><DialerWorkspace {...common} options={{ ...options, numbers: [...options.numbers, { id: 'other-line', e164: '+14165550999', label: 'Other' }] }} queue={[entry('alice', 'Alice', '+14165550101')]} /></DialerPopoutContext.Provider>);
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
