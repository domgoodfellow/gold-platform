'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button, ButtonLink } from '@/components/controls/button';
import { ConfirmSubmit } from '@/components/controls/confirm-submit';
import { ErrorText, Hint } from '@/components/controls/inputs';
import { useUnsavedChanges } from '@/components/controls/use-unsaved-changes';
import { CardSection } from '@/components/surfaces/card';
import { DividedList } from '@/components/surfaces/section';
import {
  createRoleAction,
  deleteRoleAction,
  updateRoleAction,
  type DeleteRoleState,
  type SaveRoleState,
} from '@/app/organizations/[organizationId]/settings/access/actions';
import type { Capability } from '@/lib/domain/tenancy/capabilities';
import type { RoleSuggestion } from '@/lib/domain/tenancy/role-suggestions';
import type { Role } from '@/lib/domain/tenancy/roles';
import { RoleEditorFields } from './role-editor-fields';
import { teamViewHref } from './team-views';

const SAVE_INITIAL: SaveRoleState = { error: null, savedAt: null };
const DELETE_INITIAL: DeleteRoleState = { error: null };

function people(count: number): string {
  return count === 1 ? '1 person' : `${count} people`;
}

function permissions(count: number): string {
  return count === 1 ? '1 permission' : `${count} permissions`;
}

/**
 * A role on its own page: its name, its permissions by area, who holds it, and deleting it.
 * Creating and editing are the same editor. It owns the draft, so before saving it says what the
 * save adds and removes and how many people that reaches, and it asks before unsaved work is left.
 */
export function RoleEditor({
  organizationId,
  role,
  members = [],
  grantable,
  suggestions,
}: {
  organizationId: string;
  /** Roles suggested for this kind of business; a new role only. */
  suggestions?: readonly RoleSuggestion[];
  /** The permissions of the person editing. */
  grantable: readonly Capability[];
  /** Absent for a new role. */
  role?: Role;
  /** Display names of the people who hold this role now. */
  members?: readonly string[];
}) {
  const router = useRouter();
  const rolesHref = teamViewHref(organizationId, 'roles');
  const [state, formAction, pending] = useActionState(role ? updateRoleAction : createRoleAction, SAVE_INITIAL);
  const [deleteState, deleteAction, deleting] = useActionState(deleteRoleAction, DELETE_INITIAL);
  const [name, setName] = useState(role?.name ?? '');
  const [capabilities, setCapabilities] = useState<ReadonlySet<Capability>>(() => new Set(role?.capabilities));

  const mayGive = useMemo(() => new Set(grantable), [grantable]);
  const saved = useMemo(() => new Set<Capability>(role?.capabilities), [role?.capabilities]);
  const added = [...capabilities].filter((capability) => !saved.has(capability)).length;
  const removed = [...saved].filter((capability) => !capabilities.has(capability)).length;
  const dirty = name.trim() !== (role?.name ?? '') || added > 0 || removed > 0;
  useUnsavedChanges(dirty && !pending && !state.created);

  useEffect(() => {
    if (!state.savedAt) return;
    if (state.created) {
      toast.success('Role created');
      router.push(rolesHref);
    } else {
      toast.success('Role saved');
    }
  }, [state.savedAt, state.created, router, rolesHref]);

  const formId = role ? `role-${role.id}` : 'role-new';
  const deleteFormId = `delete-${formId}`;
  const change = [added ? `adds ${permissions(added)}` : null, removed ? `removes ${permissions(removed)}` : null].filter(Boolean).join(' and ');

  return (
    <div className="flex flex-col gap-6">
      <form id={formId} action={formAction} className="flex flex-col gap-6">
        <input type="hidden" name="organizationId" value={organizationId} />
        {role ? <input type="hidden" name="roleId" value={role.id} /> : null}
        <RoleEditorFields
          name={name}
          onNameChange={setName}
          capabilities={capabilities}
          onCapabilitiesChange={setCapabilities}
          grantable={mayGive}
          idPrefix={formId}
          withPresets={!role}
          suggestions={suggestions}
        />
      </form>

      {role ? (
        <CardSection title={`Members with this role (${members.length})`}>
          {members.length === 0 ? (
            <Hint className="mt-2">Nobody has this role.</Hint>
          ) : (
            <DividedList className="mt-2">
              {members.map((member, index) => <li key={`${member}-${index}`} className="py-2 text-sm">{member}</li>)}
            </DividedList>
          )}
        </CardSection>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" form={formId} disabled={pending || (role !== undefined && !dirty)}>
          {pending ? 'Saving…' : role ? 'Save role' : 'Create role'}
        </Button>
        <ButtonLink href={rolesHref} tone="secondary">{dirty ? 'Cancel' : 'Back to roles'}</ButtonLink>
        {role && change && members.length > 0 ? (
          <Hint role="status">Saving {change} for {people(members.length)}, straight away.</Hint>
        ) : null}
        <ErrorText role="alert">{state.error}</ErrorText>
      </div>

      {role ? (
        <CardSection title="Delete role">
          <form id={deleteFormId} action={deleteAction} className="mt-3 flex flex-wrap items-center gap-3">
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="roleId" value={role.id} />
            {members.length > 0 ? (
              <Hint>{people(members.length)} {members.length === 1 ? 'has' : 'have'} this role. Move them to another role in Members before deleting it.</Hint>
            ) : (
              <ConfirmSubmit
                formId={deleteFormId}
                label="Delete role"
                confirmLabel="Delete role"
                description={`Delete the role “${role.name}”? This cannot be undone.`}
                size="default"
                pending={deleting}
              />
            )}
            <ErrorText role="alert">{deleteState.error}</ErrorText>
          </form>
        </CardSection>
      ) : null}
    </div>
  );
}
