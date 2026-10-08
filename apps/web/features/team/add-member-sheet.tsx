'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/controls/button';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerDescription,
  PageDrawerHeader,
  PageDrawerTitle,
} from '@/components/panels/page-drawer';
import { Tabs, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import type { Role } from '@/lib/domain/tenancy/roles';
import { AddMemberForm } from './add-member-form';
import { InviteMemberForm } from './invite-member-form';

type Mode = 'invite' | 'existing';

const AddMemberSheetContext = createContext<(() => void) | null>(null);

/**
 * Hosts the one Add Member PageDrawer for the whole Team workspace, reachable from both Members and
 * Invitations. It replaces two inline Disclosure forms ("Add somebody", "Invite by email") with
 * one bounded creation surface holding both existing operations — invite by email and add an
 * existing account remain two explicit writes, chosen with a segmented control inside the PageDrawer,
 * never merged into one ambiguous action and never auto-detected on the client.
 *
 * Invite by email is the default every time the PageDrawer opens, because it works whether or not the
 * person already has a GOLD account — the same default whichever trigger opened it.
 */
export function AddMemberSheetProvider({
  organizationId,
  roles,
  children,
}: {
  organizationId: string;
  roles: Role[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <AddMemberSheetContext.Provider value={() => setOpen(true)}>
      {children}
      <PageDrawer open={open} onOpenChange={setOpen}>
        <PageDrawerContent>
          <PageDrawerHeader>
            <PageDrawerTitle>Add member</PageDrawerTitle>
            <PageDrawerDescription>
              Invite somebody by email, or add somebody who already has a GildOps account.
            </PageDrawerDescription>
          </PageDrawerHeader>
          <div className="flex flex-col gap-4">
            <AddMemberSheetBody organizationId={organizationId} roles={roles} onDone={() => setOpen(false)} />
          </div>
        </PageDrawerContent>
      </PageDrawer>
    </AddMemberSheetContext.Provider>
  );
}

/**
 * Its own component, mounted fresh each time the PageDrawer opens (Radix unmounts closed PageDrawer
 * content), so the mode always starts back at Invite and a finished invite's copyable link is
 * never left stale behind a reopened PageDrawer.
 */
function AddMemberSheetBody({
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
    <>
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
    </>
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
  const open = useContext(AddMemberSheetContext);
  return (
    <Button type="button" onClick={() => open?.()}>
      {children}
    </Button>
  );
}
