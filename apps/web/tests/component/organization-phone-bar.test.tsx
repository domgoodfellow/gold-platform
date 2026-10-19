// @vitest-environment jsdom
import { cleanup, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceRailProvider, useWorkspaceRail } from '@/components/panels/workspace-right-rail';
import { OrgSidebar, LockedOrgSidebar } from '@/app/organizations/[organizationId]/org-shell';
import { AppShell } from '@/components/layout/app-shell';
import { WorkspaceHeader } from '@/components/headers/workspace-header';
import { TooltipProvider } from '@gold/ui/components/tooltip';
import type { ShellSection } from '@/lib/shell';

const route = vi.hoisted(() => ({ pathname: '/organizations/org-1/home' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
const sections: ShellSection[] = [
  { key: 'home', label: null, items: [{ key: 'home', label: 'Home', href: '/organizations/org-1/home', section: 'home' }] },
];
const organizations = [
  { id: 'org-1', name: 'Current business', role: 'Owner', operationalState: 'live' as const },
  { id: 'org-2', name: 'Authorized business', role: 'Member', operationalState: 'setup' as const },
];
beforeEach(() => {
  route.pathname = '/organizations/org-1/home';
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function AgentState() {
  const { agentOpen } = useWorkspaceRail();
  return <output data-testid="agent-open">{String(agentOpen)}</output>;
}
function Harness({ locked = false, choices = organizations }) {
  const shared = { mark: null, name: 'Current business', role: 'Owner', organizations: choices, email: 'owner@example.test', signOutAction: vi.fn() };
  return <TooltipProvider><WorkspaceRailProvider>
    <AppShell header={<WorkspaceHeader navigationTrigger="always" agentTrigger="md" />}
      sidebar={locked
        ? <LockedOrgSidebar {...shared} organizationId="org-1" />
        : <OrgSidebar {...shared} organizationId="org-1" current={{ kind: 'business', organizationId: 'org-1', name: shared.name, role: shared.role }} sections={sections} />}>
      <AgentState />
    </AppShell>
  </WorkspaceRailProvider></TooltipProvider>;
}
async function open() {
  await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
  return screen.getByRole('dialog');
}
describe('the organization mobile menu', () => {
  it('opens from the header, dismisses with Escape, and restores focus', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Menu' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await open();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it('opens the existing Agent controller and closes navigation', async () => {
    render(<Harness />);
    const sheet = await open();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Agent' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('agent-open')).toHaveTextContent('true');
  });
  it('closes on an already current navigation destination and history changes', async () => {
    const view = render(<Harness />);
    await open();
    await userEvent.click(screen.getByRole('link', { name: 'Home' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await open();
    route.pathname = '/organizations/org-1/sales';
    view.rerender(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('lists only supplied memberships and closes on authorized context selection', async () => {
    render(<Harness />);
    const sheet = await open();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Current business' }));
    const destination = screen.getByRole('menuitem', { name: /Authorized business/ });
    expect(destination).toHaveAttribute('href', '/organizations/org-2/home');
    expect(screen.queryByRole('menuitem', { name: 'Platform' })).not.toBeInTheDocument();
    await userEvent.click(destination);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('offers no interactive mobile switcher in a locked shell', async () => {
    render(<Harness locked />);
    const sheet = await open();
    const identity = sheet.querySelector('[data-sidebar="header"]') as HTMLElement;
    expect(identity).toHaveTextContent('Current business');
    // jsdom has no responsive CSS; only the desktop switcher may exist in the hidden desktop region.
    expect(identity.querySelector('.md\\:hidden button')).toBeNull();
    expect(identity.querySelector('.hidden.md\\:block')).not.toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Agent' })).not.toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Plan & usage' })).toBeInTheDocument();
  });
  it('keeps a single organization without alternatives noninteractive', async () => {
    render(<Harness choices={[organizations[0]]} />);
    const sheet = await open();
    expect(within(sheet).queryByRole('button', { name: 'Current business' })).not.toBeInTheDocument();
  });
});
