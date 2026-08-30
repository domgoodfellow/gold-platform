'use client';

import { useActionState } from 'react';
import { CustomFieldInputs } from '@/components/custom-field-inputs';
import { OptionalSelect, type SelectOption } from '@/components/optional-select';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { createAssetAction, type CreateAssetState } from './actions';

const INITIAL: CreateAssetState = { error: null };

export function CreateAssetForm({
  organizationId,
  customers,
  locations,
  definitions,
}: {
  organizationId: string;
  customers: SelectOption[];
  locations: SelectOption[];
  definitions: FieldDefinition[];
}) {
  const [state, formAction, pending] = useActionState(createAssetAction, INITIAL);

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <h2 className="text-sm font-medium">New asset</h2>

      <input
        name="name"
        type="text"
        required
        maxLength={200}
        placeholder="Name, e.g. Compressor A, or Unit 4 boiler"
        aria-label="Name"
        className="rounded border border-black/15 px-3 py-2 dark:border-white/20"
      />

      {/* Both optional: customer-owned equipment names its owner, the tenant's own plant
          names nobody, and a portable machine sits nowhere in particular. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <OptionalSelect name="customerId" label="Owned by" options={customers} />
        <OptionalSelect name="locationId" label="Located at" options={locations} />
      </div>

      <CustomFieldInputs definitions={definitions} />

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
      >
        {pending ? 'Adding…' : 'Add asset'}
      </button>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
