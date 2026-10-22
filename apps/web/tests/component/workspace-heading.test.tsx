// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarProvider } from '@gold/ui/components/sidebar';
import { TooltipProvider } from '@gold/ui/components/tooltip';
import { OrgNav } from '@/app/organizations/[organizationId]/org-shell';
import { WorkspaceCrumbsProvider, WorkspaceCrumbSlot, PageCrumbs } from '@/components/navigation/workspace-crumbs';
import { AREAS, WORKSPACES, areaHref } from '@/lib/navigation';
import { projectShell } from '@/lib/shell';
import { ALL_CAPABILITIES, type Capability } from '@/lib/domain/tenancy/capabilities';

/** Dashboard is a real destination; workspace identity never competes with it (ADR-049). */
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
const sections = (capabilities: readonly Capability[] = ALL_CAPABILITIES) => projectShell({ organizationId: org, enabledModules: new Set(['reception', 'billing', 'automations', 'assets']), featureAvailability: new Set(AREAS.flatMap(area => area.featureKeys ?? [])), capabilities: new Set(capabilities), schedulableWork: true });
const nav = () => within(screen.getByRole('navigation', { name: 'This business' }));
describe('explicit Dashboard navigation', () => {
  it.each(WORKSPACES.flatMap(workspace => [true,false].map(open => ({workspace,open}))))('keeps $workspace.label identity separate from Dashboard with sidebar open=$open', ({workspace,open}) => {
    route.pathname = areaHref(org, workspace.home);
    render(<TooltipProvider><SidebarProvider defaultOpen={open}><OrgNav sections={sections()} organizationId={org} /></SidebarProvider></TooltipProvider>);
    const dashboard = nav().getByRole('link', { name: 'Dashboard' });
    expect(dashboard).toHaveAttribute('href', areaHref(org, workspace.home));
    expect(dashboard).toHaveAttribute('aria-current', 'page');
    expect(dashboard.querySelector('svg')).toHaveClass('lucide-gauge');
    expect(nav().queryByRole('link', { name: 'CRM home' })).toBeNull();
    const heading = nav().getByLabelText(workspace.label);
    expect(heading.closest('[data-workspace-heading]')).not.toBeNull();
    expect(heading).not.toHaveAttribute('href');
    expect(heading).not.toHaveAttribute('aria-current');
    expect(nav().getAllByRole('link').filter(link => link.getAttribute('href') === areaHref(org, workspace.home))).toHaveLength(1);
  });
  it('offers Dashboard before operational pages in keyboard order', async () => {
    route.pathname = `${base}/crm/contacts`;
    render(<TooltipProvider><SidebarProvider><OrgNav sections={sections()} organizationId={org} /></SidebarProvider></TooltipProvider>);
    const user = userEvent.setup();
    const order: string[] = [];
    for (let press = 0; press < 12; press++) { await user.tab(); order.push(document.activeElement?.textContent?.trim() ?? ''); }
    expect(order).toContain('Dashboard');
    expect(order.indexOf('Dashboard')).toBeLessThan(order.indexOf('Contacts'));
    expect(nav().getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });
  it('does not grant a configuration-only member dashboard access', () => {
    route.pathname = `${base}/comms/configuration/calling`;
    render(<TooltipProvider><SidebarProvider><OrgNav sections={sections(['field.manage'])} organizationId={org} /></SidebarProvider></TooltipProvider>);
    expect(nav().queryByRole('link', { name: 'Dashboard' })).toBeNull();
    expect(nav().getByLabelText('Communications')).not.toHaveAttribute('href');
    expect(nav().getByRole('link', { name: 'Calling & routing' })).toHaveAttribute('aria-current', 'page');
  });
  it('offers the same explicit Dashboard in the phone location menu', async () => {
    route.pathname = `${base}/support`;
    render(<WorkspaceCrumbsProvider navigation={{ organizationId: org, sections: sections() }}><WorkspaceCrumbSlot /><PageCrumbs crumbs={[]} current="Dashboard" /></WorkspaceCrumbsProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Navigate within current section' }));
    expect(screen.getByRole('menuitem', { name: 'Dashboard' })).toHaveAttribute('href', `${base}/support`);
    expect(screen.getByRole('menuitem', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('menuitem', { name: 'Support home' })).toBeNull();
  });
});
