/**
 * Where a path sits: which business it is in. Platform Administration is not a context of its own —
 * `/organizations/{goldId}/platform/**` is a sub-scope of GOLD's own organization — so this reads
 * the organization from a path and nothing else. (`platformSubpath`, in `lib/platform-navigation.ts`,
 * says whether that path is inside the Platform sub-scope.)
 */

const ORGANIZATION_PATH = /^\/organizations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

/** The business a path is in: `/organizations/{uuid}/…`. */
export function organizationIdFromPath(pathname: string): string | null {
  return ORGANIZATION_PATH.exec(pathname)?.[1] ?? null;
}
