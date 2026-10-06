import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONFIG_TARGETS } from '@/lib/navigation';
import { personalSettingsAncestry } from '@/lib/route/personal-settings';
import { SETTINGS_SCOPES, settingsLandingHref, settingsScopeHref } from '@/lib/route/settings';

const ORG = 'org-1';
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const route = (path: string) => `${ROOT}/app/organizations/[organizationId]/${path}`;
const read = (path: string) => readFileSync(`${ROOT}/${path}`, 'utf8');

describe('canonical Settings route contract', () => {
  it('resolves the five Settings scopes without changing Account ownership', () => {
    expect(SETTINGS_SCOPES.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: 'organization', label: 'Organization' },
      { key: 'account', label: 'Account' },
      { key: 'access', label: 'Access' },
      { key: 'connections', label: 'Connections' },
      { key: 'plan', label: 'Plan & usage' },
    ]);
    expect(settingsScopeHref('organization', ORG)).toBe(`/organizations/${ORG}/settings/organization`);
    expect(settingsScopeHref('account', ORG)).toBe(`/settings/account?org=${ORG}`);
    expect(settingsScopeHref('access', ORG)).toBe(`/organizations/${ORG}/settings/access`);
    expect(settingsScopeHref('connections', ORG)).toBe(`/organizations/${ORG}/settings/connections`);
    expect(settingsScopeHref('plan', ORG)).toBe(`/organizations/${ORG}/settings/plan`);
    expect(settingsScopeHref('organization', null)).toBe('/settings/account');
    // The landing page itself — the root every scope's breadcrumb climbs back to.
    expect(settingsLandingHref(ORG)).toBe(`/organizations/${ORG}/settings`);
    expect(settingsLandingHref(null)).toBe('/settings/account');
  });

  it('registers canonical Settings-owned configuration while retaining workspace-owned routes', () => {
    const byKey = new Map(CONFIG_TARGETS.map((target) => [target.key, target.path]));
    expect(byKey.get('pricing')).toBe('settings/pricing');
    expect(byKey.get('custom-fields')).toBe('settings/custom-fields');
    expect(byKey.get('team')).toBe('settings/access');
    expect(byKey.get('integrations')).toBe('settings/connections');
    expect(byKey.get('plan')).toBe('settings/plan');
    expect(byKey.get('work-configuration')).toBe('work/configuration');
    expect(byKey.get('schedule-configuration')).toBe('schedule/configuration');
  });

  it('provides real path-backed Access and Connections destinations', () => {
    for (const path of [
      'settings/organization/page.tsx',
      'settings/access/page.tsx',
      'settings/access/members/page.tsx',
      'settings/access/invitations/page.tsx',
      'settings/access/roles/page.tsx',
      'settings/connections/page.tsx',
      'settings/connections/apps/page.tsx',
      'settings/connections/[connectionId]/page.tsx',
      'settings/pricing/page.tsx',
      'settings/custom-fields/page.tsx',
    ]) expect(existsSync(route(path)), path).toBe(true);
  });

  it('publishes Settings > Account ancestry and canonical organization breadcrumbs', () => {
    // No organization hint: Settings and Account both fall back to the one personal address.
    expect(personalSettingsAncestry()).toEqual([
      { label: 'Settings', href: '/settings/account' },
      { label: 'Account', href: '/settings/account' },
    ]);
    expect(personalSettingsAncestry(ORG)).toEqual([
      { label: 'Settings', href: `/organizations/${ORG}/settings` },
      { label: 'Account', href: `/settings/account?org=${ORG}` },
    ]);
    expect(read('app/organizations/[organizationId]/settings/pricing/page.tsx')).toContain("label: 'Settings'");
    expect(read('app/organizations/[organizationId]/settings/access/access-page.tsx')).toContain("label: 'Access'");
    expect(read('app/organizations/[organizationId]/settings/connections/[connectionId]/page.tsx')).toContain("label: 'Connections'");
    // Phase C (Slice 9) moved this route's identity into the Screen its thin page delegates to.
    expect(read('features/settings/plan-usage-screen.tsx')).toContain('title="Plan & usage"');
  });

  it('keeps legacy routes as direct redirects to final canonical destinations', () => {
    expect(read('app/organizations/[organizationId]/pricing/page.tsx')).toContain('/settings/pricing');
    expect(read('app/organizations/[organizationId]/fields/page.tsx')).toContain('/settings/custom-fields');
    expect(read('app/organizations/[organizationId]/roles/page.tsx')).toContain('/settings/access/');
    expect(read('app/organizations/[organizationId]/integrations/page.tsx')).toContain('/settings/connections');
  });
});

