'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/controls/button';
import { FormError, FormField } from '@/components/controls/form';
import { TextInput } from '@/components/controls/inputs';
import { createStatusAction, type WorkConfigActionState } from './configuration/actions';

const INITIAL: WorkConfigActionState = { error: null };

/**
 * Adds the first stage of one Work type from the New work page, through the same action and
 * `field.manage` policy as Work type settings. Nothing is named or created until the person types a
 * name and submits; a refused submission keeps what was typed.
 */
export function StartingStageForm({ organizationId, typeId, typeName, onAdded }: { organizationId: string; typeId: string; typeName: string; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [state, formAction, pending] = useActionState(async (previous: WorkConfigActionState, data: FormData) => {
    const result = await createStatusAction(previous, data);
    if (!result.error) onAdded();
    return result;
  }, INITIAL);
  return (
    <form action={formAction} aria-label={`Add a starting stage to ${typeName}`} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="typeId" value={typeId} />
      <FormField id={`starting-stage-${typeId}`} label="Starting stage name" hint="New work of this type starts in this stage. You can add later stages in Work type settings.">
        {(field) => <TextInput {...field} name="name" required maxLength={64} value={name} onChange={(event) => setName(event.target.value)} />}
      </FormField>
      <FormError>{state.error}</FormError>
      <Button type="submit" disabled={pending} className="w-fit">{pending ? 'Adding…' : 'Add stage and continue'}</Button>
    </form>
  );
}
