import type { Db } from '@/lib/db/types';
import { platformPermissions } from '@/lib/domain/platform/permissions';
import { callerOperatingOrganization } from '@/lib/domain/platform/operating-organization';
import { projectPlatformShell } from '@/lib/shell';
import { platformHref } from '@/lib/platform-navigation';

/** Authority comes from the canonical live platform permissions, never a tenant role or name. */
export async function loadPlatformContext(db: Db) {
  const permissions = await platformPermissions(db);
  if (permissions.size === 0) return null;
  const operating = await callerOperatingOrganization(db);
  if (!operating) return null;
  return { organizationId: operating.id, href: platformHref(operating.id), sections: projectPlatformShell(operating.id, permissions) };
}
