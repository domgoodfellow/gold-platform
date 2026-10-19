// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DialerWorkspace } from '@/features/communications/voice/dialer-workspace';
import type { DialerQueueEntry } from '@/lib/application/communications/dialer-queue';

const dial = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock('@/features/communications/voice/use-dial', () => ({ useDial: () => ({ dial, dialing: false, error: null }) }));
vi.mock('@/features/communications/voice/telephone-device', () => ({ useTelephoneDevice: () => ({ activeCall: null, incoming: null }) }));
const entry = (id: string, name: string, phone: string | null): DialerQueueEntry => ({
  followUp: { id, customerId: id, customerName: name, title: `Call ${name}`, notes: `Recorded notes for ${name}`, dueAt: '2026-10-17T12:00:00Z', kind: 'call', status: 'open', opportunityId: null, opportunityTitle: null, ownerMembershipId: null, ownerName: null, completedAt: null, createdAt: '2026-10-16T12:00:00Z' },
  customer: { id, name, phone, email: null, stageId: null, custom: {}, createdAt: '2026-10-16T12:00:00Z' },
});
const options = { numbers: [{ id: 'office', e164: '+14165550100', label: 'Office' }], defaultNumber: { id: 'office', e164: '+14165550100', label: 'Office' }, unavailableReason: null };
const common = { organizationId: 'tenant', timezone: 'America/Toronto', queueTotal: 2, queueAvailable: true, options };
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('dialer workspace', () => {
  it('selects a real follow-up, shows its context and binds the call to that customer', async () => {
    render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101'), entry('bob', 'Bob', '+14165550102')]} />);
    expect(screen.getByLabelText('Number to call')).toHaveValue('+14165550101');
    fireEvent.click(screen.getByRole('button', { name: /Bob/ }));
    expect(screen.getByLabelText('Number to call')).toHaveValue('+14165550102');
    expect(screen.getByText('Recorded notes for Bob')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Call' }));
    await waitFor(() => expect(dial).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'bob', toNumber: '+14165550102', contactLabel: 'Bob' })));
    expect(screen.getByRole('link', { name: 'Bob' })).toHaveAttribute('href', '/organizations/tenant/customers/bob');
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
  });
  it('shows empty and unavailable states and the bounded queue count', () => {
    const app = render(<DialerWorkspace {...common} queue={[]} queueTotal={0} options={{ numbers: [], defaultNumber: null, unavailableReason: 'Calling setup is incomplete.' }} />);
    expect(screen.getByText('No open call follow-ups.')).toBeVisible();
    expect(screen.getByText('Calling setup is incomplete.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Call' })).toBeDisabled();
    app.rerender(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', null)]} queueTotal={45} />);
    expect(screen.getByText(/Showing the first 1 of 45/)).toBeVisible();
    app.rerender(<DialerWorkspace {...common} queue={[]} queueAvailable={false} />);
    expect(screen.getByText('Call follow-ups are unavailable for this business.')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'All call follow-ups' })).not.toBeInTheDocument();
  });
});

describe('dialer console presentation', () => {
  it('opens in Standard with every region, and Focus keeps only the calling region until Standard is chosen again', () => {
    render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101')]} />);
    expect(screen.getByRole('button', { name: 'Standard' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Call queue' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Customer context' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
    expect(screen.getByRole('button', { name: 'Focus' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Call queue' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Customer context' })).toBeDisabled();
    expect(screen.getByLabelText('Number to call')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Standard' }));
    expect(screen.getByRole('button', { name: 'Call queue' })).toBeEnabled();
  });
  it('selecting a queue row fills the number without dialing', () => {
    dial.mockClear();
    render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101'), entry('bob', 'Bob', '+14165550102')]} />);
    fireEvent.click(screen.getByRole('button', { name: /Bob/ }));
    expect(screen.getByLabelText('Number to call')).toHaveValue('+14165550102');
    expect(dial).not.toHaveBeenCalled();
  });
  it('searches only the loaded follow-ups and says so', () => {
    render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101'), entry('bob', 'Bob', '+14165550102')]} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search loaded call follow-ups' }), { target: { value: 'bob' } });
    expect(screen.queryByRole('button', { name: /Alice/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bob/ })).toBeVisible();
    expect(screen.getByText('Searches the 2 follow-ups loaded here, not the whole queue.')).toBeVisible();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search loaded call follow-ups' }), { target: { value: 'nobody' } });
    expect(screen.getByText('No loaded follow-ups match.')).toBeVisible();
  });
  it('dials a number handed over by a link, with no follow-up selected', () => {
    render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101')]} prefill="+14165550199" />);
    expect(screen.getByLabelText('Number to call')).toHaveValue('+14165550199');
    expect(screen.getByRole('heading', { name: 'New call' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Start calling' })).not.toBeInTheDocument();
  });
  it('offers Start calling for the selected customer, which submits the call form', () => {
    render(<DialerWorkspace {...common} queue={[entry('alice', 'Alice', '+14165550101')]} />);
    expect(screen.getByRole('button', { name: 'Start calling' })).toHaveAttribute('form', 'dialer-call-form');
  });
});
