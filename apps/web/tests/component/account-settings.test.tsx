import { VerificationForm } from '@/app/(auth)/verify-email/verification-form';
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@gold/ui/components/tooltip';
import { SidebarProvider } from '@gold/ui/components/sidebar';
import { AccountMenu } from '@/components/navigation/account-menu';
import { PersonalProfileForm, ChangeEmailForm } from '@/features/account/profile-form';
import { updateProfileAction } from '@/app/settings/account/actions';
import { ChangePasswordForm } from '@/features/account/change-password-form';

vi.mock('@/app/(auth)/verify-email/actions', () => ({
  verifyEmailAction: vi.fn(async () => ({ error: 'That code is invalid, expired, or already used. Request a new code.' })),
  resendEmailAction: vi.fn(async () => ({ error: null, message: 'A new code is on its way.' })),
}));

vi.mock('next/navigation', () => ({ usePathname: () => '/organizations/8b1f0a1e-5d4c-4b7e-9a3f-1c2d3e4f5a6b/home' }));
vi.mock('@/app/settings/account/actions', () => ({
  updateProfileAction: vi.fn(async () => ({ error: null, message: 'Profile saved.' })),
  changeEmailAction: vi.fn(async () => ({ error: null, message: 'Check both addresses.' })),
  requestEmailCodeAction: vi.fn(async () => ({ error: null, message: 'Code sent to current email.' })),
  changePasswordAction: vi.fn(async () => ({ error: null, message: 'Password changed.' })),
  requestPasswordCodeAction: vi.fn(async () => ({ error: null, message: 'Verification code sent.' })),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
});

describe('Settings interactions', () => {
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
    expect(screen.queryByRole('menuitem', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
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


describe('email verification interactions', () => {
  it('supports code autocomplete, rejected codes and requesting another', async () => {
    const user = userEvent.setup();
    render(<VerificationForm />);
    const code = screen.getByLabelText('Verification code');
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    await user.type(code, '123456');
    await user.click(screen.getByRole('button', { name: 'Verify email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid, expired, or already used');
    await user.click(screen.getByRole('button', { name: 'Resend code' }));
    expect(await screen.findByRole('status')).toHaveTextContent('A new code is on its way.');
  });
});

const profile = { given_name: 'Pat', family_name: 'Lee', preferred_name: 'Patty', avatar: null, locale: 'en', timezone: 'UTC',
  phone_e164: null, address_line_1: null, address_line_2: null, city: null, administrative_area: null, postal_code: null, country_code: null };

describe('composed account profile', () => {
  it('renders avatar, names, optional contact and regional fields with Auth email read-only', () => {
    render(<PersonalProfileForm profile={profile} email="pat@example.test" />);
    for (const label of ['Given name', 'Family name', 'Preferred name', 'Phone number', 'Address line 1', 'Address line 2', 'City', 'Province / State / Region', 'Postal code', 'Country', 'Language', 'Time zone']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByLabelText('Given name')).toHaveValue('Pat');
    expect(screen.getByLabelText('Family name')).toHaveValue('Lee');
    expect(screen.getByLabelText('Preferred name')).toHaveValue('Patty');
    expect(screen.queryByLabelText('Avatar URL')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Profile photo for Patty' })).toHaveTextContent('P');
    expect(screen.getByLabelText('Email')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('name');
    expect(screen.getByLabelText('Phone number')).toHaveAttribute('autocomplete', 'tel');
    expect(screen.getByLabelText('Country')).toHaveAttribute('autocomplete', 'country');
    expect(screen.getByRole('form', { name: 'Personal profile' })).toContainElement(screen.getByRole('button', { name: 'Save profile' }));
  });
  it('submits contact and preferences together, omits avatar and Auth email, and announces success', async () => {
    const user = userEvent.setup();
    render(<PersonalProfileForm profile={profile} email="pat@example.test" />);
    await user.type(screen.getByLabelText('City'), 'Kyoto');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Profile saved.');
    const submitted = vi.mocked(updateProfileAction).mock.calls.at(-1)![1];
    expect(submitted.get('city')).toBe('Kyoto');
    expect(submitted.get('locale')).toBe('en');
    expect(submitted.has('email')).toBe(false);
    expect(submitted.has('avatar')).toBe(false);
  });
  it('keeps proof request and email change separate from the profile form', async () => {
    const user = userEvent.setup();
    render(<><PersonalProfileForm profile={profile} email="pat@example.test" /><ChangeEmailForm email="pat@example.test" pendingEmail="next@example.test" /></>);
    const emailForm = screen.getByRole('form', { name: 'Change email address' });
    expect(emailForm).not.toContainElement(screen.getByLabelText('Given name'));
    expect(emailForm).toContainElement(screen.getByLabelText('Code from your current email'));
    expect(screen.getByText('Awaiting confirmation: next@example.test')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send email verification code' }));
    expect(await screen.findByText('Code sent to current email.')).toHaveAttribute('role', 'status');
  });
});
