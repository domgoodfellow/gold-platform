// @vitest-environment jsdom
import { useEffect, type ReactNode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarProvider } from '@gold/ui/components/sidebar';
import { NavigationActivityContext } from '@/components/navigation/activity-context';
import { AccountMenu } from '@/components/navigation/account-menu';
import { SettingsNav } from '@/components/navigation/settings-nav';
import { projectSettingsNav } from '@/lib/settings-nav';
import { OrgNav } from '@/app/organizations/[organizationId]/org-shell';
import { TelephoneDeviceProvider, useTelephoneDevice } from '@/features/communications/voice/telephone-device';
import { projectShell } from '@/lib/shell';
import { AREAS } from '@/lib/navigation';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { TooltipProvider } from '@gold/ui/components/tooltip';
import { CompactContextSwitcher } from '@/components/navigation/context-switcher';
import { WorkspaceCrumbsProvider, WorkspaceCrumbSlot, PageCrumbs } from '@/components/navigation/workspace-crumbs';
import { WorkspaceHeader } from '@/components/headers/workspace-header';
import { WorkspaceRailProvider } from '@/components/panels/workspace-right-rail';

const route = vi.hoisted(() => ({ pathname: '/organizations/11111111-1111-4111-8111-111111111111/home' }));
const telephone = vi.hoisted(() => ({ created: vi.fn(), destroyed: vi.fn() }));
vi.mock('@/app/organizations/[organizationId]/calls/conference-actions', () => ({
  mintBrowserTokenAction: vi.fn().mockResolvedValue({ ok: true, data: { token: 'offline-test-token' } }),
}));
vi.mock('@twilio/voice-sdk', () => ({ Device: class {
  handlers = new Map<string, () => void>();
  constructor() { telephone.created(); }
  on(event: string, handler: () => void) { this.handlers.set(event, handler); }
  async register() { this.handlers.get('registered')?.(); }
  async connect() { return { on: vi.fn(), disconnect: vi.fn() }; }
  destroy() { telephone.destroyed(); }
} }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a> }));
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const gold = { id: 'gold', name: 'GildOps', role: 'Owner', operationalState: 'live' as const };
const pneu = { id: 'pneu', name: 'Pneu3L', role: 'Admin', operationalState: 'live' as const };
const platform = { organizationId: 'gold', href: '/organizations/gold/platform' };

describe('business and system context menu', () => {
  it('groups businesses and the authorized Platform separately with canonical destinations', async () => {
    const user = userEvent.setup();
    render(<CompactContextSwitcher mark={<span>G</span>} current={{ kind: 'business', organizationId: 'gold', name: 'GildOps', role: 'Owner' }} organizations={[gold, pneu]} platform={platform} />);
    await user.click(screen.getByRole('button', { name: /Switch context/ }));
    expect(screen.getByText('Businesses')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Pneu3L/ })).toHaveAttribute('href', '/organizations/pneu/home');
    expect(screen.getByRole('menuitem', { name: 'Platform' })).toHaveAttribute('href', platform.href);
  });
  it('shows system scope and offers the GildOps operating business when Platform is active', async () => {
    const user = userEvent.setup();
    render(<CompactContextSwitcher mark={<span>G</span>} current={{ kind: 'platform', organizationId: 'gold' }} organizations={[gold, pneu]} platform={platform} />);
    await user.click(screen.getByRole('button', { name: /GildOps Platform/ }));
    expect(screen.getByText('System control plane')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /GildOps.*Owner/ })).toHaveAttribute('href', '/organizations/gold/home');
    expect(screen.getByRole('menuitem', { name: 'Platform' })).toHaveAttribute('aria-current', 'page');
  });
  it('an Owner with no resolved platform authority sees no System category', async () => {
    const user = userEvent.setup();
    render(<CompactContextSwitcher mark={<span>G</span>} current={{ kind: 'business', organizationId: 'gold', name: 'GildOps', role: 'Owner' }} organizations={[gold, pneu]} />);
    await user.click(screen.getByRole('button', { name: /Switch context/ }));
    expect(screen.queryByText('System')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Platform' })).not.toBeInTheDocument();
  });
});

