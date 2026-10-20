// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceCrumbsProvider, WorkspaceCrumbSlot, PageCrumbs, PageLocationRecords, LocationHeading } from '@/components/navigation/workspace-crumbs';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { RecordHeader } from '@/components/headers/record-header';
import { BusinessVocabulary } from '@/lib/context/business-vocabulary';
import { AREAS, CONFIG_TARGETS, MODULES } from '@/lib/navigation';
import { projectShell } from '@/lib/shell';
import { serializeLocationAccess } from '@/lib/route/page-location';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import type { BusinessProfile } from '@/lib/domain/tenancy/business-profile';

/**
 * The resolver-owned location as it renders (ADR-047, Slice 1B): one answer for the bar's trail,
 * the phone's Up control and the page's heading, on the Customers pilot routes only.
 */
const route = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a> }));
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const org = '11111111-1111-4111-8111-111111111111';
const base = `/organizations/${org}`;
const gate = {
  enabledModules: new Set<string>(MODULES.map((module) => module.key)),
  featureAvailability: new Set<string>([...AREAS.flatMap((area) => area.featureKeys ?? []), ...CONFIG_TARGETS.flatMap((target) => target.featureKeys ?? [])]),
  capabilities: new Set(ALL_CAPABILITIES),
  schedulableWork: true,
};
const navigation = { organizationId: org, sections: projectShell({ organizationId: org, ...gate }), access: serializeLocationAccess(gate) };

function Shell({ children, profile = null, withAccess = true }: { children?: ReactNode; profile?: BusinessProfile | null; withAccess?: boolean }) {
  return (
    <BusinessVocabulary profile={profile}>
      <WorkspaceCrumbsProvider navigation={withAccess ? navigation : { organizationId: org, sections: navigation.sections }}>
        <header data-testid="bar"><WorkspaceCrumbSlot /></header>
        <main>{children}</main>
      </WorkspaceCrumbsProvider>
    </BusinessVocabulary>
  );
}
const bar = () => within(screen.getByTestId('bar'));
const trail = () => within(bar().getByRole('navigation', { name: 'breadcrumb' })).getAllByRole('listitem').map((item) => item.textContent);

describe('the Customers collection', () => {
  it('shows CRM › Customers with one hidden heading and a linked workspace', () => {
    route.pathname = `${base}/customers`;
    render(<Shell><CollectionHeader location={{}} /></Shell>);
    expect(trail()).toEqual(['CRM', 'Customers']);
    expect(bar().getByRole('link', { name: 'CRM' })).toHaveAttribute('href', `${base}/sales`);
    // The current page is the breadcrumb primitive's disabled page item, never an anchor.
    expect(within(bar().getByRole('navigation', { name: 'breadcrumb' })).getByText('Customers').closest('a')).toBeNull();
    expect(bar().getByRole('link', { name: 'Back to parent' })).toHaveAttribute('href', `${base}/sales`);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings.map((heading) => heading.textContent)).toEqual(['Customers']);
    expect(headings[0]).toHaveClass('sr-only');
  });

  it('applies a business label by destination key, in the bar and the heading alike', () => {
    route.pathname = `${base}/customers`;
    render(<Shell profile={{ revision: 1, nouns: {}, navigation: [], labels: { customers: 'Clients' } }}><CollectionHeader location={{}} /></Shell>);
    expect(trail()).toEqual(['CRM', 'Clients']);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Clients');
  });

  it('without access facts still links only the destinations every member has', () => {
    route.pathname = `${base}/customers/c1`;
    render(<Shell withAccess={false}><PageLocationRecords records={{ customerId: { state: 'ready', label: 'Acme Ltd' } }} /></Shell>);
    expect(trail()).toEqual(['CRM', 'Customers', 'Acme Ltd']);
    // CRM's Home and Customers are kernel destinations: no entitlement or permission gates them.
    expect(bar().getByRole('link', { name: 'CRM' })).toHaveAttribute('href', `${base}/sales`);
    expect(bar().getByRole('link', { name: 'Customers' })).toHaveAttribute('href', `${base}/customers`);
  });

  it('never shows a second, page-authored trail on a resolver-owned route', () => {
    route.pathname = `${base}/customers`;
    render(<Shell><CollectionHeader location={{}} /><PageCrumbs crumbs={[{ label: 'Somewhere else', href: '/x' }]} current="Competing" /></Shell>);
    expect(screen.getAllByRole('navigation', { name: 'breadcrumb' })).toHaveLength(1);
    expect(screen.queryByText('Competing')).toBeNull();
  });
});

