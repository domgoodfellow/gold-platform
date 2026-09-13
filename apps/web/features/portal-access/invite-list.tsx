'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, TextInput } from '@/components/controls/inputs';
import { DividedList, GroupHeading } from '@/components/containers/section';
import type { PortalInvite } from '@/lib/domain/portal/portal';

export type RevokePortalInviteState = { error: string | null };

type RevokeAction = (
  previous: RevokePortalInviteState,
  formData: FormData,
) => Promise<RevokePortalInviteState>;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function RevokeButton({
  organizationId,
  customerId,
  inviteId,
  action,
}: {
  organizationId: string;
  customerId: string;
  inviteId: string;
  action: RevokeAction;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="id" value={inviteId} />
      <Button type="submit" tone="danger" size="small" disabled={pending}>
        {pending ? 'Revoking…' : 'Revoke'}
      </Button>
      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

/**
 * Every link this business has made for one customer, split into what still works and what has
 * been withdrawn — not the aggregate count this screen used to show instead. An operator needs
 * to tell two active links apart before revoking one, so each active row carries the same
 * readable, focus-to-select link `PortalLinkForm` shows right after creating it: the token is
 * recoverable by design (`lib/domain/portal/portal.ts`'s own comment on `PortalInvite.token`),
 * not a secret only shown once.
 *
 * A withdrawn row carries no link at all — there is nothing left to send, and repeating a dead
 * token would only invite pasting it somewhere by mistake.
 */
export function PortalInviteList({
  organizationId,
  customerId,
  invites,
  origin,
  revokeAction,
}: {
  organizationId: string;
  customerId: string;
  invites: PortalInvite[];
  origin: string;
  revokeAction: RevokeAction;
}) {
  if (invites.length === 0) return null;

  const active = invites.filter((invite) => invite.revokedAt === null);
  const withdrawn = invites.filter((invite) => invite.revokedAt !== null);

  return (
    <div className="mt-4 flex flex-col gap-4">
      {active.length > 0 ? (
        <div>
          <GroupHeading>Active</GroupHeading>
          <DividedList className="mt-1">
            {active.map((invite) => (
              <li
                key={invite.id}
                className="flex flex-wrap items-start justify-between gap-3 py-2"
              >
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                  <span className="text-muted">Created {formatDate(invite.createdAt)}</span>
                  <TextInput
                    readOnly
                    value={`${origin}/portal/${invite.token}`}
                    onFocus={(event) => event.currentTarget.select()}
                    className="w-full font-mono text-xs"
                    aria-label={`Portal link created ${formatDate(invite.createdAt)}`}
                  />
                </label>
                <RevokeButton
                  organizationId={organizationId}
                  customerId={customerId}
                  inviteId={invite.id}
                  action={revokeAction}
                />
              </li>
            ))}
          </DividedList>
        </div>
      ) : null}

      {withdrawn.length > 0 ? (
        <div>
          <GroupHeading>Withdrawn</GroupHeading>
          <DividedList className="mt-1">
            {withdrawn.map((invite) => (
              <li key={invite.id} className="py-2 text-sm text-subtle">
                Created {formatDate(invite.createdAt)} — withdrawn{' '}
                {invite.revokedAt ? formatDate(invite.revokedAt) : ''}
              </li>
            ))}
          </DividedList>
        </div>
      ) : null}
    </div>
  );
}
