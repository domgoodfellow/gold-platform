// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarProvider, useSidebar } from '@gold/ui/components/sidebar';
import { TooltipProvider } from '@gold/ui/components/tooltip';
import { LockedOrgSidebar } from '@/app/organizations/[organizationId]/org-shell';

vi.mock('next/navigation', () => ({
  usePathname: () => '/organizations/org-1/settings/plan',
}));

/**
 * A commercially locked business has no bottom bar, so on a phone its header's sidebar trigger is the
 * only way to Plan & usage and the account menu. This renders the real locked sidebar in its phone
 * (Sheet) mode and proves what that sheet holds. The header trigger itself belongs to a server
 * component and is held by `workspace-shell.test.ts`; no browser fixture produces a locked business.
 */

beforeEach(() => {
  // Radix measures the avatar/dropdown with ResizeObserver, which jsdom lacks.
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  window.innerWidth = 500;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: true,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

afterEach(cleanup);

function Opener() {
  const { setOpenMobile } = useSidebar();
  return <button onClick={() => setOpenMobile(true)}>open</button>;
}

describe('the locked organization sidebar on a phone', () => {
  it('opens from the right with Plan & usage, the business identity and the account menu', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
      <SidebarProvider>
        <Opener />
        <LockedOrgSidebar
          organizationId="org-1"
          mark={<span>G</span>}
          name="Grachtwerk Verhuur"
          role="Owner"
          organizations={[{ id: 'org-2', name: 'Another', role: 'Owner', operationalState: 'live' }]}
          email="sanne@grachtwerk.test"
          signOutAction={async () => {}}
        />
      </SidebarProvider>
      </TooltipProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'open' }));

    const sheet = await screen.findByRole('dialog');
    expect(sheet).toHaveAttribute('data-side', 'right');
    // jsdom applies no CSS, so both the phone identity and the md-only switcher are in the DOM here;
    // that exactly one is visible on a phone is a layout fact, checked in the browser.
    expect(within(sheet).getAllByText('Grachtwerk Verhuur').length).toBeGreaterThan(0);
    expect(within(sheet).getByRole('link', { name: /Plan & usage/ })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /sanne@grachtwerk\.test/ })).toBeInTheDocument();
  });
});
