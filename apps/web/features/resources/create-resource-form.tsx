'use client';

import { SelectInput, TextInput } from '@/components/controls/inputs';
import { Field, FieldError, FieldGroup, FieldLabel } from '@gold/ui/components/field';
import { useActionState, useEffect, useId } from 'react';
import { toast } from 'sonner';
import { CustomFieldInputs } from '@/features/custom-fields/inputs';
import type { AvailableMember } from '@/features/resources/member-options';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import {
  createResourceAction,
  type CreateResourceState,
} from '@/app/organizations/[organizationId]/resources/actions';

const INITIAL: CreateResourceState = { error: null, created: false };

/**
 * Fields only — no submit button. The Sheet owns the footer and submits this form by id
 * (`form={formId}` on its own button), so the same form can be hosted without a second,
 * differently-styled action floating inside the scrollable body.
 */
export function CreateResourceForm({
  organizationId,
  definitions,
  availableMembers,
  onCreated,
  formId,
  onPendingChange,
}: {
  organizationId: string;
  definitions: FieldDefinition[];
  /** Members not already representing another Resource. Empty is ordinary, not an error. */
  availableMembers: AvailableMember[];
  onCreated?: () => void;
  formId: string;
  onPendingChange?: (pending: boolean) => void;
}) {
  const [state, formAction, pending] = useActionState(createResourceAction, INITIAL);
  const nameFieldId = useId();
  const memberFieldId = useId();

  useEffect(() => {
    if (state.created) {
      toast.success('Resource added');
      onCreated?.();
    }
  }, [state.created, onCreated]);

  useEffect(() => {
    onPendingChange?.(pending);
  }, [pending, onPendingChange]);

  return (
    <form id={formId} action={formAction}>
      <FieldGroup>
        <input type="hidden" name="organizationId" value={organizationId} />

        <Field>
          <FieldLabel htmlFor={nameFieldId}>Name</FieldLabel>
          <TextInput
            id={nameFieldId}
            name="name"
            type="text"
            required
            maxLength={200}
            placeholder="Sam Okafor, or Van 3"
          />
        </Field>

        <Field>
          <FieldLabel htmlFor={memberFieldId}>Represents member</FieldLabel>
          <SelectInput id={memberFieldId} name="membershipId" defaultValue="">
            <option value="">None — not a member</option>
            {availableMembers.map((member) => (
              <option key={member.membershipId} value={member.membershipId}>
                {member.displayName}
              </option>
            ))}
          </SelectInput>
        </Field>

        <CustomFieldInputs definitions={definitions} />

        <FieldError>{state.error}</FieldError>
      </FieldGroup>
    </form>
  );
}
