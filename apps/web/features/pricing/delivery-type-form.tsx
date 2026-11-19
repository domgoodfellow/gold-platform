'use client';

import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button, ButtonLink } from '@/components/controls/button';
import { SelectField } from '@/components/controls/select-field';
import { FormError } from '@/components/controls/form';
import { setDeliveryTypeAction } from '@/app/organizations/[organizationId]/finance/configuration/pricing/actions';
import type { WorkItemType } from '@/lib/domain/work-items/types';
import type { PriceBookItem } from '@/lib/domain/pricing/price-book';
import { useUnsavedChanges } from '@/components/controls/use-unsaved-changes';

export function DeliveryTypeForm({ organizationId, item, types, mayManage, mayCreate }: { organizationId: string; item: PriceBookItem; types: WorkItemType[]; mayManage: boolean; mayCreate: boolean }) {
  const [state, action, pending] = useActionState(setDeliveryTypeAction, { error: null });
  const [selected, setSelected] = useState(item.deliveryTypeId ?? '');
  const dirty = selected !== (item.deliveryTypeId ?? '');
  useUnsavedChanges(dirty);
  useEffect(() => { if (state.success) toast.success(state.success); }, [state]);
  const linked = types.find(type => type.id === item.deliveryTypeId);
  return <div className="col-span-full flex flex-col gap-2 pl-9.5 text-sm">
    {mayManage ? <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="organizationId" value={organizationId} /><input type="hidden" name="itemId" value={item.id} />
      <label className="flex min-w-0 flex-1 flex-col gap-1"><span className="text-xs text-muted">Delivery Work type (optional)</span><SelectField name="typeId" aria-label={`Delivery Work type for ${item.name}`} value={selected} onValueChange={setSelected} options={[{ value: '', label: 'No job delivery' }, ...types.filter(type => !type.archivedAt || type.id === item.deliveryTypeId).map(type => ({ value: type.id, label: `${type.name}${type.archivedAt ? ' (archived)' : ''}`, disabled: Boolean(type.archivedAt) }))]} /></label>
      <Button size="tiny" tone="secondary" type="submit" disabled={pending || !dirty}>Save delivery type</Button>
      {dirty ? <Button size="tiny" tone="secondary" type="button" disabled={pending} onClick={() => setSelected(item.deliveryTypeId ?? '')}>Cancel</Button> : null}
      <FormError>{state.error}</FormError>
    </form> : linked ? <p>Delivery: {linked.name}{linked.archivedAt ? ' (archived)' : ''}</p> : null}
    {linked && !linked.archivedAt && mayCreate ? <ButtonLink size="tiny" tone="secondary" href={`/organizations/${organizationId}/work/new?${new URLSearchParams({ type: linked.id, service: item.id })}`}>Create Work from {item.name}</ButtonLink> : null}
  </div>;
}
