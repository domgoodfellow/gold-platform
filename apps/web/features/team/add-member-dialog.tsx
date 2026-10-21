'use client';

import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/controls/confirm-submit';
import { Tabs, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import type { Role } from '@/lib/domain/tenancy/roles';
import { AddMemberForm } from './add-member-form';
import { InviteMemberForm } from './invite-member-form';

type Mode = 'invite' | 'existing';

const AddMemberDialogContext = createContext<(() => void) | null>(null);

/**
 * Hosts the one Add member dialog for the whole Team workspace, reachable from both Members and
 * Invitations. Adding somebody is an address and a role, so it is a focused dialog over the list,
 * not a full-height drawer. It holds both existing operations — invite by email and add an
 * existing account remain two explicit writes, chosen with a segmented control, never merged into
 * one ambiguous action and never auto-detected on the client.
 *
 * Invite by email is the default every time the dialog opens, because it works whether or not the
 * person already has a GildOps account. The invite form owns its truthful delivery result (accepted
 * for delivery, or not emailed with the reason and the link to share instead); the dialog stays
 * open to show it, and closing returns focus to the trigger.
 */
export function AddMemberDialogProvider({
  organizationId,
  roles,
  children,
}: {
  organizationId: string;
  roles: Role[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Radix returns focus only to its own trigger; the trigger here is a page-header button, so the
  // control that opened the dialog is remembered and focused again when it closes.
  const opener = useRef<HTMLElement | null>(null);

  return (
    <AddMemberDialogContext.Provider value={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setOpen(true); }}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto" onCloseAutoFocus={(event) => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus(); } }}>
          <DialogHeader>
            <DialogTitle>Add member</DialogTitle>
            <DialogDescription>
              Invite somebody by email, or add somebody who already has a GildOps account.
            </DialogDescription>
          </DialogHeader>
          <AddMemberDialogBody organizationId={organizationId} roles={roles} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </AddMemberDialogContext.Provider>
  );
}

/**
 * Its own component, mounted fresh each time the dialog opens (Radix unmounts closed content), so
 * the mode always starts back at Invite and a finished invite's copyable link is never left stale
 * behind a reopened dialog.
 */
function AddMemberDialogBody({
  organizationId,
  roles,
  onDone,
}: {
  organizationId: string;
  roles: Role[];
  onDone: () => void;
}) {
  const [mode, setMode] = useState<Mode>('invite');

  return (
    <div className="flex min-w-0 flex-col">
      <Tabs value={mode} onValueChange={(next) => setMode(next as Mode)}>
        <TabsList>
          <TabsTrigger value="invite">Invite by email</TabsTrigger>
          <TabsTrigger value="existing">Add existing account</TabsTrigger>
        </TabsList>
      </Tabs>

      {mode === 'invite' ? (
        <InviteMemberForm organizationId={organizationId} roles={roles} />
      ) : (
        <AddMemberForm organizationId={organizationId} roles={roles} onAdded={onDone} />
      )}
    </div>
  );
}

export function AddMemberTrigger({
  children = (
    <>
      <UserPlus aria-hidden className="size-4" /> Add member
    </>
  ),
}: {
  children?: ReactNode;
}) {
  const open = useContext(AddMemberDialogContext);
  return (
    <Button type="button" onClick={() => open?.()}>
      {children}
    </Button>
  );
}