describe('workspace header icon utilities', () => {
  it('keeps visible controls icon-only, accessible and keyboard operable', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <WorkspaceRailProvider>
          <WorkspaceHeader utilities={[
            { key: 'team', label: 'Team', href: '/organizations/gold/settings/access' },
            { key: 'connections', label: 'Connections', href: '/organizations/gold/settings/connections' },
          ]} />
        </WorkspaceRailProvider>
      </TooltipProvider>,
    );
    const team = screen.getByRole('link', { name: 'Team' });
    const connections = screen.getByRole('link', { name: 'Connections' });
    const agent = screen.getByRole('button', { name: 'Agent' });
    expect(agent).not.toHaveAttribute('href');
    expect(agent.querySelector('svg')).toHaveClass('lucide-bot');
    expect(screen.queryByRole('link', { name: 'Agent' })).not.toBeInTheDocument();
    for (const control of [team, connections, agent]) {
      expect(control.textContent).toBe('');
      expect(control.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      await user.tab();
      expect(control).toHaveFocus();
    }
    expect(team).toHaveAttribute('href', '/organizations/gold/settings/access');
    expect(connections).toHaveAttribute('href', '/organizations/gold/settings/connections');
    await user.keyboard('{Enter}');
    expect(agent).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard(' ');
    expect(agent).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
  });
});


