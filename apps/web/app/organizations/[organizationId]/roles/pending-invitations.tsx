'use client';

import { useActionState } from 'react';
import { Badge } from '@gold/ui/components/badge';
import { Button } from '@gold/ui/components/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gold/ui/components/table';
import type { PendingInvitation } from '@/lib/domain/tenancy/invitations';
import { revokeInvitationAction, type RevokeInvitationState } from './actions';

const INITIAL: RevokeInvitationState = { error: null };

function RevokeButton({ organizationId, id }: { organizationId: string; id: string }) {
  const [state, formAction, pending] = useActionState(revokeInvitationAction, INITIAL);

  return (
    <form action={formAction}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? 'Revoking…' : 'Revoke'}
      </Button>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
    </form>
  );
}

export function PendingInvitations({
  organizationId,
  invitations,
}: {
  organizationId: string;
  invitations: PendingInvitation[];
}) {
  if (invitations.length === 0) return null;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Expires</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {invitations.map((invitation) => (
          <TableRow key={invitation.id}>
            <TableCell>{invitation.email}</TableCell>
            <TableCell>
              <Badge variant="outline">{invitation.roleName}</Badge>
            </TableCell>
            <TableCell>{new Date(invitation.expiresAt).toLocaleDateString()}</TableCell>
            <TableCell>
              <RevokeButton organizationId={organizationId} id={invitation.id} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
