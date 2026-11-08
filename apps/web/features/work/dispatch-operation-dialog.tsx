'use client';

import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Button } from '@/components/controls/button';
import { GuardedDialog } from '@/components/panels/guarded-dialog';
import { DialogBody, StepHeader } from '@/components/panels/dialog-layout';
import { AssignResourcesForm, ScheduleWorkItemForm } from './work-operations-forms';

/** Focused Dispatch tasks use the same forms and authoritative commands as the Work record. */
export function DispatchOperationDialog({ operation, ...props }: ComponentProps<typeof ScheduleWorkItemForm> & { operation: 'assign' | 'schedule' }) {
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const title = operation === 'assign' ? 'Assign resources' : props.scheduled ? 'Reschedule' : 'Schedule';
  return <>
    <Button type="button" tone="secondary" size="small" onClick={() => { setRevision(value => value + 1); setOpen(true); }}>{title}</Button>
    <GuardedDialog open={open} onOpenChange={setOpen}>
      <StepHeader title={title} description={operation === 'assign' ? 'Change participants while keeping the scheduled time.' : `Times in ${props.timezone}. Saving checks availability again.`}/>
      <DialogBody>
        {operation === 'assign'
          ? <AssignResourcesForm key={revision} {...props} onSaved={() => setOpen(false)}/>
          : <ScheduleWorkItemForm key={revision} {...props} onSaved={() => setOpen(false)}/>}
      </DialogBody>
    </GuardedDialog>
  </>;
}

/** A resolved exception may leave the active filter; focus its explanation when the opener disappears. */
export function DispatchSelectionNotice() {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return <p ref={ref} tabIndex={-1} role="status" className="text-sm text-muted outline-none">The selected work is unavailable or no longer matches these filters. Select another item from the queue.</p>;
}
