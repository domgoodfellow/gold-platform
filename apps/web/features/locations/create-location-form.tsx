'use client';

import { TextArea, TextInput } from '@/components/controls/inputs';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@gold/ui/components/field';
import { useActionState, useEffect, useId } from 'react';
import { toast } from 'sonner';
import { CustomFieldInputs } from '@/features/custom-fields/inputs';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import {
  createLocationAction,
  type LocationActionState,
} from '@/app/organizations/[organizationId]/locations/actions';

const INITIAL: LocationActionState = { error: null, created: false };

/**
 * Fields only — no submit button. The Sheet owns the footer and submits this form by id
 * (`form={formId}` on its own button), the Resource creation standard.
 */
export function CreateLocationForm({
  organizationId,
  definitions,
  onCreated,
  formId,
  onPendingChange,
}: {
  organizationId: string;
  definitions: FieldDefinition[];
  onCreated?: () => void;
  formId: string;
  onPendingChange?: (pending: boolean) => void;
}) {
  const [state, formAction, pending] = useActionState(createLocationAction, INITIAL);
  const labelFieldId = useId();
  const addressFieldId = useId();
  const notesFieldId = useId();

  useEffect(() => {
    if (state.created) {
      toast.success('Location added');
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
          <FieldLabel htmlFor={labelFieldId}>Name / label</FieldLabel>
          <TextInput id={labelFieldId} name="label" type="text" required maxLength={200} placeholder="North depot" />
        </Field>

        <Field>
          <FieldLabel htmlFor={addressFieldId}>Address</FieldLabel>
          <TextInput id={addressFieldId} name="address" type="text" required maxLength={500} />
        </Field>

        <Field>
          <FieldLabel htmlFor={notesFieldId}>
            Access notes <span className="font-normal text-subtle">(optional)</span>
          </FieldLabel>
          <TextArea id={notesFieldId} name="accessNotes" rows={2} maxLength={2000} />
          <FieldDescription>Gate codes, key safe, who to ask for.</FieldDescription>
        </Field>

        <CustomFieldInputs definitions={definitions} />

        <FieldError>{state.error}</FieldError>
      </FieldGroup>
    </form>
  );
}
