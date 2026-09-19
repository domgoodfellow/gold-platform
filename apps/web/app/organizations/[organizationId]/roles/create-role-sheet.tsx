'use client';

import { useActionState, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { ErrorText } from '@/components/controls/inputs';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerDescription,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/containers/page-drawer';
import { createRoleAction, type CreateRoleState } from './actions';
import { RoleEditorFields } from './role-editor-fields';

const INITIAL: CreateRoleState = { error: null, created: false };

/**
 * Replaces the inline Disclosure → `CreateRoleForm` composition — the same interaction family as
 * `EditRoleSheet`, sharing `RoleEditorFields` rather than a second capability checklist. Closes
 * itself on success; stays open to show the `DomainError` otherwise.
 */
export function CreateRoleSheet({ organizationId }: { organizationId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild>
        <Button type="button" size="small">
          <Plus aria-hidden className="size-4" /> New role
        </Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>New role</PageDrawerTitle>
          <PageDrawerDescription>Name it and choose what it may do.</PageDrawerDescription>
        </PageDrawerHeader>
        <CreateRoleForm organizationId={organizationId} onCreated={() => setOpen(false)} />
      </PageDrawerContent>
    </PageDrawer>
  );
}

/**
 * Its own component so `useActionState` remounts fresh each time the PageDrawer opens (Radix unmounts
 * closed PageDrawer content) — a role name typed and abandoned on one open never reappears on the next.
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
