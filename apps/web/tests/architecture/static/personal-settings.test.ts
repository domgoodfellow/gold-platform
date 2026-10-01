import { readFileSync } from 'node:fs';
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
    expect(menu).not.toContain('Business settings');
    expect(menu).not.toContain('Account settings');
    expect(menu).toContain('Sign out');
    expect(menu).not.toContain('Switch organization');
    expect(menu).not.toContain('href="/account"');
  });

  it('offers a Plan & usage shortcut only when a business is in play', () => {
    expect(menu).toContain('Plan &amp; usage');
    expect(menu).toContain("settingsScopeHref('plan', from)");
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

  it('Account is a Settings landing destination, not a section duplicated inside the Organization index (D71)', () => {
    const landing = read('app/organizations/[organizationId]/settings/page.tsx');
    expect(landing).toContain('<SettingsLanding');
    expect(landing).not.toContain('PersonalSettingsEntries');
    const organizationDirectory = read('app/organizations/[organizationId]/settings/organization/page.tsx');
    expect(organizationDirectory).not.toContain('PersonalSettingsEntries');
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

  it('personal ownership is explicit, and Organization is its own Settings landing destination', () => {
    expect(read('app/settings/account/page.tsx')).toContain('belongs to you, not to any business');
    const landing = read('app/organizations/[organizationId]/settings/page.tsx');
    expect(landing).toContain("title={areaLabel('settings')}");
    const organization = read('app/organizations/[organizationId]/settings/organization/page.tsx');
    expect(organization).toContain('title="Organization"');
  });
});
