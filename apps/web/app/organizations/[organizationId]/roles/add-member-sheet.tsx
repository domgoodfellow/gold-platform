'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/controls/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@gold/ui/components/sheet';
import { Tabs, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import { useIsMobile } from '@gold/ui/hooks/use-mobile';
import type { Role } from '@/lib/domain/tenancy/roles';
import { AddMemberForm } from './add-member-form';
import { InviteMemberForm } from './invite-member-form';

type Mode = 'invite' | 'existing';

const AddMemberSheetContext = createContext<(() => void) | null>(null);

/**
 * Hosts the one Add Member Sheet for the whole Team workspace, reachable from both Members and
 * Invitations. It replaces two inline Disclosure forms ("Add somebody", "Invite by email") with
 * one bounded creation surface holding both existing operations — invite by email and add an
 * existing account remain two explicit writes, chosen with a segmented control inside the Sheet,
 * never merged into one ambiguous action and never auto-detected on the client.
 *
 * Invite by email is the default every time the Sheet opens, because it works whether or not the
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
  const mobile = useIsMobile();

  return (
    <AddMemberSheetContext.Provider value={() => setOpen(true)}>
      {children}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side={mobile ? 'bottom' : 'right'} className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Add member</SheetTitle>
            <SheetDescription>
              Invite somebody by email, or add somebody who already has a GOLD account.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-4">
            <AddMemberSheetBody organizationId={organizationId} roles={roles} onDone={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </AddMemberSheetContext.Provider>
  );
}

/**
 * Its own component, mounted fresh each time the Sheet opens (Radix unmounts closed Sheet
 * content), so the mode always starts back at Invite and a finished invite's copyable link is
 * never left stale behind a reopened Sheet.
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
    <Button type="button" size="small" onClick={() => open?.()}>
      {children}
    </Button>
  );
}
