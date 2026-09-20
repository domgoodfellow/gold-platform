import { DataTable } from '@/components/display/table';
import type { PendingInvitation } from '@/lib/domain/tenancy/invitations';
import { RevokeInvitationDialog } from './revoke-invitation-dialog';

/** Pending invitations as a compact collection, replacing the raw shadcn Table with a direct-submit Revoke. */
export function InvitationsTable({
  organizationId,
  invitations,
  mayManage,
}: {
  organizationId: string;
  invitations: PendingInvitation[];
  mayManage: boolean;
}) {
  return (
    <DataTable
      rows={invitations}
      rowKey={(invitation) => invitation.id}
      empty="No pending invitations."
      columns={[
        { key: 'email', header: 'Email', emphasis: 'primary', cell: (invitation) => invitation.email },
        { key: 'role', header: 'Role', cell: (invitation) => invitation.roleName },
        {
          key: 'expires',
          header: 'Expires',
          cell: (invitation) => new Date(invitation.expiresAt).toLocaleDateString(),
        },
      ]}
      actions={
        mayManage
          ? (invitation) => <RevokeInvitationDialog organizationId={organizationId} invitation={invitation} />
          : undefined
      }
    />
  );
}
