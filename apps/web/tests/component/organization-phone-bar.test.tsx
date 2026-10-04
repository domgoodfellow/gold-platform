// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarProvider } from '@gold/ui/components/sidebar';
import { WorkspaceRailProvider, useWorkspaceRail } from '@/components/panels/workspace-right-rail';
import { OrgNavBar } from '@/app/organizations/[organizationId]/org-shell';
import type { ShellSection } from '@/lib/shell';

vi.mock('next/navigation', () => ({
  usePathname: () => '/organizations/org-1/home',
}));

/**
 * The phone bar's rendered behavior: exactly Home, AI and Menu, over the real Agent rail state and the
 * real `SidebarProvider`. Which items exist is `projectShell`'s answer and is held by
 * `shell-projection.test.ts`; this proves only what the bar does with them. Layout (equal cells, no
 * scrolling, sitting above the Agent panel) is not computed by jsdom and is checked in the browser.
 */

const sections: ShellSection[] = [
  { key: 'home', label: null, items: [{ key: 'home', label: 'Home', href: '/organizations/org-1/home', section: 'home' }] },
  {
    key: 'workspaces',
    label: 'Workspaces',
    items: [
      { key: 'customers', label: 'Customers', href: '/organizations/org-1/customers', section: 'workspaces' },
      { key: 'work', label: 'Work', href: '/organizations/org-1/work', section: 'workspaces' },
      { key: 'schedule', label: 'Schedule', href: '/organizations/org-1/schedule', section: 'workspaces' },
    ],
  },
];

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

afterEach(cleanup);

function AgentState() {
  const { agentOpen } = useWorkspaceRail();
  return <output data-testid="agent-open">{String(agentOpen)}</output>;
}

function Harness() {
  return (
    <WorkspaceRailProvider>
      <SidebarProvider>
        <OrgNavBar sections={sections} />
        <AgentState />
      </SidebarProvider>
    </WorkspaceRailProvider>
  );
}

describe('the organization phone bar', () => {
  it('has exactly Home, AI and Menu, and no workspace page as a persistent control', () => {
    render(<Harness />);
    const bar = screen.getByRole('navigation', { name: 'This business' });

    expect(within(bar).getAllByRole('link').map((link) => link.textContent)).toEqual(['Home']);
    expect(within(bar).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['AI', 'Menu']);
    for (const name of ['Customers', 'Work', 'Schedule']) {
      expect(within(bar).queryByText(name)).not.toBeInTheDocument();
    }
  });

  it('Home links to the projected Home item', () => {
    render(<Harness />);
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/organizations/org-1/home');
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  });

  it('AI toggles the existing Agent state and shows it as pressed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const ai = screen.getByRole('button', { name: 'AI' });

    expect(ai).toHaveAttribute('aria-pressed', 'false');
    await user.click(ai);
    expect(ai).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('agent-open')).toHaveTextContent('true');
    await user.click(ai);
    expect(ai).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('agent-open')).toHaveTextContent('false');
  });

  it('Menu toggles the sidebar’s mobile Sheet state', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const menu = screen.getByRole('button', { name: 'Menu' });

    expect(menu).toHaveAttribute('aria-expanded', 'false');
    await user.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    await user.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'false');
  });
});
