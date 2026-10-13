import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decideRedirect } from '@/lib/route/access';
import { organizationIdFromPath } from '@/lib/route/platform-context';
import {
  PERSONAL_SECTIONS,
  PERSONAL_SETTINGS_ROOT,
  personalSettingsHref,
} from '@/lib/route/personal-settings';

/**
 * Personal settings is user-scoped and has one address. It shares the Settings presentation with
 * the organization's, and owns nothing an organization does — and the reverse.
 */

const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const read = (path: string) => readFileSync(`${WEB}/${path}`, 'utf8');

const ORG = '8b1f0a1e-5d4c-4b7e-9a3f-1c2d3e4f5a6b';

describe('the one address', () => {
  it('is /settings/account, with sections beneath it', () => {
    expect(PERSONAL_SETTINGS_ROOT).toBe('/settings/account');
    expect(PERSONAL_SECTIONS.map((section) => section.path)).toEqual([
      '/settings/account',
      '/settings/account/security',
      '/settings/account/appearance',
    ]);
  });

  it('carries the business being left, and nothing when there was none', () => {
    expect(personalSettingsHref('profile', ORG)).toBe(`/settings/account?org=${ORG}`);
    expect(personalSettingsHref('security', ORG)).toBe(`/settings/account/security?org=${ORG}`);
    expect(personalSettingsHref('security')).toBe('/settings/account/security');
  });

  it('reads the business from an organization path only', () => {
    expect(organizationIdFromPath(`/organizations/${ORG}/customers`)).toBe(ORG);
    expect(organizationIdFromPath(`/organizations/${ORG}`)).toBe(ORG);
    expect(organizationIdFromPath('/organizations/accept-invite/token')).toBeNull();
    expect(organizationIdFromPath('/settings/account')).toBeNull();
    expect(organizationIdFromPath('/platform')).toBeNull();
  });

  it('is behind sign-in like every other workspace path', () => {
    expect(decideRedirect({ kind: 'none' }, '/settings/account')).toBe('/login');
    expect(decideRedirect({ kind: 'none' }, '/auth/email-change')).toBeNull();
    expect(decideRedirect({ kind: 'account', userId: 'u' }, '/settings/account/security')).toBeNull();
  });

  it('retires /account by redirect and leaves no page of its own', () => {
    expect(read('next.config.ts')).toMatch(/source:\s*"\/account",\s*destination:\s*"\/settings\/account"/);
    expect(() => readFileSync(`${WEB}/app/account/page.tsx`)).toThrow();
  });
});

describe('the menu', () => {
  const menu = read('components/navigation/account-menu.tsx');

  it('offers one Settings entry and Sign out, and leaves switching context to the switcher (D71)', () => {
    expect(menu).toContain('>Settings</Link>');
    expect(existsSync(`${WEB}/components/navigation/sidebar-footer-navigation.tsx`)).toBe(false);
    expect(menu).not.toContain('Business settings');
    expect(menu).not.toContain('Account settings');
    expect(menu).toContain('Sign out');
    expect(menu).not.toContain('Switch organization');
    expect(menu).not.toContain('href="/account"');
  });

  it('opens the canonical Settings landing page instead of bypassing it', () => {
    expect(menu).toContain('settingsLandingHref(from)');
    expect(menu).not.toContain("settingsScopeHref('organization', from)");
  });

  it('offers Help and Contact support only when a business is in play, and keeps Settings as the one place for Account and Plan', () => {
    expect(menu).toContain('Help &amp; documentation');
    expect(menu).toContain('Contact GildOps Support');
    expect(menu).toContain('{from ? (');
    expect(menu).not.toContain('Plan &amp; usage');
  });
});

describe('scope stays honest in both directions', () => {
  it('a password and identity are never rendered inside an organization Settings route', () => {
    for (const file of [
      'app/organizations/[organizationId]/settings/page.tsx',
      'app/organizations/[organizationId]/settings/general/page.tsx',
    ]) {
      expect(read(file), file).not.toMatch(/changePassword|CredentialsForm/);
    }
  });

  it('Settings has no landing chooser: the sidebar is the directory, and Account is one of its destinations (D71)', () => {
    const landing = read('app/organizations/[organizationId]/settings/page.tsx');
    expect(landing).toContain('redirect(defaultSettingsHref(');
    expect(landing).not.toContain('PersonalSettingsEntries');
    const organizationDirectory = read('app/organizations/[organizationId]/settings/organization/page.tsx');
    expect(organizationDirectory).toContain('/settings/general');
    expect(organizationDirectory).not.toContain('SettingsIndex');
    // The retired global tab bar is gone outright, not merely unused.
    expect(() => read('features/settings/settings-scope-nav.tsx')).toThrow();
  });

  it('the shell no longer special-cases the Personal settings address — Settings is not a permanent sidebar row to mark current', () => {
    expect(read('lib/shell.ts')).not.toContain('PERSONAL_SETTINGS_ROOT');
  });

  it('the return business is checked against the callers own memberships, never trusted', () => {
    const shell = read('features/account/personal-settings-shell.tsx');
    expect(shell).toContain('myOrganizations.find((organization) => organization.id === returnOrganizationId)');
  });

  it('personal ownership is explicit, and the retired Organization directory only redirects to General', () => {
    expect(read('app/settings/account/page.tsx')).toContain('belongs to you, not to any business');
    const general = read('app/organizations/[organizationId]/settings/general/page.tsx');
    expect(general).toContain('<SettingsPageHeader title="General"');
  });
});
