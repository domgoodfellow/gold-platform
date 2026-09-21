import type { PlatformCapability } from '@/lib/domain/platform/permissions';

/**
 * The platform's own destinations and what each one takes to reach. One registry for the sidebar,
 * the phone menu and the route guard, so a destination cannot be offered by one and refused by
 * another. Presentation (icons) lives with the renderer, keyed by `key`.
 *
 * Platform is a **scope**, not a section of every business: these are shown only inside GOLD's own
 * organization, only to somebody whose `platform_staff` row names the permission, and are served
 * from `/platform/**`, which renders inside that same shell. Nothing here reads a role name.
 */
export type PlatformDestination = {
  key: string;
  label: string;
  href: string;
  /** The one platform permission that reaches this destination. */
  requires: PlatformCapability;
};

export const PLATFORM_DESTINATIONS: readonly PlatformDestination[] = [
  { key: 'overview', label: 'Overview', href: '/platform', requires: 'platform.health' },
  { key: 'organizations', label: 'Organizations', href: '/platform/organizations', requires: 'platform.organizations' },
  { key: 'catalog', label: 'Catalog', href: '/platform/catalog', requires: 'platform.catalogue' },
  { key: 'plans', label: 'Plans & Add-ons', href: '/platform/catalog/plans', requires: 'platform.catalogue' },
  { key: 'meters', label: 'Meters', href: '/platform/catalog/meters', requires: 'platform.catalogue' },
  { key: 'connectors', label: 'Integrations', href: '/platform/integrations', requires: 'platform.catalogue' },
  { key: 'pricing', label: 'Pricing', href: '/platform/pricing', requires: 'platform.commercial' },
  { key: 'billing', label: 'Billing', href: '/platform/billing', requires: 'platform.commercial' },
  { key: 'providers', label: 'Providers', href: '/platform/providers', requires: 'platform.providers' },
  { key: 'failures', label: 'Failures', href: '/platform/failures', requires: 'platform.health' },
];

/** The destinations a set of permissions reaches, in registry order. */
export function platformDestinationsFor(permissions: ReadonlySet<PlatformCapability>): PlatformDestination[] {
  return PLATFORM_DESTINATIONS.filter((destination) => permissions.has(destination.requires));
}

/**
 * The permission a `/platform/**` path takes: the longest registered prefix wins, so
 * `/platform/catalog/plans/{key}` is the catalogue's and `/platform/organizations/{id}/usage` is the
 * organizations'. A path under `/platform` that matches nothing takes the overview's permission —
 * refusing is the safe answer for a route nobody has classified.
 */
export function platformRouteRequires(pathname: string): PlatformCapability {
  const matches = PLATFORM_DESTINATIONS.filter((destination) =>
    destination.href === '/platform'
      ? pathname === '/platform'
      : pathname === destination.href || pathname.startsWith(`${destination.href}/`),
  );
  if (matches.length === 0) return 'platform.health';
  return matches.reduce((best, item) => (item.href.length > best.href.length ? item : best)).requires;
}
