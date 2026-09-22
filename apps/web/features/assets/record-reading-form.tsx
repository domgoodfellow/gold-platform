'use client';

import { TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { useActionState } from 'react';

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
