'use client';

import { SectionHeading } from '@/components/containers/section';
import { ErrorText, TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { CustomFieldInputs } from '@/features/custom-fields/inputs';
import { OptionalSelect, type SelectOption } from '@/components/controls/optional-select';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { createAssetAction, type CreateAssetState } from './actions';

const INITIAL: CreateAssetState = { error: null, created: false };

export function CreateAssetForm({
  organizationId,
  customers,
  locations,
  definitions,
  onCreated,
}: {
  organizationId: string;
  customers: SelectOption[];
  locations: SelectOption[];
  definitions: FieldDefinition[];
  onCreated?: () => void;
}) {
  const [state, formAction, pending] = useActionState(createAssetAction, INITIAL);

  useEffect(() => {
    if (state.created) {
      toast.success('Asset added');
      onCreated?.();
    }
  }, [state.created, onCreated]);

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <SectionHeading>New asset</SectionHeading>

      <TextInput
        name="name"
        type="text"
        required
        maxLength={200}
        placeholder="Name, e.g. Compressor A, or Unit 4 boiler"
        aria-label="Name"
      />

      {/* Both optional: customer-owned equipment names its owner, the tenant's own plant
          names nobody, and a portable machine sits nowhere in particular. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <OptionalSelect name="customerId" label="Owned by" options={customers} />
        <OptionalSelect name="locationId" label="Located at" options={locations} />
      </div>

      <CustomFieldInputs definitions={definitions} />

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Adding…' : 'Add asset'}
      </Button>

      <ErrorText role="alert">{state.error}</ErrorText>
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
 *
 * `action` travels as a prop rather than a fixed import: the assets list revalidates the list
 * path when a reading lands, and the asset's own record page revalidates itself — two callers
 * with two different write actions around the same domain call.
 */
export function RecordReadingForm({
  organizationId,
  assetId,
  assetName,
  lastUnit,
  action,
}: {
  organizationId: string;
  assetId: string;
  assetName: string;
  lastUnit: string;
  action: (
    previous: { error: string | null },
    formData: FormData,
  ) => Promise<{ error: string | null }>;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });

  return (
    <form action={formAction} className="mt-1 flex flex-wrap items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="assetId" value={assetId} />

      <TextInput
        name="value"
        type="number"
        step="any"
        min={0}
        required
        aria-label={`Counter reading for ${assetName}`}
        placeholder="reading"
        size="small"
        className="w-28"
      />
      <TextInput
        name="unit"
        type="text"
        required
        maxLength={16}
        defaultValue={lastUnit}
        aria-label={`Unit for ${assetName}`}
        placeholder="hours"
        size="small"
        className="w-24"
      />
      <Button type="submit" disabled={pending} tone="secondary" size="small">
        {pending ? '…' : 'Record'}
      </Button>

      {state.error ? (
        <span role="alert" className="text-sm text-danger">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
