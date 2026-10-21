// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@gold/ui/components/sidebar';
import { TooltipProvider } from '@gold/ui/components/tooltip';

/** The responsive sidebar contract: phone sheet, tablet icon rail with a temporary overlay, desktop dock. */

let width = 1440;
const listeners = new Set<() => void>();
function setWidth(next: number) {
  width = next;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: next });
  act(() => listeners.forEach((listener) => listener()));
}
function matchMedia(query: string) {
  const max = /max-width:\s*([\d.]+)px/.exec(query);
  const min = /min-width:\s*([\d.]+)px/.exec(query);
  const matches = () => (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]));
  return {
    get matches() { return matches(); }, media: query,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
}

function Shell({ defaultOpen, defaultViewport }: { defaultOpen?: boolean; defaultViewport?: 'phone' | 'tablet' | 'desktop' }) {
  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={defaultOpen} defaultViewport={defaultViewport}>
        <Sidebar collapsible="icon">
          <SidebarContent>
            <nav aria-label="This business">
              <SidebarMenu>
                <SidebarMenuItem><SidebarMenuButton asChild tooltip="Customers"><a href="/customers">Customers</a></SidebarMenuButton></SidebarMenuItem>
              </SidebarMenu>
            </nav>
          </SidebarContent>
        </Sidebar>
        <main><SidebarTrigger /><button type="button">Page action</button></main>
      </SidebarProvider>
    </TooltipProvider>
  );
}

const sidebar = () => document.querySelector('[data-slot="sidebar"]') as HTMLElement | null;
const cookie = (name: string) => document.cookie.split('; ').find((entry) => entry.startsWith(`${name}=`))?.split('=')[1];
function clearCookies() {
  for (const name of ['sidebar_state', 'sidebar_viewport']) document.cookie = `${name}=; path=/; max-age=0`;
}

beforeEach(() => {
  clearCookies();
  listeners.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(matchMedia) });
  setWidth(1440);
});
afterEach(() => { cleanup(); clearCookies(); vi.unstubAllGlobals(); });

describe('tablet (768–1279px)', () => {
  it.each([768, 820, 1024, 1279])('defaults to the collapsed icon rail at %ipx, whatever the desktop preference', (px) => {
    setWidth(px);
    render(<Shell defaultOpen />);
    expect(sidebar()).toHaveAttribute('data-state', 'collapsed');
    expect(sidebar()).toHaveAttribute('data-collapsible', 'icon');
    expect(sidebar()).not.toHaveAttribute('data-overlay', 'true');
  });

  it('expands as a temporary overlay that keeps the rail width for the page and is not saved', async () => {
    setWidth(1024);
    const user = userEvent.setup();
    render(<Shell defaultOpen={false} />);
    await user.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(sidebar()).toHaveAttribute('data-state', 'expanded');
    expect(sidebar()).toHaveAttribute('data-overlay', 'true');
    expect(screen.getByRole('button', { name: 'Toggle Sidebar' })).toHaveAttribute('aria-expanded', 'true');
    // The desktop preference is untouched by a tablet overlay.
    expect(cookie('sidebar_state')).toBeUndefined();
    // Focus moves into the navigation it opened.
    await waitFor(() => expect(screen.getByRole('link', { name: 'Customers' })).toHaveFocus());
  });

  it('Escape closes the overlay and returns focus to the toggle', async () => {
    setWidth(820);
    const user = userEvent.setup();
    render(<Shell />);
    await user.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    await user.keyboard('{Escape}');
    expect(sidebar()).toHaveAttribute('data-state', 'collapsed');
    expect(screen.getByRole('button', { name: 'Toggle Sidebar' })).toHaveFocus();
  });

  it('offers a visible Close navigation control that returns focus to the toggle', async () => {
    setWidth(1024);
    const user = userEvent.setup();
    render(<Shell />);
    expect(screen.queryByRole('button', { name: 'Close navigation' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    await user.click(screen.getByRole('button', { name: 'Close navigation' }));
    expect(sidebar()).toHaveAttribute('data-state', 'collapsed');
    expect(screen.queryByRole('button', { name: 'Close navigation' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Toggle Sidebar' })).toHaveFocus();
  });

  it('clicking outside the overlay closes it', async () => {
    setWidth(820);
    const user = userEvent.setup();
    render(<Shell />);
    await user.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    await user.click(document.querySelector('[data-slot="sidebar-scrim"]') as HTMLElement);
    expect(sidebar()).toHaveAttribute('data-state', 'collapsed');
  });

  it('an open overlay does not carry into desktop, and desktop keeps its own preference', async () => {
    setWidth(1024);
    const user = userEvent.setup();
    render(<Shell defaultOpen={false} />);
    await user.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    setWidth(1280);
    expect(sidebar()).toHaveAttribute('data-state', 'collapsed');
    expect(sidebar()).not.toHaveAttribute('data-overlay', 'true');
    setWidth(1279);
    expect(sidebar()).toHaveAttribute('data-state', 'collapsed');
    expect(sidebar()).not.toHaveAttribute('data-overlay', 'true');
  });
});

describe('desktop (1280px and above)', () => {
  it.each([1280, 1440])('docks expanded by default at %ipx', (px) => {
    setWidth(px);
    render(<Shell />);
    expect(sidebar()).toHaveAttribute('data-state', 'expanded');
    expect(sidebar()).not.toHaveAttribute('data-overlay', 'true');
  });

  it('respects a saved collapsed preference and saves an explicit change', async () => {
    const user = userEvent.setup();
    render(<Shell defaultOpen={false} />);
    expect(sidebar()).toHaveAttribute('data-state', 'collapsed');
    await user.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(sidebar()).toHaveAttribute('data-state', 'expanded');
    expect(cookie('sidebar_state')).toBe('true');
  });

  it('records the viewport class so the next server render matches it', () => {
    setWidth(1024);
    render(<Shell />);
    expect(cookie('sidebar_viewport')).toBe('tablet');
    cleanup();
    setWidth(1440);
    render(<Shell />);
    expect(cookie('sidebar_viewport')).toBe('desktop');
  });
});

describe('server render', () => {
  it('renders the rail when the last viewport was a tablet, and the dock for desktop', () => {
    expect(renderToString(<Shell defaultOpen defaultViewport="tablet" />)).toContain('data-state="collapsed"');
    expect(renderToString(<Shell defaultOpen defaultViewport="desktop" />)).toContain('data-state="expanded"');
    expect(renderToString(<Shell defaultOpen={false} defaultViewport="desktop" />)).toContain('data-state="collapsed"');
  });
});

describe('phone (below 768px)', () => {
  it.each([320, 390])('uses the menu sheet at %ipx and shows no docked rail', async (px) => {
    setWidth(px);
    const user = userEvent.setup();
    render(<Shell />);
    expect(sidebar()).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByRole('link', { name: 'Customers' })).toBeVisible();
    expect(document.querySelector('[data-slot="sidebar"][data-mobile="true"]')).not.toBeNull();
  });
});
