// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommunicationsHome } from '@/features/communications/home/communications-home';
import type { CommunicationsDashboard } from '@/lib/application/communications/dashboard';
import Link from 'next/link';

vi.mock('next/navigation', () => ({ usePathname: () => '/organizations/tenant/comms', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/features/communications/home/communication-actions', () => ({ NewCallButton: () => <Link href="/organizations/tenant/calls">New call</Link>, ConversationActions: () => null }));

function fixture(): CommunicationsDashboard {
  return {
    params: { when: 'today', attention: null, queue: 'all', channel: 'all', search: '' }, today: '2026-11-10', window: { since: '2026-11-10T05:00:00Z', until: '2026-11-11T05:00:00Z' },
    mayCall: true, mayMessage: true, canCall: true, callingReady: false, callingBlocker: { kind: 'unavailable', reason: 'Calling isn’t enabled yet.', setup: null }, canCompose: false, composeChannel: 'email',
    outcomes: [], counts: { active: 0, today: 0, missedToday: 0, needsWrapUp: 0 }, inboxCounts: { unread: 0, mine: 0, unassigned: 0, open: 0, waiting: 0 },
    calls: { items: [], total: 0, nextCursor: null }, missed: { items: [], total: 0, nextCursor: null }, wrap: { items: [], total: 0, nextCursor: null },
    queue: { items: [], total: 0, nextCursor: null }, unread: { items: [], total: 0, nextCursor: null }, unassigned: { items: [], total: 0, nextCursor: null },
    activity: [], todayActivity: [], answered: 0, recorded: 0,
  };
}
beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((media: string) => ({ matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Communications operational Dashboard', () => {
  it('shows one platform-owned blocker without turning it into a tenant setup task', () => {
    render(<CommunicationsHome organizationId="tenant" timezone="America/Toronto" data={fixture()} setupHref="/must-not-be-offered" />);
    expect(screen.getAllByText('Calling isn’t enabled yet.')).toHaveLength(1);
    expect(within(screen.getByRole('status')).queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Routing setup/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument();
    expect(screen.getByText('Answer rate')).toBeVisible();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });
  it('starts with outstanding work, keeps explicit selection and links exact counts to their owners', () => {
    const data = fixture();
    data.inboxCounts!.unread = 42;
    const app = render(<CommunicationsHome organizationId="tenant" timezone="America/Toronto" data={data} />);
    const views = screen.getByRole('navigation', { name: 'Attention categories' });
    expect(within(views).getByRole('link', { name: 'Unread (42)' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Unread conversations 42/ })).toHaveAttribute('href', '/organizations/tenant/comms/inbox?view=unread');
    data.params = { ...data.params, attention: 'missed' };
    app.rerender(<CommunicationsHome organizationId="tenant" timezone="America/Toronto" data={data} />);
    expect(within(views).getByRole('link', { name: 'Missed calls (0)' })).toHaveAttribute('aria-current', 'page');
  });
  it('offers an eligible number-assignment recovery only for an organization-owned gap', () => {
    const data = fixture();
    data.callingBlocker = { kind: 'not-configured', reason: 'No ready outbound number is assigned.', setup: 'phone-numbers' };
    const app = render(<CommunicationsHome organizationId="tenant" timezone="America/Toronto" data={data} setupHref="/organizations/tenant/comms/configuration/numbers" />);
    expect(screen.getByRole('link', { name: 'Number assignments' })).toHaveAttribute('href', '/organizations/tenant/comms/configuration/numbers');
    app.rerender(<CommunicationsHome organizationId="tenant" timezone="America/Toronto" data={data} />);
    expect(screen.queryByRole('link', { name: 'Number assignments' })).not.toBeInTheDocument();
  });
});
