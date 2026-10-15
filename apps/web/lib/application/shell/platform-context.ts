import type { Db } from '@/lib/db/types';
import { platformPermissions, type PlatformCapability } from '@/lib/domain/platform/permissions';
import { isOperatingOrganization } from '@/lib/domain/platform/operating-organization';

/**
 * The platform permissions a person may use **in this organization's shell**: none unless it is
 * GildOps' operating organization and they are a member of it. Authority comes from the live
 * `platform_staff` row, never a tenant role, a name or a Plan; a staff member working inside a
 * customer's organization gets null there.
 */
export async function loadPlatformContext(
  db: Db,
  organizationId: string,
): Promise<{ organizationId: string; permissions: ReadonlySet<PlatformCapability> } | null> {
  const permissions = await platformPermissions(db);
  if (permissions.size === 0) return null;
  if (!(await isOperatingOrganization(db, { organizationId }))) return null;
  return { organizationId, permissions };
}
