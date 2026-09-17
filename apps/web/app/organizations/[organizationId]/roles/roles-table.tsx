import type { ReactNode } from 'react';
import { DataTable } from '@/components/display/table';
import type { Role } from '@/lib/domain/tenancy/roles';
import { EditRoleSheet } from './edit-role-sheet';

/** A neutral count rather than a capability's own name or a subjective label the platform did not decide. */
function permissionSummary(count: number): string {
  if (count === 0) return 'No permissions';
  return `${count} ${count === 1 ? 'permission' : 'permissions'}`;
}

/**
 * Roles as a compact collection — a name and a permission count, never every capability
 * expanded as a badge. The detail lives in `EditRoleSheet`, which already shares
 * `CapabilitySelector` with `CreateRoleSheet`.
 */
export function RolesTable({
  organizationId,
  roles,
  mayManage,
  emptyAction,
}: {
  organizationId: string;
  roles: Role[];
  mayManage: boolean;
  emptyAction?: ReactNode;
}) {
  return (
    <DataTable
      rows={roles}
      rowKey={(role) => role.id}
      empty="No roles yet."
      emptyAction={emptyAction}
      columns={[
        { key: 'name', header: 'Role', emphasis: 'primary', cell: (role) => role.name },
        {
          key: 'permissions',
          header: 'Permissions',
          cell: (role) => permissionSummary(role.capabilities.length),
        },
      ]}
      actions={
        mayManage ? (role) => <EditRoleSheet organizationId={organizationId} role={role} /> : undefined
      }
    />
  );
}
