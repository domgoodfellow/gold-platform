'use client';

import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/controls/button';
import { FormError } from '@/components/controls/form';
import { workTypeLifecycleAction } from '@/app/organizations/[organizationId]/work/configuration/lifecycle-actions';

export function TypeLifecycle({ organizationId, typeId, archived, deletable }: { organizationId: string; typeId: string; archived: boolean; deletable: boolean }) {
  const [state, action, pending] = useActionState(workTypeLifecycleAction, { error: null });
  useEffect(() => { if (state.success) toast.success(state.success); }, [state]);
  return <form action={action} className="flex flex-col items-start gap-3" onSubmit={event => {
    const operation = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value');
    if (operation === 'delete' && !window.confirm('Permanently delete this unused Work type?')) event.preventDefault();
  }}>
    <input type="hidden" name="organizationId" value={organizationId} />
    <input type="hidden" name="typeId" value={typeId} />
    <p className="text-sm text-muted">{archived ? 'Archived. Existing Work is retained. Restore before creating new Work; online booking must be published again.' : 'Archiving removes this type from new Work and online booking. Existing Work and catalog links are retained.'}</p>
    <div className="flex flex-wrap gap-2">
      <Button type="submit" name="operation" value={archived ? 'restore' : 'archive'} tone="secondary" disabled={pending}>{archived ? 'Restore Work type' : 'Archive Work type'}</Button>
      {deletable ? <Button type="submit" name="operation" value="delete" tone="secondary" disabled={pending}>Delete unused type</Button> : null}
    </div>
    <FormError>{state.error}</FormError>
  </form>;
}