describe('contextual sidebar rendering', () => {
  it('expands CRM Configuration, selects direct child links and keeps its parent navigable', async () => {
    const org = '11111111-1111-4111-8111-111111111111';
    const sections = projectShell({ organizationId: org, enabledModules: new Set(['reception']), featureAvailability: new Set(AREAS.flatMap(area => area.featureKeys ?? [])), capabilities: new Set(ALL_CAPABILITIES) });
    route.pathname = `/organizations/${org}/sales/configuration/relationship-stages`;
    render(<TooltipProvider><SidebarProvider><OrgNav sections={sections} /></SidebarProvider></TooltipProvider>);
    const parent = screen.getByRole('link', { name: 'Configuration' });
    expect(parent).toHaveAttribute('href', `/organizations/${org}/sales/configuration`);
    expect(parent).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Relationship stages' })).toHaveAttribute('aria-current', 'page');
    for (const name of ['Relationship stages', 'Opportunity stages', 'Customer fields']) expect(screen.getByRole('link', { name }).querySelector('svg')).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Collapse Configuration' }));
    expect(screen.queryByRole('link', { name: 'Customer fields' })).not.toBeInTheDocument();
    const expand = screen.getByRole('button', { name: 'Expand Configuration' });
    expand.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('link', { name: 'Customer fields' })).toHaveAttribute('href', `/organizations/${org}/sales/configuration/fields`);
  });

  it('changes navigation on route updates while retaining the registered telephone runtime', async () => {
    const org = '11111111-1111-4111-8111-111111111111';
    const sections = projectShell({ organizationId: org, enabledModules: new Set(['reception']), featureAvailability: new Set(AREAS.flatMap((area) => area.featureKeys ?? [])), capabilities: new Set(ALL_CAPABILITIES) });
    const mounted = vi.fn();
    const unmounted = vi.fn();
    function RuntimeProbe() {
      const device = useTelephoneDevice();
      useEffect(() => { mounted(); return unmounted; }, []);
      return <button data-testid="runtime" onClick={() => void device.connectToRoom('test-room', { callId: 'call-1', contactLabel: 'Local SDK fixture' })}>{device.status} {device.activeCall?.callId}</button>;
    }
    const view = () => <TelephoneDeviceProvider organizationId={org}><TooltipProvider><SidebarProvider><RuntimeProbe /><OrgNav sections={sections} /></SidebarProvider></TooltipProvider></TelephoneDeviceProvider>;
    route.pathname = `/organizations/${org}/home`;
    const { rerender } = render(view());
    telephone.created.mockClear();
    telephone.destroyed.mockClear();
    const runtime = screen.getByTestId('runtime');
    await userEvent.click(runtime);
    await waitFor(() => expect(runtime).toHaveTextContent('ready'));
    expect(screen.getByRole('link', { name: 'CRM' })).toHaveAttribute('href', `/organizations/${org}/sales`);
    expect(screen.queryByRole('link', { name: 'Customers' })).not.toBeInTheDocument();
    route.pathname = `/organizations/${org}/customers/123`;
    rerender(view());
    expect(screen.getByRole('link', { name: 'Customers' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Back to Workspaces' })).toHaveAttribute('href', `/organizations/${org}/home`);
    route.pathname = `/organizations/${org}/calls`;
    rerender(view());
    expect(screen.getByRole('link', { name: 'Calls' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: 'Customers' })).not.toBeInTheDocument();
    for (const path of ['comms/configuration/calling', 'settings/general']) { route.pathname = `/organizations/${org}/${path}`; rerender(view()); expect(runtime).toHaveTextContent('call-1'); }
    route.pathname = `/organizations/${org}/home`;
    rerender(view());
    expect(screen.getByRole('link', { name: 'Library' })).toBeInTheDocument();
    expect(screen.getByTestId('runtime')).toBe(runtime);
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
    expect(runtime).toHaveTextContent('ready call-1');
    expect(telephone.created).toHaveBeenCalledTimes(1);
    expect(telephone.destroyed).not.toHaveBeenCalled();
  });
});


describe('responsive breadcrumb interaction', () => {
  const org = '11111111-1111-4111-8111-111111111111';
  const base = `/organizations/${org}`;
  const navigation = { organizationId: org, sections: projectShell({ organizationId: org, enabledModules: new Set(['assets']), featureAvailability: new Set(AREAS.flatMap((area) => area.featureKeys ?? [])), capabilities: new Set(ALL_CAPABILITIES) }) };
  function Location({ current = 'Schedule' }: { current?: string }) {
    return <WorkspaceCrumbsProvider navigation={navigation}><WorkspaceCrumbSlot /><PageCrumbs crumbs={[{ label: 'Work', href: `${base}/field` }]} current={current} /></WorkspaceCrumbsProvider>;
  }
  it('shares page labels, links to a semantic parent, and marks the active destination', async () => {
    route.pathname = `${base}/schedule`;
    render(<Location />);
    expect(screen.getByRole('link', { name: 'Back to parent' })).toHaveAttribute('href', `${base}/field`);
    const trigger = screen.getByRole('button', { name: 'Navigate within current section' });
    await userEvent.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Schedule' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('menuitem', { name: 'Overview' })).toHaveAttribute('href', `${base}/field`);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
  it('closes the dropdown on route changes and does not add records to the menu', async () => {
    route.pathname = `${base}/assets/123`;
    const view = render(<Location current="A very long actual asset name" />);
    await userEvent.click(screen.getByRole('button', { name: 'Navigate within current section' }));
    expect(screen.queryByRole('menuitem', { name: 'A very long actual asset name' })).not.toBeInTheDocument();
    route.pathname = `${base}/resources`;
    view.rerender(<Location current="Resources" />);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
  it('does not render an empty dropdown or back arrow at organization Home', () => {
    route.pathname = `${base}/home`;
    render(<WorkspaceCrumbsProvider navigation={navigation}><WorkspaceCrumbSlot /><PageCrumbs crumbs={[]} current="Home" /></WorkspaceCrumbsProvider>);
    expect(screen.queryByRole('button', { name: 'Navigate within current section' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Back to parent' })).not.toBeInTheDocument();
  });
});


describe('persistent application controls and Settings', () => {
  const org = '11111111-1111-4111-8111-111111111111';
  const wrap = (children: ReactNode) => <TooltipProvider><SidebarProvider defaultOpen={false}>{children}</SidebarProvider></TooltipProvider>;
  it('keeps a live business activity in its tab when entering another organization Platform or personal Settings', async () => {
    const user = userEvent.setup();
    route.pathname = `/organizations/${org}/calls`;
    const platformOrganization = '22222222-2222-4222-8222-222222222222';
    render(wrap(<NavigationActivityContext.Provider value={true}><CompactContextSwitcher mark={<span>G</span>} current={{ kind: 'business', organizationId: org, name: 'Business', role: 'Owner' }} organizations={[]} platform={{organizationId: platformOrganization, href: `/organizations/${platformOrganization}/platform`}} /><SettingsNav organizationId={org} organizationName="Business" sections={projectSettingsNav(org, { capabilities: new Set(ALL_CAPABILITIES) })} search={[]} returnHrefs={[]} /></NavigationActivityContext.Provider>));
    await user.click(screen.getByRole('button', { name: /Switch context/ }));
    expect(screen.getByRole('menuitem', { name: 'Platform' })).toHaveAttribute('target', '_blank');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('link', { name: 'Appearance' })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'General' })).not.toHaveAttribute('target');
  });
  it('keeps Settings, Help, Contact Support and Sign out in the account menu, closed until opened', async () => {
    const user = userEvent.setup();
    route.pathname = `/organizations/${org}/calls`;
    const { rerender } = render(wrap(<AccountMenu email="person@example.test" signOutAction={vi.fn()} />));
    expect(screen.queryByRole('menuitem', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Platform|Help/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /person@example.test/ }));
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveAttribute('href', `/organizations/${org}/settings`);
    expect(screen.getByRole('menuitem', { name: 'Help & documentation' })).toHaveAttribute('href', `/organizations/${org}/help`);
    expect(screen.getByRole('menuitem', { name: 'Contact GildOps Support' })).toHaveAttribute('href', expect.stringContaining(`/organizations/${org}/help/contact`));
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Platform' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    rerender(wrap(<AccountMenu email="person@example.test" signOutAction={vi.fn()} locked />));
    await user.click(screen.getByRole('button', { name: /person@example.test/ }));
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveAttribute('href', `/organizations/${org}/settings/plan`);
  });
  it('offers only Settings and Sign out where no organization is in context', async () => {
    const user = userEvent.setup();
    route.pathname = '/settings/account';
    render(wrap(<AccountMenu email="person@example.test" signOutAction={vi.fn()} />));
    await user.click(screen.getByRole('button', { name: /person@example.test/ }));
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Help|Contact/ })).not.toBeInTheDocument();
  });
  it('renders every authorized Settings destination with a real icon and validates return paths', () => {
    route.pathname = `/settings/account/appearance`;
    const sections = projectSettingsNav(org, { capabilities: new Set(ALL_CAPABILITIES) });
    sessionStorage.setItem(`gildops.lastAppPath.${org}`, `/organizations/${org}/platform/providers`);
    const { rerender } = render(wrap(<SettingsNav organizationId={org} organizationName="Test" sections={sections} search={[]} returnHrefs={[`/organizations/${org}/calls`]} />));
    for (const item of sections.flatMap(section => section.items)) {
      const link = screen.getByRole('link', { name: item.label });
      expect(link).toHaveAttribute('href', item.href);
      expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
    expect(screen.getByRole('link', { name: 'Appearance' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Back to app' })).toHaveAttribute('href', `/organizations/${org}`);
    sessionStorage.setItem(`gildops.lastAppPath.${org}`, `/organizations/${org}/calls/record`);
    rerender(wrap(<SettingsNav organizationId={org} organizationName="Test" sections={sections} search={[]} returnHrefs={[`/organizations/${org}/calls`]} />));
    expect(screen.getByRole('link', { name: 'Back to app' })).toHaveAttribute('href', `/organizations/${org}/calls/record`);
  });
});
