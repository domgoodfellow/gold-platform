'use client';

import { useActionState } from 'react';
import { CustomFieldInputs } from '@/components/custom-field-inputs';
import { OptionalSelect, type SelectOption } from '@/components/optional-select';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { recordReadingAction, createAssetAction, type CreateAssetState } from './actions';

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

/**
 * What the counter says today.
 *
 * **One number and one unit, and the unit is this business's word.** Hours, miles, cycles,
 * litres — the platform keeps no list, because a counter is a counter whatever it counts. What
 * it does insist on is that the unit is written down every time, because a rule counting hours
 * takes no notice of a reading in kilometres and nothing anywhere converts between them.
 *
 * The last unit used is offered back as the starting value, which is a convenience and not a
 * decision: a business that changes what it counts in types the new one.
 */
export function RecordReadingForm({
  organizationId,
  assetId,
  assetName,
  lastUnit,
}: {
  organizationId: string;
  assetId: string;
  assetName: string;
  lastUnit: string;
}) {
  const [state, formAction, pending] = useActionState(recordReadingAction, { error: null });

  return (
    <form action={formAction} className="mt-1 flex flex-wrap items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="assetId" value={assetId} />

      <input
        name="value"
        type="number"
        step="any"
        min={0}
        required
        aria-label={`Counter reading for ${assetName}`}
        placeholder="reading"
        className="w-28 rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20"
      />
      <input
        name="unit"
        type="text"
        required
        maxLength={16}
        defaultValue={lastUnit}
        aria-label={`Unit for ${assetName}`}
        placeholder="hours"
        className="w-24 rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-black/15 px-3 py-1 text-sm disabled:opacity-50 dark:border-white/20"
      >
        {pending ? '…' : 'Record'}
      </button>

      {state.error ? (
        <span role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
