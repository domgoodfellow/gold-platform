import { notFound, redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { platformPermissions, type PlatformCapability } from '@/lib/domain/platform/permissions';
import { platformDestinationsFor } from '@/lib/platform-navigation';

/**
 * The guard a `/platform/**` area runs for itself. The navigation already hides what a person's
 * `platform_staff` row does not name; this is what makes hiding courtesy rather than the boundary —
 * a limited operator who types the URL is refused here, on the server, by the same row.
 *
 * `landing` is for the overview, which is where a sign-in lands: somebody without its permission is
 * sent to the first destination they do hold rather than shown a 404 for the front door. Any other
 * area answers `notFound()`, so a route is not confirmed to somebody who may not reach it.
 */
export async function requirePlatformArea(
  required: PlatformCapability,
  options: { landing?: boolean } = {},
): Promise<ReadonlySet<PlatformCapability>> {
  const db = await getDb();
  const permissions = await platformPermissions(db);

  if (permissions.has(required)) return permissions;

  const first = platformDestinationsFor(permissions)[0];
  if (!first) redirect('/organizations');
  if (options.landing) redirect(first.href);
  notFound();
}
