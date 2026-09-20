/**
 * Whether the context switcher offers *Platform Administration*. Platform is a scope one identity
 * holds by platform authority, never a business, so it is offered beside the businesses and not in
 * them (D45). Both facts are required because `/platform` renders inside the caller's GOLD
 * Internal membership: staff without one would be offered a door onto the configuration-required
 * refusal, which is not a context they can be in.
 */
export function platformAdministrationAvailable(input: {
  staff: boolean;
  goldInternal: { id: string } | null | undefined;
}): boolean {
  return input.staff && Boolean(input.goldInternal);
}

/** The Platform context is a path, exactly as a business is: `/platform` and everything beneath it. */
export function inPlatformContext(pathname: string): boolean {
  return pathname === '/platform' || pathname.startsWith('/platform/');
}

const ORGANIZATION_PATH = /^\/organizations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

/** The business a path is in, exactly as the Platform context is a path: `/organizations/{uuid}/…`. */
export function organizationIdFromPath(pathname: string): string | null {
  return ORGANIZATION_PATH.exec(pathname)?.[1] ?? null;
}
