import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import {
  PLATFORM_CAPABILITY_LABELS,
  platformPermissions,
  type PlatformCapability,
} from '@/lib/domain/platform/permissions';
import { callerOperatingOrganization, isOperatingOrganization } from '@/lib/domain/platform/operating-organization';
import type { Organization } from '@/lib/domain/tenancy/organizations';
import { platformDestinationsFor, platformHref } from '@/lib/platform-navigation';
import { requireOrganizationForBillingRecovery } from '@/lib/route/organization';

/**
 * The guard for the whole `/organizations/{id}/platform/**` namespace, proving three facts and
 * refusing with `notFound()` unless all three hold:
 *
 *   the caller is a member of the requested organization (the membership guard — a non-member and
 *     a missing organization are indistinguishable);
 *   that organization is GildOps' operating organization, as `platform_settings` designates it —
 *     never its Plan, its name or the caller's platform authority;
 *   the caller holds at least one platform permission on their own `platform_staff` row.
 *
 * Platform being nested under an organization is application context, not ownership: nothing
 * below this filters platform data by that organization. It uses the billing-recovery membership
 * guard because the platform console must stay reachable while GildOps' own service access is locked.
 * A route naming another organization — even for platform staff — is a 404, the same answer as for
 * anybody else.
 */
export const requirePlatformScope = cache(
  async (
    organizationId: string,
  ): Promise<{ db: Db; organization: Organization; permissions: ReadonlySet<PlatformCapability> }> => {
    const { db, organization } = await requireOrganizationForBillingRecovery(organizationId);
    if (!(await isOperatingOrganization(db, { organizationId }))) notFound();

    const permissions = await platformPermissions(db);
    if (permissions.size === 0) notFound();
    return { db, organization, permissions };
  },
);

/**
 * The guard a Platform area runs for itself, after the scope guard. The navigation already hides
 * what a person's `platform_staff` row does not name; this is what makes hiding courtesy rather
 * than the boundary — a limited operator who types the URL is refused here, on the server, by the
 * same row.
 *
 * `landing` is for the overview, which is where a sign-in lands: somebody without its permission is
 * sent to the first destination they do hold rather than shown a 404 for the front door. Any other
 * area answers `notFound()`, so a route is not confirmed to somebody who may not reach it.
 */
export async function requirePlatformArea(
  organizationId: string,
  required: PlatformCapability,
  options: { landing?: boolean } = {},
): Promise<ReadonlySet<PlatformCapability>> {
  const { permissions } = await requirePlatformScope(organizationId);
  if (permissions.has(required)) return permissions;

  const first = platformDestinationsFor(permissions)[0];
  if (options.landing && first) redirect(platformHref(organizationId, first.path));
  notFound();
}

/**
 * GildOps' operating organization id, for the callers that have no route parameter to read it from
 * (a server action redirecting after a write). Null unless the caller is a member of it; never read
 * from anything the caller sent.
 */
export async function callerOperatingOrganizationId(): Promise<string | null> {
  return (await callerOperatingOrganization(await getDb()))?.id ?? null;
}

/** The caller's own Platform address. See `callerOperatingOrganizationId`. */
export async function callerPlatformHref(path = ''): Promise<string | null> {
  const operatingId = await callerOperatingOrganizationId();
  return operatingId ? platformHref(operatingId, path) : null;
}

/**
 * Drop every cached Platform page. A platform write can change any of them (a plan's price shows on
 * the catalogue, billing and an organization's commercial page), and naming each would be a list to
 * keep in step with the routes.
 */
export function revalidatePlatform(): void {
  revalidatePath('/organizations/[organizationId]/platform', 'layout');
}

/**
 * The capability guard a Platform **server action** runs for itself.
 *
 * `requirePlatformArea` is the route-shaped guard: it answers `notFound()`/`redirect()`, which a
 * server action that wraps its work in a try/catch would swallow into an error message. This one
 * proves the same three facts and throws a `DomainError` an action can report:
 *
 *   GildOps' operating organization with the caller's membership of it, both answered by
 *     `callerOperatingOrganization` — never from a `goldId` a form supplied, which is a parameter
 *     the caller chose (D17);
 *   the permission, read live from the caller's own `platform_staff` row (D45).
 *
 * **UI visibility is not an authorization boundary.** Every canonical commercial mutation calls
 * this before it writes, and the function behind it checks `app.require_platform_capability`
 * again — the screen hiding a control is courtesy, these two are the boundary.
 */
export async function requirePlatformCapability(required: PlatformCapability): Promise<string> {
  const goldId = await callerOperatingOrganizationId();
  if (!goldId) {
    throw new DomainError('Only GildOps platform staff may do this.', 'platform.capability_denied');
  }
  const permissions = await platformPermissions(await getDb());
  if (!permissions.has(required)) {
    throw new DomainError(
      `This needs the "${PLATFORM_CAPABILITY_LABELS[required]}" platform permission.`,
      'platform.capability_denied',
    );
  }
  return goldId;
}
