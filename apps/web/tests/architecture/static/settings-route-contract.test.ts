import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONFIG_TARGETS } from '@/lib/navigation';
import { personalSettingsAncestry } from '@/lib/route/personal-settings';
import { SETTINGS_SCOPES, settingsScopeHref } from '@/lib/route/settings';

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
    expect(settingsScopeHref('organization', ORG)).toBe(`/organizations/${ORG}/settings`);
    expect(settingsScopeHref('account', ORG)).toBe(`/settings/account?org=${ORG}`);
    expect(settingsScopeHref('access', ORG)).toBe(`/organizations/${ORG}/settings/access`);
    expect(settingsScopeHref('connections', ORG)).toBe(`/organizations/${ORG}/settings/connections`);
    expect(settingsScopeHref('plan', ORG)).toBe(`/organizations/${ORG}/settings/plan`);
    expect(settingsScopeHref('organization', null)).toBe('/settings/account');
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
    expect(personalSettingsAncestry()).toEqual([{ label: 'Settings' }, { label: 'Account' }]);
    expect(read('app/organizations/[organizationId]/settings/pricing/page.tsx')).toContain("label: 'Settings'");
    expect(read('app/organizations/[organizationId]/settings/access/access-page.tsx')).toContain("label: 'Access'");
    expect(read('app/organizations/[organizationId]/settings/connections/[connectionId]/page.tsx')).toContain("label: 'Connections'");
    expect(read('app/organizations/[organizationId]/settings/plan/page.tsx')).toContain('title="Plan & usage"');
  });

  it('keeps legacy routes as direct redirects to final canonical destinations', () => {
    expect(read('app/organizations/[organizationId]/pricing/page.tsx')).toContain('/settings/pricing');
    expect(read('app/organizations/[organizationId]/fields/page.tsx')).toContain('/settings/custom-fields');
    expect(read('app/organizations/[organizationId]/roles/page.tsx')).toContain('/settings/access/');
    expect(read('app/organizations/[organizationId]/integrations/page.tsx')).toContain('/settings/connections');
  });
});
