// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarMenuButton, SidebarProvider, useSidebar } from '@gold/ui/components/sidebar';
import { TooltipProvider } from '@gold/ui/components/tooltip';

/**
 * A collapsed rail names each item in a tooltip. A hover recorded while the sidebar was expanded
 * must not open that tooltip when the rail collapses: it would appear away from the pointer and
 * cover the header's own sidebar toggle (seen at tablet width after Escape).
 */
beforeEach(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  window.innerWidth = 1280; // desktop: tooltips are used, not the phone sheet
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

// Collapses the sidebar without moving the pointer, as Escape or the header toggle would.
function Collapse() { const { setOpen } = useSidebar(); return <button type="button" onClick={() => setOpen(false)}>Collapse</button>; }

function renderRail(open: boolean) {
  return render(
    <TooltipProvider delayDuration={0}>
      <SidebarProvider defaultOpen={open}>
        <SidebarMenuButton tooltip="Grachtwerk Verhuur">GV</SidebarMenuButton>
        <Collapse />
      </SidebarProvider>
    </TooltipProvider>,
  );
}

describe('collapsed rail tooltips', () => {
  it('names the item when the collapsed rail item is focused', async () => {
    renderRail(false);
    await userEvent.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Grachtwerk Verhuur');
  });

  it('does not open a tooltip on collapse from a hover recorded while expanded', async () => {
    renderRail(true);
    await userEvent.hover(screen.getByRole('button', { name: 'GV' }));
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
