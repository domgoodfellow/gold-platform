/**
 * Settings is a landing page — `/organizations/{id}/settings` — with five destinations chosen
 * from it: Organization, Account, Access, Connections and Plan & usage. Each still writes to its
 * own domain surface — Account is the signed-in person's and follows them across businesses
 *; Organization, Access, Connections and Plan & usage are this business's, checked against
 * the caller's membership on every page the same as before. Choosing one opens its own page with
 * its own local navigation (Access's Members/Invitations/Roles, Account's Profile/Security); none
 * of them re-renders a persistent Settings tab bar on top of its content. This registry exists so
 * the landing chooser and every page that links back up to a scope cannot disagree about where it
 * lives.
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
 *: every page behind these addresses still checks membership itself. `null` collapses every
 * scope but Account, since there is nothing organization-shaped to reach.
 */
export function settingsScopeHref(key: SettingsScopeKey, organizationId: string | null): string {
  if (key === 'account') return organizationId ? `/settings/account?org=${encodeURIComponent(organizationId)}` : '/settings/account';
  if (!organizationId) return '/settings/account';
  switch (key) {
    case 'organization': return `/organizations/${organizationId}/settings/general`;
    case 'access': return `/organizations/${organizationId}/settings/access`;
    case 'connections': return `/organizations/${organizationId}/settings/connections`;
    case 'plan': return `/organizations/${organizationId}/settings/plan`;
  }
}

/** The Settings landing page itself — the root every scope's breadcrumb climbs back to. */
export function settingsLandingHref(organizationId: string | null): string {
  return organizationId ? `/organizations/${organizationId}/settings` : '/settings/account';
}

/** The scopes the landing page offers a choice between: every scope once there is a business in play, Account alone otherwise. */
export function settingsScopesFor(organizationId: string | null): readonly SettingsScope[] {
  return organizationId ? SETTINGS_SCOPES : SETTINGS_SCOPES.filter((scope) => scope.key === 'account');
}

/**
 * Where an old payment-settings address lands (General's `#getting-paid`, Finance's retired
 * configuration, Commerce): Customer payments when this member is offered it, otherwise General,
 * which owns the trading currency and tells everyone else who can change it.
 */
export function legacyPaymentSettingsHref(organizationId: string, paymentsOffered: boolean): string {
  return `/organizations/${organizationId}/settings/${paymentsOffered ? 'payments' : 'general'}`;
}
