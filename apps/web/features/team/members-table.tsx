import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import type { Member } from '@/lib/domain/tenancy/members';
import type { Role } from '@/lib/domain/tenancy/roles';
import { RoleAssignmentControl } from './role-assignment-control';

/**
 * Members as a compact collection — name and role, the only two facts a membership carries
 * (no mirrored profile). Role assignment stays inline for a manager; the last-manager and
 * ownership invariants stay in the database, not repeated here.
 */
export function MembersTable({
  organizationId,
  members,
  roles,
  assignableRoleIds,
  mayManage,
}: {
  organizationId: string;
  members: Member[];
  roles: Role[];
  /** Roles the person managing may put somebody on: those whose permissions they hold themselves. */
  assignableRoleIds: ReadonlySet<string>;
  mayManage: boolean;
}) {
  return (
    <DataTable
      rows={members}
      rowKey={(member) => member.id}
      empty="Nobody here yet."
      columns={[
        { key: 'name', header: 'Name', emphasis: 'primary', cell: (member) => member.displayName },
        {
          key: 'role',
          header: 'Role',
          cell: (member) =>
            mayManage ? (
              <RoleAssignmentControl
                organizationId={organizationId}
                membershipId={member.id}
                memberName={member.displayName}
                currentRoleId={member.role.id}
                roles={roles}
                assignableRoleIds={assignableRoleIds}
              />
            ) : (
              <Badge>{member.role.name}</Badge>
            ),
        },
      ]}
    />
  );
}
