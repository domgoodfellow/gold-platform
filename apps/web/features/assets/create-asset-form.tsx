'use client';

import { TextInput } from '@/components/controls/inputs';
import { Field, FieldError, FieldGroup, FieldLabel } from '@gold/ui/components/field';
import { useActionState, useEffect, useId } from 'react';
import { toast } from 'sonner';
import { CustomFieldInputs } from '@/features/custom-fields/inputs';
import { OptionalSelect, type SelectOption } from '@/components/controls/optional-select';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import {
  createAssetAction,
  type CreateAssetState,
} from '@/app/organizations/[organizationId]/assets/actions';

const INITIAL: CreateAssetState = { error: null, created: false };

/**
 * Fields only — no submit button. The Sheet owns the footer and submits this form by id
 * (`form={formId}` on its own button), the Resource creation standard.
 */
export function CreateAssetForm({
  organizationId,
  customers,
  locations,
  definitions,
  onCreated,
  formId,
  onPendingChange,
}: {
  organizationId: string;
  customers: SelectOption[];
  locations: SelectOption[];
  definitions: FieldDefinition[];
  onCreated?: () => void;
  formId: string;
  onPendingChange?: (pending: boolean) => void;
}) {
  const [state, formAction, pending] = useActionState(createAssetAction, INITIAL);
  const nameFieldId = useId();
  const customerFieldId = useId();
  const locationFieldId = useId();

  useEffect(() => {
    if (state.created) {
      toast.success('Asset added');
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
          <TextInput id={nameFieldId} name="name" type="text" required maxLength={200} placeholder="Compressor A, or Unit 4 boiler" />
        </Field>

        {/* Both optional: customer-owned equipment names its owner, the tenant's own plant
            names nobody, and a portable machine sits nowhere in particular. */}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Field className="flex-1">
            <FieldLabel htmlFor={customerFieldId}>Owned by</FieldLabel>
            <OptionalSelect id={customerFieldId} name="customerId" label="Owned by" options={customers} />
          </Field>
          <Field className="flex-1">
            <FieldLabel htmlFor={locationFieldId}>Located at</FieldLabel>
            <OptionalSelect id={locationFieldId} name="locationId" label="Located at" options={locations} />
          </Field>
        </div>

        <CustomFieldInputs definitions={definitions} />

        <FieldError>{state.error}</FieldError>
      </FieldGroup>
    </form>
  );
}
