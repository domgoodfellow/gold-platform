'use client';

import { Button } from '@/components/controls/button';
import { ErrorText, SelectInput, TextInput } from '@/components/controls/inputs';
import { useActionState } from 'react';
import {
  RATE_INITIAL,
  TERM_INITIAL,
  recordCommercialTermAction,
  recordProviderRateAction,
  recordRetailRateAction,
} from './actions';

type Option = { value: string; label: string };

/**
 * A provider rate names who; a retail rate does not (D43's correction — GOLD charges one retail
 * price per meter regardless of which vendor fulfilled it). Two forms rather than one with a
 * conditional field, since the field a caller must fill in is exactly the difference between
 * them.
 */
export function RecordProviderRateForm({
  organizationId,
  meters,
  providers,
}: {
  organizationId: string;
  meters: Option[];
  providers: Option[];
}) {
  const [state, formAction, pending] = useActionState(recordProviderRateAction, RATE_INITIAL);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2 text-sm">
      <input type="hidden" name="organizationId" value={organizationId} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <SelectInput name="providerKey" required aria-label="Provider" className="flex-1">
          <option value="">Provider…</option>
          {providers.map((provider) => (
            <option key={provider.value} value={provider.value}>
              {provider.label}
            </option>
          ))}
        </SelectInput>
        <SelectInput name="meterId" required aria-label="Meter" className="flex-1">
          <option value="">Meter…</option>
          {meters.map((meter) => (
            <option key={meter.value} value={meter.value}>
              {meter.label}
            </option>
          ))}
        </SelectInput>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          name="currency"
          type="text"
          required
          maxLength={3}
          placeholder="USD"
          aria-label="Currency"
          className="w-24"
        />
        <TextInput
          name="unitAmountMicros"
          type="number"
          required
          min={0}
          step={1}
          placeholder="Micro-minor-units per unit"
          aria-label="Amount per unit, in micro-minor-units"
          className="flex-1"
        />
      </div>

      <TextInput
        name="source"
        type="text"
        required
        maxLength={200}
        placeholder="Where this number came from — an invoice, a pricing page, an estimate"
        aria-label="Source"
      />

      <ErrorText>{state.error}</ErrorText>
      {state.recorded ? <p className="text-subtle">Recorded.</p> : null}

      <Button type="submit" disabled={pending} size="small" className="w-fit">
        {pending ? 'Recording…' : 'Record provider rate'}
      </Button>
    </form>
  );
}

export function RecordRetailRateForm({
  organizationId,
  meters,
}: {
  organizationId: string;
  meters: Option[];
}) {
  const [state, formAction, pending] = useActionState(recordRetailRateAction, RATE_INITIAL);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2 text-sm">
      <input type="hidden" name="organizationId" value={organizationId} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <SelectInput name="meterId" required aria-label="Meter" className="flex-1">
          <option value="">Meter…</option>
          {meters.map((meter) => (
            <option key={meter.value} value={meter.value}>
              {meter.label}
            </option>
          ))}
        </SelectInput>
        <TextInput
          name="currency"
          type="text"
          required
          maxLength={3}
          placeholder="USD"
          aria-label="Currency"
          className="w-24"
        />
        <TextInput
          name="unitAmountMicros"
          type="number"
          required
          min={0}
          step={1}
          placeholder="Micro-minor-units per unit"
          aria-label="Amount per unit, in micro-minor-units"
          className="flex-1"
        />
      </div>

      <TextInput
        name="source"
        type="text"
        required
        maxLength={200}
        placeholder="Where this number came from — an invoice, a pricing page, an estimate"
        aria-label="Source"
      />

      <ErrorText>{state.error}</ErrorText>
      {state.recorded ? <p className="text-subtle">Recorded.</p> : null}

      <Button type="submit" disabled={pending} size="small" className="w-fit">
        {pending ? 'Recording…' : 'Record retail rate'}
      </Button>
    </form>
  );
}

export function RecordCommercialTermForm({
  organizationId,
  products,
}: {
  organizationId: string;
  products: Option[];
}) {
  const [state, formAction, pending] = useActionState(recordCommercialTermAction, TERM_INITIAL);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2 text-sm">
      <input type="hidden" name="organizationId" value={organizationId} />

      <SelectInput name="productKey" required aria-label="Product">
        <option value="">What was sold…</option>
        {products.map((product) => (
          <option key={product.value} value={product.value}>
            {product.label}
          </option>
        ))}
      </SelectInput>

      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput name="periodStart" type="date" required aria-label="Period start" className="flex-1" />
        <TextInput name="periodEnd" type="date" required aria-label="Period end" className="flex-1" />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          name="priceMinor"
          type="number"
          required
          min={0}
          step={1}
          placeholder="Price, in minor units"
          aria-label="Price, in minor units"
          className="flex-1"
        />
        <TextInput
          name="currency"
          type="text"
          maxLength={3}
          placeholder="USD (leave blank if free)"
          aria-label="Currency"
          className="w-40"
        />
      </div>

      <ErrorText>{state.error}</ErrorText>
      {state.recorded ? <p className="text-subtle">Recorded.</p> : null}

      <Button type="submit" disabled={pending} size="small" className="w-fit">
        {pending ? 'Recording…' : 'Record term'}
      </Button>
    </form>
  );
}
