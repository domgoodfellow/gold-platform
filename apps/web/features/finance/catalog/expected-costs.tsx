'use client';

import { useActionState, useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/controls/button';
import { ConfirmSubmit } from '@/components/controls/confirm-submit';
import { FormError } from '@/components/controls/form';
import { TextInput } from '@/components/controls/inputs';
import { SelectField } from '@/components/controls/select-field';
import {
  addItemExpectedCostAction,
  removeItemExpectedCostAction,
  setStageExpectedCostAction,
  type ExpectedCostState,
} from '@/app/organizations/[organizationId]/finance/catalog/expected-cost-actions';
import { setDeliveryTypeAction } from '@/app/organizations/[organizationId]/finance/configuration/pricing/actions';
import type { ExpectedCostLine } from '@/lib/domain/pricing/expected-costs';
import { formatMoney } from '@/lib/domain/work-items/consumption';

const INITIAL: ExpectedCostState = { error: null };

/**
 * The action, confirmed with a toast when it succeeds. Inside the submission rather than an effect:
 * a save redraws these forms, and an effect in a form that was replaced never runs.
 */
function confirmed<S extends { error: string | null; success?: string }>(action: (previous: S, data: FormData) => Promise<S>, after?: () => void) {
  return async (previous: S, data: FormData): Promise<S> => {
    const result = await action(previous, data);
    if (!result.error && result.success) {
      toast.success(result.success);
      after?.();
    }
    return result;
  };
}

/** Amount of a minor-unit figure as the business types it back: 12.5 → "12.50" for two decimals. */
function majorText(amountMinor: number, currency: string): string {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return (amountMinor / 10 ** digits).toFixed(digits);
}

/** The expected cost lines of one priced item, each removable, with one form to add another. */
export function ExpectedCostLines({ organizationId, itemId, itemName, currency, lines, mayManage }: {
  organizationId: string; itemId: string; itemName: string; currency: string; lines: ExpectedCostLine[]; mayManage: boolean;
}) {
  const descriptionId = useId();
  const amountId = useId();
  const [formKey, setFormKey] = useState(0);
  const [state, add, adding] = useActionState(confirmed(addItemExpectedCostAction, () => setFormKey((key) => key + 1)), INITIAL);

  return (
    <div className="flex flex-col gap-3">
      {lines.length ? (
        <ul aria-label={`Expected costs of ${itemName}`} className="flex flex-col divide-y divide-border">
          {lines.map((line) => (
            <li key={line.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span className="min-w-0 flex-1 break-words">{line.description}</span>
              <span className="tabular-nums">{formatMoney(line.amountMinor, line.currency)}</span>
              {mayManage ? <RemoveLine organizationId={organizationId} line={line} /> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No expected costs on this item.</p>
      )}
      {mayManage ? (
        <form key={formKey} action={add} aria-label={`Add an expected cost to ${itemName}`} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="itemId" value={itemId} />
          <label htmlFor={descriptionId} className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            Cost
            <TextInput id={descriptionId} name="description" required maxLength={120} placeholder="e.g. Tyre, disposal fee" />
          </label>
          <label htmlFor={amountId} className="flex flex-col gap-1 text-sm sm:w-36">
            Per unit, {currency}
            <TextInput id={amountId} name="amount" required inputMode="decimal" />
          </label>
          <Button type="submit" size="small" tone="secondary" disabled={adding} className="w-fit">{adding ? 'Adding…' : 'Add cost'}</Button>
        </form>
      ) : null}
      <FormError>{state.error}</FormError>
    </div>
  );
}

function RemoveLine({ organizationId, line }: { organizationId: string; line: ExpectedCostLine }) {
  const formId = `remove-expected-cost-${line.id}`;
  const [state, remove, pending] = useActionState(confirmed(removeItemExpectedCostAction), INITIAL);
  return (
    <>
      <form id={formId} action={remove}>
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="id" value={line.id} />
      </form>
      <ConfirmSubmit formId={formId} label="Remove" tone="ghost" size="tiny" confirmLabel="Remove cost" description={`${line.description} is no longer counted in this item's expected cost.`} pending={pending} ariaLabel={`Remove ${line.description}`} />
      {state.error ? <span role="alert" className="w-full text-sm text-danger">{state.error}</span> : null}
    </>
  );
}

/** One stage's expected time and cost per hour, and what that comes to. Empty fields clear both. */
export function StageCostForm({ organizationId, stage, currency, mayManage }: {
  organizationId: string;
  stage: { id: string; name: string; cost: { expectedMinutes: number; hourlyCostMinor: number; currency: string } | null };
  currency: string | null;
  mayManage: boolean;
}) {
  const [state, save, saving] = useActionState(confirmed(setStageExpectedCostAction), INITIAL);
  const [minutes, setMinutes] = useState(stage.cost ? String(stage.cost.expectedMinutes) : '');
  const [rate, setRate] = useState(stage.cost ? majorText(stage.cost.hourlyCostMinor, stage.cost.currency) : '');
  const shownCurrency = stage.cost?.currency ?? currency;
  const stageCost = stage.cost ? Math.round((stage.cost.expectedMinutes * stage.cost.hourlyCostMinor) / 60) : null;
  const dirty = minutes !== (stage.cost ? String(stage.cost.expectedMinutes) : '') || rate !== (stage.cost ? majorText(stage.cost.hourlyCostMinor, stage.cost.currency) : '');

  if (!mayManage) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-2 text-sm">
        <span className="font-medium">{stage.name}</span>
        <span className="tabular-nums">{stage.cost ? `${stage.cost.expectedMinutes} min · ${formatMoney(stage.cost.hourlyCostMinor, stage.cost.currency)}/h` : 'Not set'}</span>
      </div>
    );
  }
  return (
    <form action={save} aria-label={`Expected time and cost of ${stage.name}`} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-end sm:gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="statusId" value={stage.id} />
      <span className="min-w-0 flex-1 break-words text-sm font-medium sm:pb-2">{stage.name}</span>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Minutes
        <TextInput name="minutes" inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value)} aria-label={`Expected minutes in ${stage.name}`} size="small" className="w-24" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Cost per hour{shownCurrency ? `, ${shownCurrency}` : ''}
        <TextInput name="hourlyCost" inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} aria-label={`Cost per hour in ${stage.name}`} size="small" className="w-28" />
      </label>
      <span className="text-sm tabular-nums sm:w-24 sm:pb-2 sm:text-right">{stageCost !== null && stage.cost ? formatMoney(stageCost, stage.cost.currency) : '—'}</span>
      <Button type="submit" size="tiny" tone="secondary" disabled={saving || !dirty} className="w-fit sm:mb-1">{saving ? 'Saving…' : 'Save'}</Button>
      {state.error ? <span role="alert" className="text-sm text-danger sm:w-full">{state.error}</span> : null}
    </form>
  );
}

/** Makes an item in the price book one this Work type delivers — the same write as Catalog & Pricing's delivery type. */
export function LinkItemToTypeForm({ organizationId, typeId, typeName, items }: { organizationId: string; typeId: string; typeName: string; items: { id: string; name: string }[] }) {
  const [itemId, setItemId] = useState('');
  const [state, link, linking] = useActionState(confirmed(setDeliveryTypeAction, () => setItemId('')), { error: null });
  return (
    <form action={link} aria-label={`Link a priced item to ${typeName}`} className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="typeId" value={typeId} />
      <input type="hidden" name="itemId" value={itemId} />
      <SelectField aria-label="Priced item to link" value={itemId} onValueChange={setItemId} className="sm:w-64" options={[{ value: '', label: 'Choose a priced item' }, ...items.map((item) => ({ value: item.id, label: item.name }))]} />
      <Button type="submit" size="small" tone="secondary" disabled={linking || !itemId} className="w-fit">{linking ? 'Linking…' : 'Link item'}</Button>
      <FormError>{state.error}</FormError>
    </form>
  );
}
