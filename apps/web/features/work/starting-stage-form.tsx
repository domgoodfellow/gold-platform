'use client';

import { useActionState, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/controls/button';
import { FormError } from '@/components/controls/form';
import { TextInput } from '@/components/controls/inputs';
import { addStarterStagesAction, createStatusAction, type WorkConfigActionState } from './configuration/actions';

const INITIAL: WorkConfigActionState = { error: null };

/**
 * A type with no stages, made ready in one step: the three stages a new type starts with (Booked,
 * In progress, Done, with their moves), or one starting stage the person names. Used wherever a
 * stage-less type stops someone — Work items, New work and the type's Workflow — through the same
 * actions and `field.manage` policy as Work type settings. A refused submission keeps what was typed.
 */
export function StartingStageForm({ organizationId, typeId, typeName, onAdded }: { organizationId: string; typeId: string; typeName: string; onAdded?: () => void }) {
  const router = useRouter();
  const nameId = useId();
  const [name, setName] = useState('');
  // Confirmed inside the submission, not in an effect: a successful save redraws the page without
  // this form, so an effect here would never run.
  const confirm = (action: typeof createStatusAction, message: (data: FormData) => string) => async (previous: WorkConfigActionState, data: FormData) => {
    const result = await action(previous, data);
    if (!result.error) {
      toast.success(message(data));
      if (onAdded) onAdded();
      else router.refresh();
    }
    return result;
  };
  const [standard, addStandard, addingStandard] = useActionState(confirm(addStarterStagesAction, () => `${typeName} now has Booked, In progress and Done.`), INITIAL);
  const [own, addOwn, addingOwn] = useActionState(confirm(createStatusAction, (data) => `${typeName} starts in ${String(data.get('name') ?? '').trim()}.`), INITIAL);
  const pending = addingStandard || addingOwn;

  return (
    <div className="flex flex-col gap-4">
      <form action={addStandard} aria-label={`Add standard stages to ${typeName}`}>
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="typeId" value={typeId} />
        <Button type="submit" size="small" disabled={pending}>{addingStandard ? 'Adding…' : 'Add Booked, In progress and Done'}</Button>
        <FormError>{standard.error}</FormError>
      </form>
      <form action={addOwn} aria-label={`Add a starting stage to ${typeName}`} className="flex flex-col gap-1.5">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="typeId" value={typeId} />
        <label htmlFor={nameId} className="text-sm font-medium">Or name the starting stage</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <TextInput id={nameId} name="name" required maxLength={64} value={name} onChange={(event) => setName(event.target.value)} className="sm:max-w-xs" />
          <Button type="submit" size="small" tone="secondary" disabled={pending} className="w-fit">{addingOwn ? 'Adding…' : 'Add stage'}</Button>
        </div>
        <FormError>{own.error}</FormError>
      </form>
    </div>
  );
}
