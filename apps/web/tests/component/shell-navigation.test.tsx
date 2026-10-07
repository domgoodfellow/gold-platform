// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@gold/ui/components/tooltip';
import { CompactContextSwitcher } from '@/components/navigation/context-switcher';
import { WorkspaceHeader } from '@/components/headers/workspace-header';
import { WorkspaceRailProvider } from '@/components/panels/workspace-right-rail';

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
