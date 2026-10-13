import { configTarget } from '@/lib/navigation';

/** Compatibility paths resolve through the canonical configuration registry. */
export function legacyConfigurationPath(pathname: string): string | null {
  const match = /^\/organizations\/([^/]+)\/(settings\/(?:calls|communications|email|sales-stages|opportunity-stages|pricing)|support\/service-levels|comms\/numbers(?:\/[^/]+)?)\/?$/.exec(pathname);
  if (!match) return null;
  const keys: Record<string, string> = { 'settings/calls': 'call-setup', 'settings/communications': 'communications', 'settings/email': 'email', 'settings/sales-stages': 'sales-stages', 'settings/opportunity-stages': 'opportunity-stages', 'settings/pricing': 'pricing', 'support/service-levels': 'support-service-levels' };
  const legacy = match[2];
  const path = legacy.startsWith('comms/numbers') ? configTarget('phone-numbers').path + legacy.slice('comms/numbers'.length) : configTarget(keys[legacy]).path;
  return `/organizations/${match[1]}/${path}`;
}

/** Legacy routes preserve repeated query values. Proxy HTTP redirects retain browser fragments. */
export function configurationRedirectHref(organizationId: string, path: string, query: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
  }
  const suffix = params.toString();
  return `/organizations/${organizationId}/${path}${suffix ? `?${suffix}` : ''}`;
}
