'use client';

import { useActionState, useState } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { ErrorText } from '@/components/controls/inputs';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerDescription,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import type { Role } from '@/lib/domain/tenancy/roles';
import { updateRoleAction, type UpdateRoleState } from '@/app/organizations/[organizationId]/settings/access/actions';
import { RoleEditorFields } from './role-editor-fields';

const INITIAL: UpdateRoleState = { error: null };

/**
 * Editing an existing role's name and capabilities — the counterpart to `CreateRoleForm`,
 * sharing the same `CapabilitySelector` rather than a second checkbox list. Takes effect
 * immediately for every membership already assigned this role; nobody is reassigned.
 */
export function EditRoleSheet({ organizationId, role }: { organizationId: string; role: Role }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(updateRoleAction, INITIAL);

  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild>
        <Button type="button" tone="secondary" size="small" aria-label={`Edit ${role.name}`}>
          <Pencil aria-hidden className="size-4" /> Edit
        </Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>Edit {role.name}</PageDrawerTitle>
          <PageDrawerDescription>
            Changes take effect immediately for everyone already assigned this role.
          </PageDrawerDescription>
        </PageDrawerHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="roleId" value={role.id} />

          <RoleEditorFields
            defaultName={role.name}
            selected={new Set(role.capabilities)}
            idPrefix={`edit-role-${role.id}`}
          />

          <Button type="submit" disabled={pending} className="w-fit">
            {pending ? 'Saving…' : 'Save role'}
          </Button>

          <ErrorText role="alert">{state.error}</ErrorText>
        </form>
      </PageDrawerContent>
    </PageDrawer>
  );
}
