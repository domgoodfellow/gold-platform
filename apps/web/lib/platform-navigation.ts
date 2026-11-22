import type { PlatformCapability } from '@/lib/domain/platform/permissions';
import type { WorkspaceKey } from '@/lib/navigation';

/**
 * Administration's destinations and what each one takes to reach. One registry for the sidebar,
 * the phone menu, breadcrumbs and the route guard, so a destination cannot be offered by one and
 * refused by another. Presentation (icons) lives with the renderer, keyed by `key`.
 *
 * Administration is a privileged context of GildOps' own organization, drawn by the same
 * organization shell as every workspace and served at `/organizations/{goldId}/administration/**`.
 * It runs the platform: provisioning, the feature registry, providers, runtimes and reliability.
 * It has no financial destination: plans, prices, subscriptions, supplier costs and margins are
 * GildOps' Finance (ADR-057), reached with Finance permissions and never with these.
 */
export const ADMINISTRATION_LABEL = 'Administration';

export type PlatformGroupKey = 'product-registry' | 'integration-registry' | 'infrastructure' | 'reliability';

/**
 * The navigation groups: headings with no page of their own, each opening its first page.
 *
 * `linkedFrom` names a workspace whose own navigation also links in, because GildOps operators
 * reach this administration from that work (AI answering from AI). The pages stay in
 * Administration — the link is a way in, never a second home.
 */
export const PLATFORM_GROUPS: readonly { key: PlatformGroupKey; label: string; linkedFrom?: WorkspaceKey }[] = [
  { key: 'product-registry', label: 'Product Registry' },
  { key: 'integration-registry', label: 'Integration Registry' },
  { key: 'infrastructure', label: 'Infrastructure' },
  { key: 'reliability', label: 'Reliability' },
];

export type PlatformDestination = {
  key: string;
  label: string;
  /** Beneath `/organizations/{goldId}/administration`; the empty string is the overview. Read it with `platformHref`. */
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
  { key: 'providers', label: 'Vendors', path: 'providers', requires: 'platform.providers', under: 'infrastructure' },
  { key: 'ai-runtime', label: 'AI answering', path: 'ai-runtime', requires: 'platform.providers', under: 'infrastructure', linkedFrom: 'ai' },
  { key: 'failures', label: 'Failures', path: 'failures', requires: 'platform.health', under: 'reliability' },
  { key: 'billing-deliveries', label: 'Billing deliveries', path: 'billing-deliveries', requires: 'platform.health', under: 'reliability' },
];

/** The route segment Administration is served under, beneath GildOps' organization. */
export const ADMINISTRATION_SEGMENT = 'administration';

/**
 * The one way to spell an Administration address. `organizationId` is GildOps' operating
 * organization — the context the operator is working in — never the subject of the page.
 */
export function platformHref(organizationId: string, path = ''): string {
  return `/organizations/${organizationId}/${ADMINISTRATION_SEGMENT}${path ? `/${path}` : ''}`;
}

/** The destinations a set of permissions reaches, in registry order. */
export function platformDestinationsFor(permissions: ReadonlySet<PlatformCapability>): PlatformDestination[] {
  return PLATFORM_DESTINATIONS.filter((destination) => permissions.has(destination.requires));
}

/**
 * The permission an Administration path takes, given the path **beneath the Administration root**
 * (`catalog/meters`, not the whole URL): the longest registered prefix wins, so
 * `catalog/products/{key}` is the catalogue's and `organizations/{id}/usage` is the organizations'.
 * A path that matches nothing takes the overview's permission — refusing is the safe answer for a
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
 * hand-writing a group name. `Administration` always leads, linking to its root. The group
 * follows as an unlinked label, since a group opens no page of its own. The destination's own
 * page is never included — `PageHeader` appends it. A page nested further (a product, a
 * provider) extends this with its own crumb.
 */
export function platformAncestry(organizationId: string, destinationKey: string): { label: string; href?: string }[] {
  const destination = PLATFORM_DESTINATIONS.find((candidate) => candidate.key === destinationKey);
  if (!destination) throw new Error(`No platform destination has the key "${destinationKey}".`);
  const trail: { label: string; href?: string }[] = [{ label: ADMINISTRATION_LABEL, href: platformHref(organizationId, '') }];
  if (destination.under) trail.push({ label: PLATFORM_GROUPS.find((candidate) => candidate.key === destination.under)!.label });
  return trail;
}

const ADMINISTRATION_ROOT = /^\/organizations\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/administration(?:\/(.*))?$/i;

/** The part of a pathname beneath the Administration root, or `null` when the path is not an Administration address. */
export function platformSubpath(pathname: string): string | null {
  const match = ADMINISTRATION_ROOT.exec(pathname.split(/[?#]/)[0].replace(/\/$/, ''));
  return match ? (match[1] ?? '') : null;
}
