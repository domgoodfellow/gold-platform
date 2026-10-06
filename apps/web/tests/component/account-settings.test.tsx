// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@gold/ui/components/tooltip';
import { SidebarProvider } from '@gold/ui/components/sidebar';
import { AccountMenu } from '@/components/navigation/account-menu';
import { SettingsNavigationRow } from '@/features/settings/settings-navigation-row';
import { ChangePasswordForm } from '@/features/account/change-password-form';

vi.mock('next/navigation', () => ({ usePathname: () => '/organizations/8b1f0a1e-5d4c-4b7e-9a3f-1c2d3e4f5a6b/home' }));
vi.mock('@/app/settings/account/actions', () => ({
  changePasswordAction: vi.fn(async () => ({ error: null, message: 'Password changed.' })),
  requestPasswordCodeAction: vi.fn(async () => ({ error: null, message: 'Verification code sent.' })),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
});

describe('Settings interactions', () => {
  it('makes the complete navigation row one keyboard-focusable link', async () => {
    const user = userEvent.setup();
    render(<ul><SettingsNavigationRow href="/settings/account" title="Account" description="Your own identity" /></ul>);
    const link = screen.getByRole('link', { name: 'Account Your own identity' });
    expect(screen.getAllByRole('link')).toHaveLength(1);
    await user.tab();
    expect(link).toHaveFocus();
    expect(link).toHaveClass('px-4', 'py-3.5');
  });
  it('opens and closes the account menu with pressed state, and returns focus on Escape', async () => {
    const user = userEvent.setup();
    render(<TooltipProvider><SidebarProvider><AccountMenu email="person@example.test" signOutAction={vi.fn()} /></SidebarProvider></TooltipProvider>);
    const trigger = screen.getByRole('button', { name: /person@example.test/ });
    expect(trigger).toHaveAttribute('data-state', 'closed');
    const chevron = trigger.querySelector('svg');
    expect(chevron).toHaveClass('group-data-[state=open]/account-menu:rotate-180');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('data-state', 'open');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveAttribute('href', '/organizations/8b1f0a1e-5d4c-4b7e-9a3f-1c2d3e4f5a6b/settings');
    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('data-state', 'closed');
    expect(trigger).toHaveFocus();
  });
  it('keeps current-password and new-password autocomplete separate', () => {
    render(<ChangePasswordForm />);
    expect(screen.getByLabelText('Current password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByLabelText('New password')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('New password')).toHaveAttribute('minlength', '15');
    expect(screen.getByLabelText('Confirm new password')).toHaveAttribute('autocomplete', 'new-password');
  });
});
