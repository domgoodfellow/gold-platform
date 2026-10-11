import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONFIG_TARGETS } from '@/lib/navigation';
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
    expect(settingsScopeHref('organization', ORG)).toBe(`/organizations/${ORG}/settings/general`);
    expect(settingsScopeHref('account', ORG)).toBe(`/settings/account?org=${ORG}`);
    expect(settingsScopeHref('access', ORG)).toBe(`/organizations/${ORG}/settings/access`);
    expect(settingsScopeHref('connections', ORG)).toBe(`/organizations/${ORG}/settings/connections`);
    expect(settingsScopeHref('plan', ORG)).toBe(`/organizations/${ORG}/settings/plan`);
    expect(settingsScopeHref('organization', null)).toBe('/settings/account');
    // The Settings root has no page of its own: it redirects to the first destination the member may use.
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
      'settings/general/page.tsx',
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

  it('names Settings once in the global bar and gives each destination its own title', () => {
    for (const [file, title] of [
      ['app/organizations/[organizationId]/settings/general/page.tsx', 'title="General"'],
      ['app/organizations/[organizationId]/settings/branding/page.tsx', 'title="Branding"'],
      ['app/organizations/[organizationId]/settings/domains/page.tsx', 'title="Domains"'],
      ['app/organizations/[organizationId]/settings/features/page.tsx', 'title="Features"'],
      ['features/settings/plan-usage-screen.tsx', 'title="Plan & usage"'],
    ]) {
      const source = read(file);
      expect(source, file).toContain('<SettingsPageHeader');
      expect(source, file).toContain(title);
      expect(source, file).not.toContain('crumbs=');
    }
    // A sub-page keeps the one ancestor it belongs under.
    expect(read('app/organizations/[organizationId]/settings/connections/[connectionId]/page.tsx')).toContain("label: 'Connections'");
    expect(read('app/organizations/[organizationId]/settings/pricing/page.tsx')).toContain("workspaceConfigCrumbs(organizationId, 'pricing')");
  });

  it('keeps legacy routes as direct redirects to final canonical destinations', () => {
    expect(read('app/organizations/[organizationId]/pricing/page.tsx')).toContain('/settings/pricing');
    expect(read('app/organizations/[organizationId]/fields/page.tsx')).toContain('/settings/custom-fields');
    expect(read('app/organizations/[organizationId]/roles/page.tsx')).toContain('/settings/access/');
    expect(read('app/organizations/[organizationId]/integrations/page.tsx')).toContain('/settings/connections');
  });
});

describe('Settings is one contextual sidebar, not a landing page or a directory', () => {
  const landing = read('app/organizations/[organizationId]/settings/page.tsx');
  const organization = read('app/organizations/[organizationId]/settings/organization/page.tsx');

  it('the account menu enters Settings through the root, which redirects to a destination', () => {
    const menu = read('components/navigation/account-menu.tsx');
    expect(menu).toContain('const settingsHref = settingsLandingHref(from);');
    expect(landing).toContain('redirect(defaultSettingsHref(');
    expect(landing).not.toContain('<PageHeader');
  });

  it('/settings/organization is only a redirect to General, and renders no directory', () => {
    expect(organization).toContain('redirect(`/organizations/${organizationId}/settings/general`)');
    expect(organization).not.toContain('SettingsIndex');
    expect(existsSync(`${ROOT}/features/settings/settings-index.tsx`)).toBe(false);
    expect(existsSync(`${ROOT}/features/settings/settings-landing.tsx`)).toBe(false);
  });

  it('the shell swaps its workspaces for Settings destinations inside the same Sidebar', () => {
    const shell = read('app/organizations/[organizationId]/org-shell.tsx');
    expect(shell).toContain('<SettingsNav');
    expect(shell).toContain('inSettingsContext(pathname, organizationId)');
    expect(shell.match(/<Sidebar /g)).toHaveLength(2);
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

  it('workspace-owned configuration carries its workspace as ancestry, not Settings', () => {
    for (const page of [
      'app/organizations/[organizationId]/settings/pricing/page.tsx',
      'app/organizations/[organizationId]/settings/calls/page.tsx',
      'app/organizations/[organizationId]/settings/sales-stages/page.tsx',
    ]) {
      const source = read(page);
      expect(source, page).toContain('workspaceConfigCrumbs(');
      expect(source, page).not.toMatch(/label:\s*'Organization'/);
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
    // Inside a business the Settings sidebar carries Profile/Security; the page-level tabs are for the account-only frame.
    for (const page of [profile, security]) expect(page).toContain('<AccountSectionNav');
  });

  it('Connections keeps its local nav rather than the retired global scope tabs', () => {
    expect(read('app/organizations/[organizationId]/settings/connections/connections-page.tsx')).toContain('<IntegrationsNav');
  });
});
