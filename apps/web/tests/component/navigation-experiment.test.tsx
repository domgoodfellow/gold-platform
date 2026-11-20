// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarProvider } from '@gold/ui/components/sidebar';
import { TooltipProvider } from '@gold/ui/components/tooltip';
import { WorkspaceCrumbsProvider } from '@/components/navigation/workspace-crumbs';
import { ApplyNavigationLayout } from '@/features/studio/interface/navigation-experiment';
import { NavigationExperimentView } from '@/app/organizations/[organizationId]/studio/interface/navigation/navigation-experiment-view';
import { AREAS } from '@/lib/navigation';
import { projectShell, withAdministration, withInterfaceDesign } from '@/lib/shell';
import { interfaceDesignHref } from '@/lib/interface-design';
import { PLATFORM_CAPABILITIES } from '@/lib/domain/platform/permissions';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';

/** ADR-056: Studio's navigation experiment draws the real projection and changes only this person's session. */
const org = '11111111-1111-4111-8111-111111111111';
const base = `/organizations/${org}`;
const route = vi.hoisted(() => ({ pathname: '' }));
const action = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a> }));
vi.mock('@/app/organizations/[organizationId]/studio/interface/navigation/actions', () => ({ setNavigationLayoutAction: action }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeEach(() => {
  route.pathname = interfaceDesignHref(org);
  action.mockReset();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const sections = withInterfaceDesign(withAdministration(projectShell({ organizationId: org, enabledModules: new Set(['reception', 'billing', 'automations', 'assets']), featureAvailability: new Set(AREAS.flatMap((area) => area.featureKeys ?? [])), capabilities: new Set(ALL_CAPABILITIES), schedulableWork: true }), org, new Set(PLATFORM_CAPABILITIES)), org);
const experiment = (applied: 'contextual' | 'unified' = 'contextual') => (
  <TooltipProvider><SidebarProvider><WorkspaceCrumbsProvider navigation={{ organizationId: org, sections }}>
    <ApplyNavigationLayout organizationId={org} applied={applied} />
    <NavigationExperimentView organizationId={org} applied={applied} />
  </WorkspaceCrumbsProvider></SidebarProvider></TooltipProvider>
);

describe('the Studio navigation experiment', () => {
  it('draws both layouts from the projection at the same simulated address', () => {
    render(experiment());
    const current = within(screen.getByRole('navigation', { name: 'Current navigation preview' }));
    const unified = within(screen.getByRole('navigation', { name: 'Unified navigation preview' }));
    // At this page both draw Studio as an entered context, with the staff-only Navigation entry selected.
    expect(current.getByRole('link', { name: 'Navigation' })).toHaveAttribute('aria-current', 'page');
    expect(unified.getByRole('link', { name: 'Navigation' })).toHaveAttribute('aria-current', 'page');
    expect(unified.getByRole('link', { name: 'Overview' })).toHaveAttribute('href', `${base}/studio`);
    expect(screen.getByRole('group', { name: 'Layouts' })).toBeInTheDocument();
  });

  it('follows a link inside the preview without leaving the page', async () => {
    const user = userEvent.setup();
    render(experiment());
    const unified = () => within(screen.getByRole('navigation', { name: 'Unified navigation preview' }));
    await user.click(unified().getByRole('link', { name: 'Home' }));
    await user.click(unified().getByRole('link', { name: 'CRM' }));
    expect(unified().getByRole('link', { name: 'CRM' })).toHaveAttribute('aria-current', 'page');
    // The contextual preview follows the same simulated address: CRM is entered, Dashboard selected.
    expect(within(screen.getByRole('navigation', { name: 'Current navigation preview' })).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    await user.click(unified().getByRole('button', { name: 'Expand Support' }));
    await user.click(unified().getByRole('link', { name: 'Cases' }));
    expect(unified().getByRole('link', { name: 'Cases' })).toHaveAttribute('aria-current', 'page');
    expect(route.pathname).toBe(interfaceDesignHref(org));
  });

  it('shows one layout at a time on request, and the phone width in its own viewport', async () => {
    const user = userEvent.setup();
    render(experiment());
    await user.click(screen.getByRole('button', { name: 'Unified' }));
    expect(screen.queryByRole('navigation', { name: 'Current navigation preview' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Phone' }));
    expect(screen.getByTitle('Unified navigation preview').tagName).toBe('IFRAME');
  });

  it('applies the unified layout to this session, and returns from it in one action', async () => {
    const user = userEvent.setup();
    action.mockResolvedValue({ ok: true, layout: 'unified' });
    const { rerender } = render(experiment());
    await user.click(screen.getByRole('button', { name: 'Use unified navigation' }));
    await waitFor(() => expect(action).toHaveBeenCalledWith(org, 'unified'));
    rerender(experiment('unified'));
    expect(within(screen.getByRole('region', { name: /Unified/ })).getByText('In use')).toBeInTheDocument();
    action.mockResolvedValue({ ok: true, layout: 'contextual' });
    await user.click(screen.getByRole('button', { name: 'Return to current navigation' }));
    await waitFor(() => expect(action).toHaveBeenLastCalledWith(org, 'contextual'));
  });
});
