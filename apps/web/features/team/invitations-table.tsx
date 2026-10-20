import { DataTable } from '@/components/display/table';
import type { InvitationDeliveryStatus, PendingInvitation } from '@/lib/domain/tenancy/invitations';
import { InvitationDeliveryBadge } from './invitation-delivery-badge';
import { ResendInvitationButton } from './resend-invitation-button';
import { RevokeInvitationDialog } from './revoke-invitation-dialog';

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'Not yet';
}

/** Pending invitations as a compact collection, replacing the raw shadcn Table with a direct-submit Revoke. */
export function InvitationsTable({
  organizationId,
  invitations,
  deliveryStatus,
  mayManage,
}: {
  organizationId: string;
  invitations: PendingInvitation[];
  deliveryStatus: Map<string, InvitationDeliveryStatus>;
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
          key: 'delivery',
          header: 'Delivery',
          cell: (invitation) => <InvitationDeliveryBadge state={deliveryStatus.get(invitation.id)?.state ?? null} detail={deliveryStatus.get(invitation.id)?.detail ?? null} />,
        },
        {
          key: 'lastSent',
          header: 'Last attempt',
          visibility: 'card-only',
          cell: (invitation) => when(deliveryStatus.get(invitation.id)?.occurredAt ?? null),
        },
        {
          key: 'expires',
          header: 'Expires',
          cell: (invitation) => new Date(invitation.expiresAt).toLocaleDateString(),
        },
      ]}
      actions={
        mayManage
          ? (invitation) => (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <ResendInvitationButton organizationId={organizationId} invitation={invitation} />
                <RevokeInvitationDialog organizationId={organizationId} invitation={invitation} />
              </div>
            )
          : undefined
      }
    />
  );
}
