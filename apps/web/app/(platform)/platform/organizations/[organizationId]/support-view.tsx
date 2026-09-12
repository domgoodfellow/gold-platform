'use client';

import { useActionState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@gold/ui/components/alert';
import { Button } from '@gold/ui/components/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@gold/ui/components/table';
import { TextInput } from '@/components/controls/inputs';
import type { SupportMember, SupportSession } from '@/lib/domain/platform/support';
import {
  endSupportSessionAction,
  startSupportSessionAction,
  SUPPORT_SESSION_INITIAL,
} from './actions';

/**
 * Support access, on screen. There is no button anywhere that reaches a tenant's own operating
 * data (customers, work items, and the rest) — opening a session only reveals what
 * `platform_staff` could already read in full (D28): the organization itself and who is a
 * member of it. `requireOrganization`'s own boundary for the tenant's real shell is unchanged.
 */

export function SupportSessionOpener({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState(startSupportSessionAction, SUPPORT_SESSION_INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input type="hidden" name="organizationId" value={organizationId} />
      <TextInput
        name="reason"
        placeholder="Why are you opening this business? (optional)"
        className="flex-1"
        aria-label="Reason"
      />
      <Button type="submit" disabled={pending}>
        {pending ? 'Opening…' : 'Open organization'}
      </Button>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
    </form>
  );
}

export function SupportSessionBanner({
  organizationId,
  session,
  members,
}: {
  organizationId: string;
  session: SupportSession;
  members: SupportMember[];
}) {
  const [state, formAction, pending] = useActionState(endSupportSessionAction, SUPPORT_SESSION_INITIAL);
  const expires = new Date(session.expiresAt).toLocaleString();

  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <AlertTitle>Platform Support View</AlertTitle>
        <AlertDescription>
          <p>
            You opened this organization as GOLD staff{session.reason ? ` — “${session.reason}”` : ''}.
            This session ends {expires} unless you end it now.
          </p>
          <form action={formAction} className="mt-2">
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="sessionId" value={session.id} />
            <Button type="submit" variant="outline" size="sm" disabled={pending}>
              {pending ? 'Ending…' : 'End support view'}
            </Button>
            {state.error ? <p className="mt-1 text-sm text-destructive">{state.error}</p> : null}
          </form>
        </AlertDescription>
      </Alert>

      <div>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">
          People ({members.length})
        </h3>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody here yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>{member.displayName}</TableCell>
                  <TableCell>{new Date(member.createdAt).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
