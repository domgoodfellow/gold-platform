// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarMenu, SidebarProvider } from '@gold/ui/components/sidebar';
import { TooltipProvider } from '@gold/ui/components/tooltip';
import { LibraryMenu } from '@/features/library/library-nav';
import { LIBRARY_SECTIONS } from '@/lib/route/library';

const route = vi.hoisted(() => ({ pathname: '/organizations/org/files' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a> }));

function renderMenu() {
  return render(
    <TooltipProvider>
      <SidebarProvider>
        <SidebarMenu>
          <LibraryMenu organizationId="org" />
        </SidebarMenu>
      </SidebarProvider>
    </TooltipProvider>,
  );
}

describe('Library popover in the primary sidebar', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })) });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('is a trigger, not a link to a Library overview', () => {
    renderMenu();
    expect(screen.getByRole('button', { name: 'Library' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Library' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Library destinations' })).not.toBeInTheDocument();
  });

  it('opens an anchored popover of the registry destinations, each a direct link', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole('button', { name: 'Library' }));
    const menu = await screen.findByRole('navigation', { name: 'Library destinations' });
    const links = within(menu).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(LIBRARY_SECTIONS.map((section) => section.label));
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      LIBRARY_SECTIONS.map((section) => `/organizations/org/library/${section.path}`),
    );
  });

  it('closes the popover when the trigger is pressed again', async () => {
    const user = userEvent.setup();
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Library' });
    await user.click(trigger);
    await screen.findByRole('navigation', { name: 'Library destinations' });
    await user.click(trigger);
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Library destinations' })).not.toBeInTheDocument());
  });

  it('marks the destination whose route is selected, Imports included under Sources', async () => {
    const user = userEvent.setup();
    route.pathname = '/organizations/org/library/imports/run-1';
    renderMenu();
    expect(screen.getByRole('button', { name: 'Library' })).toHaveAttribute('data-active', 'true');
    await user.click(screen.getByRole('button', { name: 'Library' }));
    const menu = await screen.findByRole('navigation', { name: 'Library destinations' });
    expect(within(menu).getByRole('link', { name: 'Sources' })).toHaveAttribute('aria-current', 'page');
    expect(within(menu).getByRole('link', { name: 'Files' })).not.toHaveAttribute('aria-current');
    route.pathname = '/organizations/org/files';
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Library' });
    await user.click(trigger);
    await screen.findByRole('navigation', { name: 'Library destinations' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Library destinations' })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('is reachable by keyboard: Enter opens it on the current destination, and Tab moves through the rest', async () => {
    const user = userEvent.setup();
    route.pathname = '/organizations/org/library/media';
    renderMenu();
    screen.getByRole('button', { name: 'Library' }).focus();
    await user.keyboard('{Enter}');
    const menu = await screen.findByRole('navigation', { name: 'Library destinations' });
    await waitFor(() => expect(within(menu).getByRole('link', { name: 'Media' })).toHaveFocus());
    await user.tab();
    expect(within(menu).getByRole('link', { name: 'Templates' })).toHaveFocus();
    route.pathname = '/organizations/org/files';
  });
});
