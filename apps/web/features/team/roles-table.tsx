'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { DataTable } from '@/components/display/table';
import type { Role } from '@/lib/domain/tenancy/roles';
import { teamViewHref } from './team-views';

/** A neutral count rather than a capability's own name or a subjective label the platform did not decide. */
function permissionSummary(count: number): string {
  if (count === 0) return 'No permissions';
  return `${count} ${count === 1 ? 'permission' : 'permissions'}`;
}

/**
 * Roles as a compact collection: a name, how many people hold it and a permission count, never
 * every capability expanded. A manager opens a role's own page to read or change it.
 */
export function RolesTable({
  organizationId,
  roles,
  memberCounts,
  mayManage,
  deleted = false,
}: {
  organizationId: string;
  roles: Role[];
  memberCounts: ReadonlyMap<string, number>;
  mayManage: boolean;
  deleted?: boolean;
}) {
  useEffect(() => {
    if (!deleted) return;
    toast.success('Role deleted', { id: 'role-deleted' });
    window.history.replaceState(null, '', teamViewHref(organizationId, 'roles'));
  }, [deleted, organizationId]);

  return (
    <DataTable
      rows={roles}
      rowKey={(role) => role.id}
      empty="No roles yet."
      columns={[
        {
          key: 'name',
          header: 'Role',
          emphasis: 'primary',
          cell: (role) =>
            mayManage ? (
              <Link href={`${teamViewHref(organizationId, 'roles')}/${role.id}`} className="font-medium underline-offset-4 hover:underline">{role.name}</Link>
            ) : (
              role.name
            ),
        },
        { key: 'members', header: 'Members', numeric: true, cell: (role) => memberCounts.get(role.id) ?? 0 },
        {
          key: 'permissions',
          header: 'Permissions',
          cell: (role) => permissionSummary(role.capabilities.length),
        },
      ]}
    />
  );
}
