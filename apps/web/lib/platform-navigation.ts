import type { PlatformCapability } from '@/lib/domain/platform/permissions';
import type { WorkspaceKey } from '@/lib/navigation';

/**
 * Platform Administration's destinations and what each one takes to reach. One registry for the
 * sidebar, the phone menu, breadcrumbs and the route guard, so a destination cannot be offered by
 * one and refused by another. Presentation (icons) lives with the renderer, keyed by `key`.
 *
 * Administration is a privileged scope inside GildOps' own organization, never a second identity:
 * its routes are served at `/platform/**` for the configured operating organization and its data
 * stays system-scoped. Only live platform permissions offer these destinations.
 */
export const ADMINISTRATION_LABEL = 'Administration';

export type PlatformGroupKey = 'product-registry' | 'integration-registry' | 'infrastructure' | 'reliability' | 'commercial';

/**
 * The navigation groups: headings with no page of their own, each opening its first page.
 *
 * `linkedFrom` names a workspace whose own navigation also links in, because GildOps operators
 * reach this administration from that work (AI Runtime from AI). The pages stay in Administration —
 * the link is a way in, never a second home. Commercial administration is not linked from Finance:
 * it holds the existing platform-billing records and GildOps' private provider economics, which
 * Finance must never read. Selling itself belongs to organization Finance; these records stay here
 * only until a reviewed migration moves GildOps' selling there (ADR-051).
 */
export const PLATFORM_GROUPS: readonly { key: PlatformGroupKey; label: string; linkedFrom?: WorkspaceKey }[] = [
  { key: 'product-registry', label: 'Product Registry' },
  { key: 'integration-registry', label: 'Integration Registry' },
  { key: 'infrastructure', label: 'Infrastructure' },
  { key: 'reliability', label: 'Reliability' },
  // Not linked from Finance: transitional platform-billing records and private economics (ADR-051).
  { key: 'commercial', label: 'Commercial administration' },
];

export type PlatformDestination = {
  key: string;
  label: string;
  /** Beneath `/organizations/{goldId}/platform`; the empty string is the overview. Read it with `platformHref`. */
  path: string;
  /** The one platform permission that reaches this destination. */
  requires: PlatformCapability;
  /** The group it sits under. Absent means top level of Administration. */
  under?: PlatformGroupKey;
  /** A workspace whose own navigation also links here; see `PLATFORM_GROUPS`. */
  linkedFrom?: WorkspaceKey;
};

/** Registry order is landing order: a person without the overview lands on the first one they hold. */
export const PLATFORM_DESTINATIONS: readonly PlatformDestination[] = [
  { key: 'overview', label: 'Overview', path: '', requires: 'platform.health' },
  { key: 'organizations', label: 'Organizations', path: 'organizations', requires: 'platform.organizations' },
  { key: 'products', label: 'Products', path: 'catalog', requires: 'platform.catalogue', under: 'product-registry' },
  { key: 'meters', label: 'Meters', path: 'catalog/meters', requires: 'platform.catalogue', under: 'product-registry' },
  { key: 'connectors', label: 'Connectors', path: 'integrations', requires: 'platform.catalogue', under: 'integration-registry' },
  { key: 'providers', label: 'Providers', path: 'providers', requires: 'platform.providers', under: 'infrastructure' },
  { key: 'ai-runtime', label: 'AI Runtime', path: 'ai-runtime', requires: 'platform.providers', under: 'infrastructure', linkedFrom: 'ai' },
  { key: 'failures', label: 'Failures', path: 'failures', requires: 'platform.health', under: 'reliability' },
  { key: 'plans', label: 'Plans & Add-ons', path: 'plans', requires: 'platform.commercial', under: 'commercial' },
  { key: 'pricing', label: 'Pricing', path: 'pricing', requires: 'platform.commercial', under: 'commercial' },
  { key: 'usage-economics', label: 'Usage & economics', path: 'usage', requires: 'platform.commercial', under: 'commercial' },
  { key: 'vendor-rates', label: 'Vendor rates', path: 'vendor-rates', requires: 'platform.commercial', under: 'commercial' },
  { key: 'package-economics', label: 'Package economics', path: 'package-economics', requires: 'platform.commercial', under: 'commercial' },
  { key: 'portfolio-economics', label: 'Portfolio economics', path: 'economics', requires: 'platform.commercial', under: 'commercial' },
  { key: 'billing', label: 'Billing', path: 'billing', requires: 'platform.commercial', under: 'commercial' },
];

/**
 * The one way to spell a Platform address. `organizationId` is GildOps' operating organization —
 * the context the operator is working in — never the subject of the page.
 */
export function platformHref(_organizationId: string, path = ''): string {
  return `/platform${path ? `/${path}` : ''}`;
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
 * The ancestor trail for a destination's own page, read from this registry rather than a page
 * hand-writing a group name. `Administration` always leads, linking to its root — never the
 * workspace a link came from, because the page is Administration's. The group follows as an
 * unlinked label, since a group opens no page of its own. The destination's own page is never
 * included — `PageHeader` appends it. A page nested further (a product, a plan, a provider)
 * extends this with its own crumb.
 */
export function platformAncestry(organizationId: string, destinationKey: string): { label: string; href?: string }[] {
  const destination = PLATFORM_DESTINATIONS.find((candidate) => candidate.key === destinationKey);
  if (!destination) throw new Error(`No platform destination has the key "${destinationKey}".`);
  const trail: { label: string; href?: string }[] = [{ label: ADMINISTRATION_LABEL, href: platformHref(organizationId, '') }];
  if (destination.under) trail.push({ label: PLATFORM_GROUPS.find((candidate) => candidate.key === destination.under)!.label });
  return trail;
}

const PLATFORM_ROOT = /^\/platform(?:\/(.*))?$/i;

/** The part of a pathname beneath the platform root, or `null` when the path is not a Platform address. */
export function platformSubpath(pathname: string): string | null {
  const match = PLATFORM_ROOT.exec(pathname.split(/[?#]/)[0].replace(/\/$/, ''));
  return match ? (match[1] ?? '') : null;
}
