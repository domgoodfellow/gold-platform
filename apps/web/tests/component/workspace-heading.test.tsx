// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarProvider } from '@gold/ui/components/sidebar';
import { TooltipProvider } from '@gold/ui/components/tooltip';
import { OrgNav } from '@/app/organizations/[organizationId]/org-shell';
import { WorkspaceCrumbsProvider, WorkspaceCrumbSlot, PageCrumbs } from '@/components/navigation/workspace-crumbs';
import { AREAS } from '@/lib/navigation';
import { projectShell } from '@/lib/shell';
import { ALL_CAPABILITIES, type Capability } from '@/lib/domain/tenancy/capabilities';

/**
 * The workspace Home contract as it renders (ADR-047): inside an entered workspace the heading is
 * the way to its Home, no Overview child repeats it, and a configuration-only member gets no
 * operating Home link. Written from the contract, not from the implementation's output.
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
const sections = (capabilities: readonly Capability[] = ALL_CAPABILITIES, modules: string[] = ['reception', 'billing', 'automations', 'assets']) =>
  projectShell({ organizationId: org, enabledModules: new Set(modules), featureAvailability: new Set(AREAS.flatMap((area) => area.featureKeys ?? [])), capabilities: new Set(capabilities), schedulableWork: true });
const sidebar = (projected = sections()) => render(<TooltipProvider><SidebarProvider><OrgNav sections={projected} organizationId={org} /></SidebarProvider></TooltipProvider>);
const nav = () => within(screen.getByRole('navigation', { name: 'This business' }));

describe('the entered workspace heading', () => {
  it.each([
    ['CRM', '/sales', '/customers', 'Customers'],
    ['Communications', '/comms', '/calls', 'Dialer'],
    ['Work', '/field', '/work', 'Work items'],
    ['Support', '/support', '/support/cases', 'Cases'],
    ['Studio', '/studio', '/studio/forms', 'Forms'],
  ])('%s: the heading opens its Home, is current there, and no Overview child repeats it', (label, home, child, childLabel) => {
    route.pathname = `${base}${home}`;
    const view = sidebar();
    const heading = nav().getByRole('link', { name: `${label} home` });
    expect(heading).toHaveAttribute('href', `${base}${home}`);
    expect(heading).toHaveAttribute('aria-current', 'page');
    expect(nav().queryByRole('link', { name: 'Overview' })).toBeNull();
    // No other link in the workspace repeats the Home route.
    expect(nav().getAllByRole('link').filter((link) => link.getAttribute('href') === `${base}${home}`)).toHaveLength(1);

    route.pathname = `${base}${child}`;
    view.rerender(<TooltipProvider><SidebarProvider><OrgNav sections={sections()} organizationId={org} /></SidebarProvider></TooltipProvider>);
    expect(nav().getByRole('link', { name: `${label} home` })).not.toHaveAttribute('aria-current');
    expect(nav().getByRole('link', { name: childLabel })).toHaveAttribute('aria-current', 'page');
  });

  it('keeps the hierarchy: outside a workspace the directory lists workspaces, not their pages', () => {
    route.pathname = `${base}/home`;
    sidebar();
    expect(nav().getByRole('link', { name: 'CRM' })).toHaveAttribute('href', `${base}/sales`);
    for (const page of ['Customers', 'Dialer', 'Cases', 'Overview']) expect(nav().queryByRole('link', { name: page })).toBeNull();
    expect(nav().queryByRole('link', { name: 'CRM home' })).toBeNull();
  });

  it('leaves through organization Home, and the heading is reachable by keyboard', async () => {
    route.pathname = `${base}/customers`;
    sidebar();
    expect(nav().getByRole('link', { name: 'Home' })).toHaveAttribute('href', `${base}/home`);
    const user = userEvent.setup();
    const order: string[] = [];
    for (let press = 0; press < 12; press++) {
      await user.tab();
      const name = document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '';
      order.push(name.trim());
    }
    expect(order).toContain('CRM home');
    expect(order.indexOf('CRM home')).toBeLessThan(order.indexOf('Customers'));
  });

  it('gives a configuration-only member no operating Home link, and its configuration stays reachable', () => {
    route.pathname = `${base}/comms/configuration/calling`;
    sidebar(sections(['field.manage']));
    expect(nav().queryByRole('link', { name: 'Communications home' })).toBeNull();
    expect(nav().queryByRole('link', { name: 'Dialer' })).toBeNull();
    expect(nav().getByText('Communications')).toBeInTheDocument();
    expect(nav().getByRole('link', { name: 'Calling & routing' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('the heading is a distinct level, expanded and collapsed', () => {
  it.each([true, false])('sets the heading apart from its pages with sidebar open=%s', (open) => {
    route.pathname = `${base}/customers`;
    render(<TooltipProvider><SidebarProvider defaultOpen={open}><OrgNav sections={sections()} organizationId={org} /></SidebarProvider></TooltipProvider>);
    const heading = nav().getByRole('link', { name: 'CRM home' });
    const customers = nav().getByRole('link', { name: 'Customers' });
    // Workspace and child glyphs inherit the same row geometry.
    expect(heading.querySelector(':scope > svg[data-workspace-icon]')).not.toBeNull();
    expect(heading.querySelector('[data-workspace-tile]')).toBeNull();
    expect(customers.querySelector('[data-workspace-tile]')).toBeNull();
    // A divider separates the heading row from the workspace's pages.
    expect(heading.closest('[data-workspace-heading]')).not.toBeNull();
    expect(customers.closest('[data-workspace-heading]')).toBeNull();
    // On a page, the heading is neither current nor drawn as selected; the page is.
    expect(heading).not.toHaveAttribute('aria-current');
    expect(heading).toHaveAttribute('data-active', 'false');
    expect(customers).toHaveAttribute('data-active', 'true');
  });
});

describe('the phone location menu', () => {
  const navigation = { organizationId: org, sections: sections() };
  function Location({ current }: { current: string }) {
    return <WorkspaceCrumbsProvider navigation={navigation}><WorkspaceCrumbSlot /><PageCrumbs crumbs={[]} current={current} /></WorkspaceCrumbsProvider>;
  }

  it('reaches the workspace Home from its heading, marked current on the Home', async () => {
    route.pathname = `${base}/support`;
    render(<Location current="Support" />);
    await userEvent.click(screen.getByRole('button', { name: 'Navigate within current section' }));
    const home = screen.getByRole('menuitem', { name: 'Support home' });
    expect(home).toHaveAttribute('href', `${base}/support`);
    expect(home).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('menuitem', { name: 'Overview' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Cases' })).not.toHaveAttribute('aria-current');
  });
});
