import { redirect } from 'next/navigation';
import { OrganizationShell } from '@/features/shell/organization-shell';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { platformPermissions } from '@/lib/domain/platform/permissions';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { findGoldInternalOrganization } from '@/lib/domain/tenancy/gold-internal';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';

/**
 * `/platform/**` renders inside the ordinary organization shell — GOLD's own organization — rather
 * than a shell of its own. It is a route namespace for **global** data (organizations, catalogue,
 * providers, commercial); that data stays platform-scoped whichever frame draws it, and every read
 * below still goes through a narrow door that checks `platform_staff` itself.
 *
 * This layout needs three things and refuses without them: a session, at least one platform
 * permission, and a GOLD Internal membership to render inside. Which *part* of the platform a
 * person reaches is checked per area (`requirePlatformArea`, in each area's own layout), so a
 * limited operator is served only what their `platform_staff` row names.
 */
export default async function PlatformLayout({ children }: LayoutProps<'/platform'>) {
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

  return (
    <OrganizationShell organizationId={goldInternal.id} agent="platform">
      {children}
    </OrganizationShell>
  );
}
