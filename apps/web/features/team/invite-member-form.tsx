'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/controls/button';
import { CopyField } from '@/components/controls/copy-field';
import { ErrorText, Hint, SelectInput, TextInput } from '@/components/controls/inputs';
import type { Role } from '@/lib/domain/tenancy/roles';
import { inviteMemberAction, type InviteMemberState } from '@/app/organizations/[organizationId]/settings/access/actions';

const INITIAL: InviteMemberState = { error: null, link: null, email: null };

/**
 * The shared Add member dialog owns the bounded creation surface; this component owns only the
 * invite-by-email operation, including its post-success copyable-link state.
 */
export function InviteMemberForm({
  organizationId,
  roles,
}: {
  organizationId: string;
  roles: Role[];
}) {
  const [state, formAction, pending] = useActionState(inviteMemberAction, INITIAL);

  if (roles.length === 0) {
    return <Hint className="mt-4">Create a role before inviting people.</Hint>;
  }

  if (state.link) {
    return <InvitationResult link={state.link} email={state.email} />;
  }

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <Hint weight="subtle">
        GildOps emails them a link to join with the role you choose. They don&rsquo;t need an
        account yet, and the link works only for this email address.
      </Hint>

      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          name="email"
          type="email"
          required
          placeholder="Their email address"
          aria-label="Email address"
          className="flex-1"
        />
        <SelectInput name="roleId" aria-label="Role" className="flex-1">
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </SelectInput>
      </div>

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Inviting…' : 'Send invitation'}
      </Button>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

/**
 * What happened, without overstating it. Accepted for delivery is not "delivered": arrival shows
 * later under Pending invitations. When the email did not go, the reason is shown and the link is
 * offered as the way to share it yourself; when it did, the link stays behind an explicit choice.
 */
export function InvitationResult({ link, email, label = 'Invitation link' }: { link: string; email: InviteMemberState['email']; label?: string }) {
  const [showLink, setShowLink] = useState(false);

  if (email?.accepted) {
    return (
      <div className="mt-4 flex flex-col gap-3">
        <Hint role="status">
          Invitation emailed. GildOps&rsquo; mail service accepted it for delivery; whether it arrived
          shows under Pending invitations.
        </Hint>
        {showLink ? (
          <CopyField value={link} label={label} copiedMessage="Invitation link copied" />
        ) : (
          <Button type="button" tone="text" className="w-fit" onClick={() => setShowLink(true)}>
            Copy the invitation link instead
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <p role="status" className="text-sm text-danger">
        Invitation created, but it was not emailed. {email?.reason ?? ''}
      </p>
      <Hint>
        You can copy the link and send it to them yourself, or use Resend under Pending
        invitations once email is working.
      </Hint>
      <CopyField value={link} label={label} copiedMessage="Invitation link copied" />
    </div>
  );
}
