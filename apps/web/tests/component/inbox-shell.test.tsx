// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InboxShell } from '@/features/communications/inbox/inbox-shell';
import type { InboxItem } from '@/lib/domain/reception/inbox';
import { chooseOption } from '../support/select-field';

const state = vi.hoisted(() => ({ query: '', path: '/organizations/tenant/comms/inbox', push: vi.fn(), list: vi.fn(), counts: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => state.path, useSearchParams: () => new URLSearchParams(state.query), useRouter: () => ({ push: state.push }) }));
vi.mock('@/app/organizations/[organizationId]/comms/inbox/actions', () => ({ listInboxAction: state.list, inboxCountsAction: state.counts }));
const item = (id: string, title: string): InboxItem => ({ id, title, channel: 'email', externalAddress: `${id}@example.test`, subject: 'Service request', preview: `Message for ${title}`, lastActivityAt: '2026-11-10T15:00:00Z', unread: true, status: 'open', assignee: null, customer: null });
const page = (items: InboxItem[], nextCursor: string | null = null) => ({ ok: true as const, data: { items, nextCursor } });
const app = () => <InboxShell organizationId="tenant"><p>Select a conversation</p></InboxShell>;

beforeEach(() => {
  vi.clearAllMocks();
  state.query = ''; state.path = '/organizations/tenant/comms/inbox';
  state.list.mockResolvedValue(page([]));
  state.counts.mockResolvedValue({ ok: true, data: { unread: 2, mine: 1, unassigned: 2, open: 3, waiting: 0 } });
});
afterEach(cleanup);

describe('Conversations operating shell', () => {
  it('keeps website threads in the main list with their own destination, claim state and unknown read status', async () => {
    state.query = 'channel=web&status=any&q=visitor';
    state.list.mockResolvedValueOnce(page([{ ...item('thread-1', 'Website visitor'), source: 'website', channel: 'web', unread: null, sourceStatus: 'handoff_requested' }]));
    render(app());
    const row = await screen.findByRole('link', { name: /Website visitor/ });
    expect(row).toHaveAttribute('href', '/organizations/tenant/comms/inbox/website?channel=web&status=any&q=visitor&thread=thread-1');
    expect(row).toHaveTextContent('Human requested');
    expect(row).toHaveTextContent('Read status not tracked');
    expect(within(row).queryByRole('img', { name: 'Unread' })).not.toBeInTheDocument();
    await chooseOption(screen.getByRole('combobox', { name: 'Messaging channel' }), 'Email');
    expect(state.push).toHaveBeenCalledWith('/organizations/tenant/comms/inbox?channel=email&status=any&q=visitor', { scroll: false });
  });
  it('preserves search and independent filters when changing a view or channel', async () => {
    state.query = 'q=service&channel=email&status=waiting';
    render(app());
    await screen.findByText('No conversations match this search.');
    expect(screen.getByRole('link', { name: 'Mine (1)' })).toHaveAttribute('href', '/organizations/tenant/comms/inbox?channel=email&view=mine&status=waiting&q=service');
    await chooseOption(screen.getByRole('combobox', { name: 'Messaging channel' }), 'SMS');
    expect(state.push).toHaveBeenCalledWith('/organizations/tenant/comms/inbox?channel=sms&status=waiting&q=service', { scroll: false });
    expect(state.list).toHaveBeenCalledWith('tenant', expect.objectContaining({ channel: 'email', status: 'waiting', search: 'service' }), null);
  });
  it('searches through client navigation, keeping the active filters and telephone layout alive', async () => {
    state.query = 'channel=sms&view=unread&status=closed';
    render(app());
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search conversations' }), { target: { value: 'Alice' } });
    fireEvent.submit(screen.getByRole('search'));
    expect(state.push).toHaveBeenCalledWith('/organizations/tenant/comms/inbox?channel=sms&view=unread&status=closed&q=Alice', { scroll: false });
    await waitFor(() => expect(state.list).toHaveBeenCalled());
  });
  it('distinguishes loading, a true empty list and a failed read', async () => {
    let finish!: (value: ReturnType<typeof page>) => void;
    state.list.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const view = render(app());
    expect(screen.getByRole('status', { name: 'Loading conversations' })).toBeVisible();
    expect(screen.queryByText('Select a conversation')).not.toBeInTheDocument();
    await act(async () => finish(page([])));
    expect(screen.getByText('No conversations yet.')).toBeVisible();
    expect(screen.queryByText('Select a conversation')).not.toBeInTheDocument();
    state.query = 'channel=email';
    state.list.mockResolvedValueOnce({ ok: false, error: 'Access to conversations could not be checked.' });
    view.rerender(app());
    expect(await screen.findByRole('alert')).toHaveTextContent('Access to conversations could not be checked.');
    expect(screen.queryByText('No email conversations match.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('No email conversations match.');
  });
  it('does not append an old page after the channel changes', async () => {
    state.list.mockResolvedValueOnce(page([item('old', 'Old sender')], 'next'));
    const view = render(app());
    await screen.findByText('Old sender');
    let finish!: (value: ReturnType<typeof page>) => void;
    state.list.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    state.query = 'channel=email';
    state.list.mockResolvedValueOnce(page([item('new', 'Current sender')]));
    view.rerender(app());
    await screen.findByText('Current sender');
    await act(async () => finish(page([item('stale', 'Stale sender')])));
    expect(screen.queryByText('Stale sender')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Conversation list' })).getByText('Current sender')).toBeVisible();
  });
});
