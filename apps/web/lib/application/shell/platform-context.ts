import type { Db } from '@/lib/db/types';
import { platformPermissions } from '@/lib/domain/platform/permissions';
import { findGoldInternalOrganization } from '@/lib/domain/tenancy/gold-internal';
import { projectPlatformShell } from '@/lib/shell';
import { platformHref } from '@/lib/platform-navigation';

/** Authority comes from the canonical live platform permissions, never a tenant role or name. */
export async function loadPlatformContext(db: Db, organizations: readonly { id: string }[]) {
  const permissions = await platformPermissions(db);
  if (permissions.size === 0) return null;
  const gold = await findGoldInternalOrganization(db, organizations);
  if (!gold) return null;
  return { organizationId: gold.id, href: platformHref(gold.id), sections: projectPlatformShell(gold.id, permissions) };
}