describe('a Customer record', () => {
  it('names the record from the label the page was allowed to read, and goes up to Customers', () => {
    route.pathname = `${base}/customers/c1`;
    render(<Shell><RecordHeader location={{ records: { customerId: { state: 'ready', label: 'Acme Ltd' } } }} summary="Relationship stage: Lead" /></Shell>);
    expect(trail()).toEqual(['CRM', 'Customers', 'Acme Ltd']);
    expect(bar().getByRole('link', { name: 'Customers' })).toHaveAttribute('href', `${base}/customers`);
    expect(bar().getByRole('link', { name: 'Back to parent' })).toHaveAttribute('href', `${base}/customers`);
    expect(screen.getAllByRole('heading', { level: 1 }).map((heading) => heading.textContent)).toEqual(['Acme Ltd']);
    expect(screen.getByText('Relationship stage: Lead')).toBeVisible();
  });

  it('says the record is loading only when a loading boundary says so', () => {
    route.pathname = `${base}/customers/c1`;
    render(<Shell><PageLocationRecords records={{ customerId: { state: 'loading' } }} /></Shell>);
    expect(trail()).toEqual(['CRM', 'Customers', 'Loading…']);
  });

  it('falls back to the record’s kind for a label nobody handed up, and reports it in development', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      route.pathname = `${base}/customers/c1`;
      render(<Shell><LocationHeading /></Shell>);
      expect(trail()).toEqual(['CRM', 'Customers', 'Customer']);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Customer');
      expect(screen.queryByText('Loading…')).toBeNull();
      act(() => { vi.advanceTimersByTime(1500); });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('customerId'));
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('does not report a page that hands up its label before the diagnostic delay', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      route.pathname = `${base}/customers/c1`;
      render(<Shell><PageLocationRecords records={{ customerId: { state: 'ready', label: 'Acme Ltd' } }} /></Shell>);
      act(() => { vi.advanceTimersByTime(1500); });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('ends at Not found for a missing or undisclosed record', () => {
    route.pathname = `${base}/customers/c1`;
    render(<Shell><PageLocationRecords records={{ customerId: { state: 'missing' } }} /></Shell>);
    expect(trail()).toEqual(['CRM', 'Customers', 'Not found']);
  });

  it('never carries one record’s name to the next record’s address', () => {
    route.pathname = `${base}/customers/c1`;
    const view = render(<Shell><PageLocationRecords records={{ customerId: { state: 'ready', label: 'Acme Ltd' } }} /></Shell>);
    route.pathname = `${base}/customers/c2`;
    view.rerender(<Shell />);
    expect(trail()).toEqual(['CRM', 'Customers', 'Customer']);
    expect(screen.queryByText('Acme Ltd')).toBeNull();
  });

  it('marks the current record as the page, never as a link', () => {
    route.pathname = `${base}/customers/c1`;
    render(<Shell><PageLocationRecords records={{ customerId: { state: 'ready', label: 'Acme Ltd' } }} /></Shell>);
    const current = within(bar().getByRole('navigation', { name: 'breadcrumb' })).getByText('Acme Ltd');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current.closest('a')).toBeNull();
  });
});

describe('one location for the bar, phone Up and heading', () => {
  /** What the person meets: the bar's current page, the phone's Up target and the page's one heading. */
  function outputs() {
    const current = within(bar().getByRole('navigation', { name: 'breadcrumb' })).queryAllByText((_, element) => element?.getAttribute('aria-current') === 'page' && element.tagName === 'SPAN')[0]?.textContent ?? null;
    const up = bar().queryByRole('link', { name: 'Back to parent' })?.getAttribute('href') ?? null;
    const headings = screen.queryAllByRole('heading', { level: 1 }).map((heading) => heading.textContent);
    return { current, up, headings };
  }

  it('agrees through loading, the resolved record, a rapid move to another record and a missing one', () => {
    route.pathname = `${base}/customers/c1`;
    const view = render(<Shell><PageLocationRecords records={{ customerId: { state: 'loading' } }} /><LocationHeading /></Shell>);
    expect(outputs()).toEqual({ current: 'Loading…', up: `${base}/customers`, headings: ['Loading…'] });

    view.rerender(<Shell><PageLocationRecords records={{ customerId: { state: 'ready', label: 'Acme Ltd' } }} /><LocationHeading /></Shell>);
    expect(outputs()).toEqual({ current: 'Acme Ltd', up: `${base}/customers`, headings: ['Acme Ltd'] });

    route.pathname = `${base}/customers/c2`;
    view.rerender(<Shell><PageLocationRecords records={{ customerId: { state: 'ready', label: 'Bravo Services' } }} /><LocationHeading /></Shell>);
    expect(outputs()).toEqual({ current: 'Bravo Services', up: `${base}/customers`, headings: ['Bravo Services'] });

    route.pathname = `${base}/customers/c3`;
    view.rerender(<Shell><PageLocationRecords records={{ customerId: { state: 'missing' } }} /><LocationHeading /></Shell>);
    expect(outputs()).toEqual({ current: 'Not found', up: `${base}/customers`, headings: ['Not found'] });
  });

  it('agrees when the organization changes, and never carries the other business’s record', () => {
    route.pathname = `${base}/customers/c1`;
    const view = render(<Shell><PageLocationRecords records={{ customerId: { state: 'ready', label: 'Acme Ltd' } }} /><LocationHeading /></Shell>);
    const other = '22222222-2222-4222-8222-222222222222';
    route.pathname = `/organizations/${other}/customers`;
    view.rerender(<Shell><LocationHeading /></Shell>);
    expect(outputs()).toEqual({ current: 'Customers', up: `/organizations/${other}/sales`, headings: ['Customers'] });
    expect(screen.queryByText('Acme Ltd')).toBeNull();
  });

  it('places a refused Follow-ups page inside CRM', () => {
    route.pathname = `${base}/follow-ups`;
    render(<Shell><PageLocationRecords notFound /></Shell>);
    expect(trail()).toEqual(['CRM', 'Not found']);
  });

  it('renders no resolver heading on a route that still publishes its own', () => {
    route.pathname = `${base}/opportunities/pipeline`;
    render(<Shell><LocationHeading /></Shell>);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });
});

describe('unmigrated routes', () => {
  it('keep the trail their page publishes', () => {
    route.pathname = `${base}/calls`;
    render(<Shell><PageCrumbs crumbs={[{ label: 'Communications', href: `${base}/comms` }]} current="Dialer" /></Shell>);
    expect(trail()).toEqual(['Communications', 'Dialer']);
  });
});
