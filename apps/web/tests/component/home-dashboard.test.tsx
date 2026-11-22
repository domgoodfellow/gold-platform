// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptySource, homePeriod, type HomeAttentionItem, type HomeData, type HomeMetric, type HomeResult, type HomeSourceData } from '@/lib/application/home/contracts';

/**
 * Organization Home as rendered: one compact header (greeting, date, refresh time, Customize and
 * Quick actions, no second Search entry), uniform overview tiles that keep a zero, an attention
 * list that tells tasks, reviews and problems apart with one control per row, and a Business
 * performance panel only when it has period figures or Finance is unknown.
 */
const refresh = vi.fn();
const openSearch = vi.fn();
vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }), usePathname: () => '/organizations/org/home', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/components/panels/workspace-right-rail', () => ({ useWorkspaceRail: () => ({ toggleAgent: vi.fn() }) }));
vi.mock('@/features/home/command-center', () => ({
  QuickActions: () => <button type="button">Quick actions</button>,
  useHomeCommands: () => ({ publish: vi.fn(), openSearch, displayName: 'Ada Lovelace' }),
}));
const { HomeDashboard } = await import('@/features/home/home-dashboard');

const NOW = '2026-11-21T15:00:00.000Z';
const attentionRow = (id: string, extra: Partial<HomeAttentionItem> = {}): HomeAttentionItem => ({
  key: `CRM:follow-up:${id}`, organizationId: 'org', source: 'CRM', category: 'follow-up', title: id, description: 'Acme',
  kind: 'task', urgency: 'normal', overdue: false, record: { kind: 'follow-up', id }, destination: { href: `/organizations/org/crm/tasks?selected=${id}`, label: 'Open' }, ...extra,
});
const metric = (key: string, label: string, value: number | string): HomeMetric => ({ key, label, value, definition: `${label} definition`, href: `/organizations/org/${key}` });
const ready = (source: HomeSourceData['source'], data: Partial<HomeSourceData> = {}): HomeResult => ({ source, state: 'ready', data: { ...emptySource(source), ...data } });
function home(results: HomeResult[], extra: Partial<HomeData> = {}): HomeData {
  return {
    organizationId: 'org', membershipId: 'member', date: '2026-11-21', timezone: 'UTC', refreshedAt: NOW,
    query: { when: 'today', scope: 'organization', attention: 'all', schedule: 'today' }, period: homePeriod('2026-11-21', 'UTC', 'today'),
    results, kpis: [metric('active-work', 'Active Work', 0), metric('opportunities', 'Open opportunities', 3)],
    quickActions: [], search: [], agentPrompts: ['Which Work is at risk?'], ...extra,
  };
}

