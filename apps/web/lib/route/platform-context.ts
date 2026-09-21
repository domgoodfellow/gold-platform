/**
 * Where a path sits. Platform is no longer a separate frame, but `/platform/**` is still a route
 * namespace for global data, and a business is still a path: these read them, nothing more.
 */

/** The Platform namespace: `/platform` and everything beneath it. It renders inside GOLD's own organization shell. */
export function inPlatformContext(pathname: string): boolean {
  return pathname === '/platform' || pathname.startsWith('/platform/');
}

const ORGANIZATION_PATH = /^\/organizations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

/** The business a path is in, exactly as the Platform namespace is a path: `/organizations/{uuid}/…`. */
export function organizationIdFromPath(pathname: string): string | null {
  return ORGANIZATION_PATH.exec(pathname)?.[1] ?? null;
}
