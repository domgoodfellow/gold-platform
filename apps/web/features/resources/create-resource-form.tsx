'use client';

import { SelectInput, TextInput } from '@/components/controls/inputs';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@gold/ui/components/field';
import { useActionState, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { CustomFieldInputs } from '@/features/custom-fields/inputs';
import { CapabilityPicker } from '@/features/resources/capability-picker';
import type { AvailableMember } from '@/features/resources/member-options';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { ResourceCapability } from '@/lib/domain/resources/resource-capabilities';
import {
  RESOURCE_CLASSES,
  RESOURCE_CLASS_LABELS,
  type ResourceClass,
} from '@/lib/domain/resources/resource-class';
import {
  createResourceAction,
  type CreateResourceState,
} from '@/app/organizations/[organizationId]/resources/actions';

const INITIAL: CreateResourceState = { error: null, created: false };

/**
 * Fields only — no submit button. The Sheet owns the footer and submits this form by id
 * (`form={formId}` on its own button), so the same form can be hosted without a second,
 * differently-styled action floating inside the scrollable body.
 *
 * What kind of resource this is has no preselected answer: the platform does not decide it for a
 * business. Only a person can represent a member, so the member control appears for that class
 * alone.
 */
export function CreateResourceForm({
  organizationId,
  definitions,
  availableMembers,
  capabilities,
  mayAddCapability,
  onCreated,
  formId,
  onPendingChange,
}: {
  organizationId: string;
  definitions: FieldDefinition[];
  /** Members not already representing another Resource. Empty is ordinary, not an error. */
  availableMembers: AvailableMember[];
  /** The vocabulary a new resource may be given. Archived ones are not offered. */
  capabilities: ResourceCapability[];
  /** Whether the caller may also add a word to the vocabulary from here (`field.manage`). */
  mayAddCapability: boolean;
  onCreated?: () => void;
  formId: string;
  onPendingChange?: (pending: boolean) => void;
}) {
  const [state, formAction, pending] = useActionState(createResourceAction, INITIAL);
  const [resourceClass, setResourceClass] = useState<ResourceClass | ''>('');
  const nameFieldId = useId();
  const classFieldId = useId();
  const memberFieldId = useId();
  const errorId = useId();

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
          <FieldLabel htmlFor={classFieldId}>Type</FieldLabel>
          <SelectInput
            id={classFieldId}
            name="resourceClass"
            required
            value={resourceClass}
            onChange={(event) => setResourceClass(event.target.value as ResourceClass | '')}
          >
            <option value="" disabled>
              Choose a type
            </option>
            {RESOURCE_CLASSES.map((value) => (
              <option key={value} value={value}>
                {RESOURCE_CLASS_LABELS[value]}
              </option>
            ))}
          </SelectInput>
        </Field>

        {resourceClass === 'person' ? (
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
            <FieldDescription>A contractor or technician with no login is still a person.</FieldDescription>
          </Field>
        ) : null}

        <CapabilityPicker capabilities={capabilities} mayAdd={mayAddCapability} />

        <CustomFieldInputs definitions={definitions} />

        <FieldError id={errorId} role="alert">
          {state.error}
        </FieldError>
      </FieldGroup>
    </form>
  );
}