describe('Settings is a landing page, not a persistent tab bar (IA correction)', () => {
  const landing = read('app/organizations/[organizationId]/settings/page.tsx');
  const organization = read('app/organizations/[organizationId]/settings/organization/page.tsx');

  it('the account menu enters Settings through the landing page', () => {
    const menu = read('components/navigation/account-menu.tsx');
    expect(menu).toContain('const settingsHref = settingsLandingHref(from);');
    expect(menu).not.toContain("settingsScopeHref('organization', from)");
  });

  it('/settings renders the Settings identity, never the Organization identity', () => {
    expect(landing).toContain("title={areaLabel('settings')}");
    expect(landing).not.toContain('title="Organization"');
    expect(landing).toContain('<SettingsLanding');
    expect(landing).not.toContain('<SettingsIndex');
  });

  it('/settings/organization renders the organization configuration directory (SettingsIndex)', () => {
    expect(organization).toContain('title="Organization"');
    expect(organization).toContain('<SettingsIndex');
    expect(organization).toContain('offeredSections(');
  });

  it('the landing chooser exposes all five destinations, and only there', () => {
    expect(readFileSync(`${ROOT}/features/settings/settings-landing.tsx`, 'utf8')).toContain('settingsScopesFor(organizationId)');
    expect(landing).toContain('<SettingsLanding organizationId={organizationId} />');
  });

  it('no detail page under Settings renders the retired global scope tab bar', () => {
    const pages = [
      'app/organizations/[organizationId]/settings/branding/page.tsx',
      'app/organizations/[organizationId]/settings/general/page.tsx',
      'app/organizations/[organizationId]/settings/pricing/page.tsx',
      'app/organizations/[organizationId]/settings/custom-fields/page.tsx',
      'app/organizations/[organizationId]/settings/features/page.tsx',
      'app/organizations/[organizationId]/settings/communications/page.tsx',
      'app/organizations/[organizationId]/settings/domains/page.tsx',
      'app/organizations/[organizationId]/settings/access/access-page.tsx',
      'app/organizations/[organizationId]/settings/connections/connections-page.tsx',
      'app/organizations/[organizationId]/settings/connections/[connectionId]/page.tsx',
      'features/settings/plan-usage-screen.tsx',
      'features/account/personal-settings-shell.tsx',
      'app/settings/account/page.tsx',
      'app/settings/account/security/page.tsx',
    ];
    for (const page of pages) {
      const source = read(page);
      expect(source, `${page} still imports SettingsScopeNav`).not.toMatch(/SettingsScopeNav/);
      expect(source, `${page} still renders a global Settings scope tab row`).not.toContain('<SettingsHeader');
    }
    expect(existsSync(`${ROOT}/features/settings/settings-scope-nav.tsx`)).toBe(false);
    expect(existsSync(`${ROOT}/components/patterns/settings-header.tsx`)).toBe(false);
  });

  it('Branding, General, Pricing and Custom fields each carry Settings > Organization ancestry', () => {
    for (const page of [
      'app/organizations/[organizationId]/settings/branding/page.tsx',
      'app/organizations/[organizationId]/settings/general/page.tsx',
      'app/organizations/[organizationId]/settings/pricing/page.tsx',
      'app/organizations/[organizationId]/settings/custom-fields/page.tsx',
    ]) {
      const source = read(page);
      expect(source, page).toContain('settingsLandingHref(organizationId)');
      expect(source, page).toContain("label: 'Organization'");
    }
  });

  it('Access keeps its local Members/Invitations/Roles navigation, and Account keeps Profile/Security', () => {
    const access = read('app/organizations/[organizationId]/settings/access/access-page.tsx');
    expect(access).toContain('<ViewNav');
    expect(access).toContain("label: 'Members'");
    expect(access).toContain("label: 'Roles'");
    expect(access).toContain('`Invitations');

    const profile = read('app/settings/account/page.tsx');
    const security = read('app/settings/account/security/page.tsx');
    for (const page of [profile, security]) expect(page).toContain('<AccountSectionNav');
  });

  it('Connections keeps its local nav rather than the retired global scope tabs', () => {
    expect(read('app/organizations/[organizationId]/settings/connections/connections-page.tsx')).toContain('<IntegrationsNav');
  });
});
