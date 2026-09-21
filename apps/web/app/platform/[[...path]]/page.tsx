import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { platformPermissions } from '@/lib/domain/platform/permissions';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { findGoldInternalOrganization } from '@/lib/domain/tenancy/gold-internal';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import { platformHref } from '@/lib/platform-navigation';

export const dynamic = 'force-dynamic';

/**
 * The old Platform address, kept only so a bookmark, an email or an open tab still lands
 * somewhere: `/platform/{rest}?{query}` becomes `/organizations/{goldId}/platform/{rest}?{query}`.
 * It renders nothing and owns no Platform page — the canonical tree is the nested one, and nothing
 * in the application generates a `/platform/**` link any more.
 *
 * It redirects only an operator who holds a platform permission *and* a real membership of GOLD's
 * own organization. The target is resolved from the caller's memberships and GOLD's current Plan,
 * never from the URL, and the canonical route then runs its own guards: this redirect proves
 * nothing and is not the boundary. Somebody with no platform permission is sent where they
 * would have been sent before, which does not confirm that a Platform exists.
 */
export default async function LegacyPlatformRoute({ params, searchParams }: PageProps<'/platform/[[...path]]'>) {
  const db = await getDb();
  try {
    await requireActor(db);
  } catch (error) {
    if (error instanceof DomainError && error.code === 'auth.required') redirect('/login');
    throw error;
  }

  const permissions = await platformPermissions(db);
  if (permissions.size === 0) redirect('/organizations');

  const myOrganizations = await listMyOrganizations(db);
  const goldInternal = await findGoldInternalOrganization(db, myOrganizations);
  if (!goldInternal) {
    console.error('GOLD Internal workspace invariant is not satisfied for platform route.', {
      permissions: [...permissions],
      membershipOrganizationIds: myOrganizations.map((organization) => organization.id),
    });
    throw new DomainError(
      'GOLD Internal workspace is not configured for this platform operator.',
      'gold_internal.configuration_required',
    );
  }

  const { path = [] } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, entry);
  }
  const search = query.size > 0 ? `?${query.toString()}` : '';

  redirect(`${platformHref(goldInternal.id, path.map(encodeURIComponent).join('/'))}${search}`);
}