beforeEach(() => {
  refresh.mockReset();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn().mockImplementation((media: string) => ({ matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear(); localStorage.clear(); });

describe('Home header', () => {
  it('keeps greeting, date, Customize and Quick actions, drops the second Search entry and folds refresh into the date line', async () => {
    const user = userEvent.setup();
    render(<HomeDashboard data={home([ready('CRM', { activity: [{ key: 'CRM:event:1', source: 'CRM', title: 'Contact added', at: NOW, href: '/c' }] })])} />);
    expect(screen.getByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening), Ada$/ })).toBeInTheDocument();
    expect(screen.getByText('Saturday, November 21, 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Customize' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quick actions' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ask or find/ })).not.toBeInTheDocument();
    const refreshControl = screen.getByRole('button', { name: /^Updated .+\. Refresh Home$/ });
    expect(refreshControl).toHaveTextContent(/^Updated /);
    await user.click(refreshControl);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('Business overview', () => {
  it('draws every figure as the same tile, keeps a legitimate zero and adds no "Now" line', () => {
    render(<HomeDashboard data={home([ready('CRM', { performance: [metric('customers', 'Contacts', 0)] }), ready('Finance', { performance: [metric('Outstanding invoices:CAD', 'Outstanding invoices · CAD', 'CA$0.00')] })])} />);
    const overview = screen.getByRole('region', { name: 'Business overview' });
    const tiles = within(overview).getAllByRole('link');
    expect(tiles.map(tile => tile.getAttribute('data-slot'))).toEqual(['metric-tile', 'metric-tile', 'metric-tile', 'metric-tile']);
    expect(tiles.map(tile => tile.textContent)).toEqual(['Active Work0', 'Open opportunities3', 'Contacts0', 'Outstanding invoices · CADCA$0.00']);
    expect(within(overview).queryByText('Now')).not.toBeInTheDocument();
    // Each tile fills one equal cell, so a wrapping label cannot make one tile taller than its row.
    for (const tile of tiles) expect(tile.parentElement).toHaveClass('grid');
  });
});

describe('Needs attention', () => {
  const rows = [
    attentionRow('Call Acme back', { overdue: true, urgency: 'high', dueAt: '2026-11-21T09:00:00.000Z', ownerName: 'Ada' }),
    attentionRow('Rule with no action', { key: 'Automations:rule:r1', source: 'Automations', category: 'rule', kind: 'problem', description: 'Switched on, but has no action' }),
    attentionRow('Website revision 4', { key: 'Studio:website-revision:w1', source: 'Studio', category: 'website-revision', kind: 'review', status: 'In review', description: 'Publication awaiting review' }),
  ];

  it('is a compact list, not a table, with one control per row and the record’s source, context, status and deadline', () => {
    render(<HomeDashboard data={home([ready('CRM', { attention: rows })])} />);
    const panel = screen.getByRole('region', { name: 'Needs attention' });
    expect(within(panel).queryByRole('table')).not.toBeInTheDocument();
    const items = within(within(panel).getByRole('list', { name: 'Attention items' })).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    for (const item of items) expect(item.querySelectorAll('a, button, [tabindex]:not([tabindex="-1"])')).toHaveLength(1);
    const overdue = items.find(item => item.textContent?.includes('Call Acme back'))!;
    expect(within(overdue).getByRole('link', { name: 'Open Call Acme back' })).toHaveAttribute('href', '/organizations/org/crm/tasks?selected=Call Acme back');
    expect(within(overdue).getByText('Overdue')).toBeInTheDocument();
    expect(overdue).toHaveTextContent(/CRM · Acme · Ada/);
    expect(within(overdue).getByText(/^Due Nov 21, 9:00 a\.m\.$/)).toHaveAttribute('dateTime', '2026-11-21T09:00:00.000Z');
    const review = items.find(item => item.textContent?.includes('Website revision 4'))!;
    expect(within(review).getByText('In review')).toBeInTheDocument();
    expect(review).toHaveTextContent('Studio · Publication awaiting review');
    expect(panel).not.toHaveTextContent('No deadline');
  });

  it('tells ordinary tasks, reviews and genuine problems apart by shape and name, not colour alone', () => {
    render(<HomeDashboard data={home([ready('CRM', { attention: rows })])} />);
    const items = within(screen.getByRole('list', { name: 'Attention items' })).getAllByRole('listitem');
    expect(items.map(item => item.getAttribute('data-attention-kind'))).toEqual(['task', 'problem', 'review']);
    expect(items.map(item => within(item).getByRole('img').getAttribute('aria-label'))).toEqual(['Task', 'Problem', 'Review']);
  });

  it('marks nothing overdue without the source saying so', () => {
    render(<HomeDashboard data={home([ready('CRM', { attention: [attentionRow('Old conversation', { occurredAt: '2026-10-01T00:00:00.000Z' })] })])} />);
    const item = within(screen.getByRole('list', { name: 'Attention items' })).getByRole('listitem');
    expect(item).not.toHaveTextContent('Overdue');
    expect(item).toHaveTextContent('CRM · Acme');
  });

  it('keeps the All, Mine, Urgent and Overdue filters', () => {
    render(<HomeDashboard data={home([ready('CRM')])} />);
    const filters = screen.getByRole('navigation', { name: 'Attention filters' });
    expect(within(filters).getAllByRole('link').map(link => link.textContent)).toEqual(['All', 'Mine', 'Urgent', 'Overdue']);
    expect(screen.getByText('Nothing needs attention.')).toBeInTheDocument();
  });
});

describe('Business performance and panel sizing', () => {
  it('is omitted when only current figures exist, which already sit in the overview', () => {
    render(<HomeDashboard data={home([ready('CRM', { performance: [metric('customers', 'Contacts', 12)] })])} />);
    expect(screen.queryByRole('region', { name: 'Business performance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Customize' })).not.toBeInTheDocument();
  });

  it('is shown for a period figure, a zero included', () => {
    render(<HomeDashboard data={home([ready('Marketing', { performance: [metric('acquired', 'Acquisition inquiries received', 0)] })])} />);
    const panel = screen.getByRole('region', { name: 'Business performance' });
    expect(within(panel).getByRole('link', { name: /^Acquisition inquiries received\s*0$/ })).toHaveAttribute('data-slot', 'metric-tile');
  });

  it('is shown when Finance is unknown, saying so rather than drawing zeros', () => {
    render(<HomeDashboard data={home([ready('CRM'), { source: 'Finance', state: 'unavailable' }])} />);
    const panel = screen.getByRole('region', { name: 'Business performance' });
    expect(within(panel).getByRole('status')).toHaveTextContent('Finance is unavailable. Its amounts and payment chart are unknown.');
    expect(panel.querySelector('[data-slot="metric-tile"]')).toBeNull();
  });

  it('sizes every Home panel to its content', () => {
    render(<HomeDashboard data={home([ready('CRM', { attention: rows(), activity: [{ key: 'CRM:event:1', source: 'CRM', title: 'Contact added', at: NOW, href: '/c' }] })])} />);
    const widgets = [...document.querySelectorAll<HTMLElement>('[data-widget-id]')];
    expect(widgets.map(widget => widget.dataset.widgetId)).toEqual(['attention', 'activity']);
    for (const widget of widgets) expect(widget).toHaveAttribute('data-widget-sizing', 'content');
    expect(document.querySelector<HTMLElement>('[data-dashboard-grid]')!.style.gridTemplateRows).toBe('auto auto');
  });

  it('puts Recent activity beside Business performance, and widens it to the full row when alone', () => {
    const activity = [{ key: 'CRM:event:1', source: 'CRM' as const, title: 'Contact added', at: NOW, href: '/c' }];
    render(<HomeDashboard data={home([ready('CRM', { activity }), ready('Marketing', { performance: [metric('acquired', 'Acquisition inquiries received', 2)] })])} />);
    const span = (id: string) => document.querySelector(`[data-widget-id="${id}"]`)!.className.match(/@min-\[64rem\]\/dashboard:col-span-(\d+)/)?.[1];
    expect([span('performance'), span('activity')]).toEqual(['6', '6']);
    cleanup();
    render(<HomeDashboard data={home([ready('CRM', { activity })])} />);
    expect(span('activity')).toBe('12');
  });

  it('lets a short overview fill the row instead of leaving empty columns', () => {
    render(<HomeDashboard data={home([ready('CRM')])} />);
    expect(screen.getByRole('region', { name: 'Business overview' })).toHaveClass('grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))]');
  });
});

function rows() { return [attentionRow('Call Acme back')]; }
