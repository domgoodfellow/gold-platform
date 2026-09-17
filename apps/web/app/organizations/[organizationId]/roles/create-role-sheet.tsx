'use client';

import { useActionState, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { ErrorText } from '@/components/controls/inputs';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@gold/ui/components/sheet';
import { useIsMobile } from '@gold/ui/hooks/use-mobile';
import { createRoleAction, type CreateRoleState } from './actions';
import { RoleEditorFields } from './role-editor-fields';

const INITIAL: CreateRoleState = { error: null, created: false };

/**
 * Replaces the inline Disclosure → `CreateRoleForm` composition — the same interaction family as
 * `EditRoleSheet`, sharing `RoleEditorFields` rather than a second capability checklist. Closes
 * itself on success; stays open to show the `DomainError` otherwise.
 */
export function CreateRoleSheet({ organizationId }: { organizationId: string }) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" size="small">
          <Plus aria-hidden className="size-4" /> New role
        </Button>
      </SheetTrigger>
      <SheetContent side={mobile ? 'bottom' : 'right'} className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>New role</SheetTitle>
          <SheetDescription>Name it and choose what it may do.</SheetDescription>
        </SheetHeader>
        <CreateRoleForm organizationId={organizationId} onCreated={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

/**
 * Its own component so `useActionState` remounts fresh each time the Sheet opens (Radix unmounts
 * closed Sheet content) — a role name typed and abandoned on one open never reappears on the next.
 */
function CreateRoleForm({
  organizationId,
  onCreated,
}: {
  organizationId: string;
  onCreated: () => void;
}) {
  const [state, formAction, pending] = useActionState(createRoleAction, INITIAL);

  useEffect(() => {
    if (state.created) onCreated();
  }, [state.created, onCreated]);

  return (
    <form action={formAction} className="flex flex-col gap-4 px-4 pb-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <RoleEditorFields idPrefix="create-role" />
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Creating…' : 'Create role'}
      </Button>
      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}
