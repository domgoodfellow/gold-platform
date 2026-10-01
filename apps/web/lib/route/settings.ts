/**
 * Settings is one destination with five scopes: Organization, Account, Access, Connections and
 * Plan & usage. Each scope still writes to its own domain surface — Account is the signed-in
 * person's and follows them across businesses (D45); Organization, Access, Connections and
 * Plan & usage are this business's, checked against the caller's membership on every page the
 * same as before. This registry exists so the one tab bar every scope renders (`SettingsScopeNav`)
 * cannot disagree with itself about where a scope lives.
 */
export type SettingsScopeKey = 'organization' | 'account' | 'access' | 'connections' | 'plan';

export type SettingsScope = {
  key: SettingsScopeKey;
  label: string;
};

export const SETTINGS_SCOPES: readonly SettingsScope[] = [
  { key: 'organization', label: 'Organization' },
  { key: 'account', label: 'Account' },
  { key: 'access', label: 'Access' },
  { key: 'connections', label: 'Connections' },
  { key: 'plan', label: 'Plan & usage' },
] as const;

/**
 * Where a scope lives. `organizationId` is a hint the same way it is everywhere else in Settings
 * (D17): every page behind these addresses still checks membership itself. `null` collapses every
 * scope but Account, since there is nothing organization-shaped to reach.
 */
export function settingsScopeHref(key: SettingsScopeKey, organizationId: string | null): string {
  if (key === 'account') return organizationId ? `/settings/account?org=${encodeURIComponent(organizationId)}` : '/settings/account';
  if (!organizationId) return '/settings/account';
  switch (key) {
    case 'organization': return `/organizations/${organizationId}/settings`;
    case 'access': return `/organizations/${organizationId}/settings/access`;
    case 'connections': return `/organizations/${organizationId}/settings/connections`;
    case 'plan': return `/organizations/${organizationId}/settings/plan`;
  }
}

/** The scopes worth drawing a tab for: every scope once there is a business in play, Account alone otherwise. */
export function settingsScopesFor(organizationId: string | null): readonly SettingsScope[] {
  return organizationId ? SETTINGS_SCOPES : SETTINGS_SCOPES.filter((scope) => scope.key === 'account');
}
