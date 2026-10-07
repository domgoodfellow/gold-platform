/** The organization route container. Platform routes retain this URL container while the
 * shell presents a separate system context. The URL supplies no platform authority.
 */

const ORGANIZATION_PATH = /^\/organizations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

/** The business a path is in: `/organizations/{uuid}/…`. */
export function organizationIdFromPath(pathname: string): string | null {
  return ORGANIZATION_PATH.exec(pathname)?.[1] ?? null;
}
