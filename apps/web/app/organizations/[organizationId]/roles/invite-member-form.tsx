'use client';

import { useActionState, useState } from 'react';
import { Button } from '@gold/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@gold/ui/components/dialog';
import { ErrorText, SelectInput, TextInput } from '@/components/controls/inputs';
import type { Role } from '@/lib/domain/tenancy/roles';
import { inviteMemberAction, type InviteMemberState } from './actions';

const INITIAL: InviteMemberState = { error: null, link: null };

export function InviteMemberForm({
  organizationId,
  roles,
}: {
  organizationId: string;
  roles: Role[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(inviteMemberAction, INITIAL);
  const [copied, setCopied] = useState(false);

  if (roles.length === 0) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setCopied(false);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          Invite by email
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite somebody by email</DialogTitle>
          <DialogDescription>
            They don&rsquo;t need an account yet. This creates a link that grants the role you
            choose — send it yourself, or GOLD will try to email it for you.
          </DialogDescription>
        </DialogHeader>

        {state.link ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              Invitation created. Copy this link if you&rsquo;d like to send it yourself:
            </p>
            <div className="flex gap-2">
              <TextInput readOnly value={state.link} className="flex-1" aria-label="Invitation link" />
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(state.link ?? '');
                  setCopied(true);
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => setOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form action={formAction} className="flex flex-col gap-3">
            <input type="hidden" name="organizationId" value={organizationId} />
            <TextInput
              name="email"
              type="email"
              required
              placeholder="Their email address"
              aria-label="Email address"
            />
            <SelectInput name="roleId" aria-label="Role">
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </SelectInput>
            <ErrorText role="alert">{state.error}</ErrorText>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? 'Inviting…' : 'Send invitation'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
