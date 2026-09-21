import type { PlatformCapability } from '@/lib/domain/platform/permissions';

/**
 * The platform's own destinations and what each one takes to reach. One registry for the sidebar,
 * the phone menu and the route guard, so a destination cannot be offered by one and refused by
 * another. Presentation (icons) lives with the renderer, keyed by `key`.
 *
 * Platform is a **sub-scope of GOLD's own organization**, not a section of every business and not
 * a context of its own: these are shown only inside that organization, only to somebody whose
 * `platform_staff` row names the permission, and are served from
 * `/organizations/{goldId}/platform/**`. The URL says which application context an operator is in;
 * it says nothing about who owns the data behind a page — providers, catalogue and billing stay
 * platform-scoped records that a nested route merely draws. Nothing here reads a role name.
 */
export type PlatformGroupKey = 'commercial' | 'infrastructure';

/** The sidebar groups that have no page of their own. Catalog is not one: it is a destination with children. */
export const PLATFORM_GROUPS: readonly { key: PlatformGroupKey; label: string }[] = [
  { key: 'commercial', label: 'Commercial' },
  { key: 'infrastructure', label: 'Infrastructure' },
];

export type PlatformDestination = {
  key: string;
  label: string;
  /** Beneath `/organizations/{goldId}/platform`; the empty string is the overview. Read it with `platformHref`. */
  path: string;
  /** The one platform permission that reaches this destination. */
  requires: PlatformCapability;
  /** Where the sidebar nests it: beneath the Catalog destination, or under a named group. Absent means top level. */
  under?: 'catalog' | PlatformGroupKey;
};

export const PLATFORM_DESTINATIONS: readonly PlatformDestination[] = [
  { key: 'overview', label: 'Overview', path: '', requires: 'platform.health' },
  { key: 'organizations', label: 'Organizations', path: 'organizations', requires: 'platform.organizations' },
  { key: 'catalog', label: 'Catalog', path: 'catalog', requires: 'platform.catalogue' },
  { key: 'plans', label: 'Plans & Add-ons', path: 'catalog/plans', requires: 'platform.catalogue', under: 'catalog' },
  { key: 'meters', label: 'Meters', path: 'catalog/meters', requires: 'platform.catalogue', under: 'catalog' },
  { key: 'connectors', label: 'Integrations', path: 'integrations', requires: 'platform.catalogue', under: 'catalog' },
  { key: 'pricing', label: 'Pricing', path: 'pricing', requires: 'platform.commercial', under: 'commercial' },
  { key: 'billing', label: 'Billing', path: 'billing', requires: 'platform.commercial', under: 'commercial' },
  { key: 'providers', label: 'Providers', path: 'providers', requires: 'platform.providers', under: 'infrastructure' },
  { key: 'failures', label: 'Failures', path: 'failures', requires: 'platform.health', under: 'infrastructure' },
];

/**
 * The one way to spell a Platform address. `organizationId` is GOLD's own organization — the
 * context the operator is working in — never the subject of the page.
 */
export function platformHref(organizationId: string, path = ''): string {
  return `/organizations/${organizationId}/platform${path ? `/${path}` : ''}`;
}

/** The destinations a set of permissions reaches, in registry order. */
export function platformDestinationsFor(permissions: ReadonlySet<PlatformCapability>): PlatformDestination[] {
  return PLATFORM_DESTINATIONS.filter((destination) => permissions.has(destination.requires));
}

/**
 * The permission a Platform path takes, given the path **beneath the platform root**
 * (`catalog/plans/base`, not the whole URL): the longest registered prefix wins, so
 * `catalog/plans/{key}` is the catalogue's and `organizations/{id}/usage` is the organizations'. A
 * path that matches nothing takes the overview's permission — refusing is the safe answer for a
 * route nobody has classified.
 */
export function platformRouteRequires(path: string): PlatformCapability {
  const matches = PLATFORM_DESTINATIONS.filter((destination) =>
    destination.path === '' ? path === '' : path === destination.path || path.startsWith(`${destination.path}/`),
  );
  if (matches.length === 0) return 'platform.health';
  return matches.reduce((best, item) => (item.path.length > best.path.length ? item : best)).requires;
}

const PLATFORM_ROOT = /^\/organizations\/[0-9a-f-]{36}\/platform(?:\/(.*))?$/i;

/** The part of a pathname beneath the platform root, or `null` when the path is not a Platform address. */
export function platformSubpath(pathname: string): string | null {
  const match = PLATFORM_ROOT.exec(pathname.split(/[?#]/)[0].replace(/\/$/, ''));
  return match ? (match[1] ?? '') : null;
}
