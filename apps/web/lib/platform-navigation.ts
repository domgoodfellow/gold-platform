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
export type PlatformGroupKey = 'catalog' | 'commercial' | 'infrastructure';

/** The sidebar groups: headings with no page of their own, each opening its first page. */
export const PLATFORM_GROUPS: readonly { key: PlatformGroupKey; label: string }[] = [
  { key: 'catalog', label: 'Catalog' },
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
  /** The sidebar group it sits under. Absent means top level. */
  under?: PlatformGroupKey;
};

export const PLATFORM_DESTINATIONS: readonly PlatformDestination[] = [
  { key: 'overview', label: 'Overview', path: '', requires: 'platform.health' },
  { key: 'organizations', label: 'Organizations', path: 'organizations', requires: 'platform.organizations' },
  { key: 'products', label: 'Products', path: 'catalog', requires: 'platform.catalogue', under: 'catalog' },
  { key: 'plans', label: 'Plans & Add-ons', path: 'catalog/plans', requires: 'platform.catalogue', under: 'catalog' },
  { key: 'meters', label: 'Meters', path: 'catalog/meters', requires: 'platform.catalogue', under: 'catalog' },
  { key: 'connectors', label: 'Connectors', path: 'integrations', requires: 'platform.catalogue', under: 'catalog' },
  { key: 'pricing', label: 'Pricing', path: 'pricing', requires: 'platform.commercial', under: 'commercial' },
  { key: 'usage-economics', label: 'Usage & economics', path: 'usage', requires: 'platform.commercial', under: 'commercial' },
  { key: 'vendor-rates', label: 'Vendor rates', path: 'vendor-rates', requires: 'platform.commercial', under: 'commercial' },
  { key: 'billing', label: 'Billing', path: 'billing', requires: 'platform.commercial', under: 'commercial' },
  { key: 'providers', label: 'Providers', path: 'providers', requires: 'platform.providers', under: 'infrastructure' },
  { key: 'ai-runtime', label: 'AI Runtime', path: 'ai-runtime', requires: 'platform.providers', under: 'infrastructure' },
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

/**
 * The ancestor trail for a Platform destination's own page, read from this one registry rather
 * than a page hand-writing `Infrastructure` or `Catalog` as a string. `Platform` always leads,
 * linking to the root. A destination nested under a sidebar group (`PLATFORM_GROUPS`) adds that
 * group's label — unlinked, since a group opens no page of its own here (its sidebar heading
 * merely borrows its first destination's `href`; the ancestry trail names the group as a label,
 * not a second link to a page the current one may already be). The destination's own page is
 * never included — `PageHeader` appends the current page automatically. A page nested one level
 * further than a registered destination (a product, a plan, a provider) extends this with its own
 * extra crumb rather than this function inventing one.
 */
export function platformAncestry(organizationId: string, destinationKey: string): { label: string; href?: string }[] {
  const destination = PLATFORM_DESTINATIONS.find((candidate) => candidate.key === destinationKey);
  if (!destination) throw new Error(`No platform destination has the key "${destinationKey}".`);
  const trail: { label: string; href?: string }[] = [{ label: 'Platform', href: platformHref(organizationId, '') }];
  if (destination.under) {
    const group = PLATFORM_GROUPS.find((candidate) => candidate.key === destination.under)!;
    trail.push({ label: group.label });
  }
  return trail;
}

const PLATFORM_ROOT = /^\/organizations\/[0-9a-f-]{36}\/platform(?:\/(.*))?$/i;

/** The part of a pathname beneath the platform root, or `null` when the path is not a Platform address. */
export function platformSubpath(pathname: string): string | null {
  const match = PLATFORM_ROOT.exec(pathname.split(/[?#]/)[0].replace(/\/$/, ''));
  return match ? (match[1] ?? '') : null;
}
