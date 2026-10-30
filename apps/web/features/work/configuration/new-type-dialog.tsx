'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { DialogBody, DialogFooterBar, StepHeader } from '@/components/panels/dialog-layout';
import { GuardedDialog, useGuardedDialogClose } from '@/components/panels/guarded-dialog';
import { CreateTypeForm } from './work-config-forms';

/**
 * Creating a kind of work is its own focused task, apart from configuring one and apart from
 * creating work: it makes the type and nothing else — no stage, no work, no price. On success the
 * person lands on the new type's Workflow tab, because a type with no stage cannot hold work yet.
 */
export function NewTypeDialog({
  organizationId,
  typeHrefPrefix,
  defaultOpen = false,
}: {
  organizationId: string;
  /** A type's address up to and including `type=`; the new type's id is appended. A function cannot cross from a server page. */
  typeHrefPrefix: string;
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [key, setKey] = useState(0);

  return <>
    <Button size="small" tone="secondary" onClick={() => { setKey(value => value + 1); setOpen(true); }}>
      <Plus size={16} aria-hidden />
      New type
    </Button>
    <GuardedDialog open={open} onOpenChange={setOpen} size="compact">
      <NewTypeBody key={key} organizationId={organizationId} onCreated={(typeId) => {
        setOpen(false);
        router.push(`${typeHrefPrefix}${typeId}&tab=workflow`);
      }} />
    </GuardedDialog>
  </>;
}

function NewTypeBody({ organizationId, onCreated }: { organizationId: string; onCreated: (typeId: string) => void }) {
  const formId = useId();
  const [pending, setPending] = useState(false);
  const cancel = useGuardedDialogClose();
  return <>
    <StepHeader title="New work type" description="Name a kind of work and say whether it happens at a set time. Stages come next." />
    <DialogBody><CreateTypeForm organizationId={organizationId} formId={formId} onPendingChange={setPending} onCreated={onCreated} /></DialogBody>
    <DialogFooterBar>
      <Button type="submit" form={formId} disabled={pending}>{pending ? 'Creating…' : 'Create type'}</Button>
      <Button type="button" tone="secondary" onClick={cancel}>Cancel</Button>
    </DialogFooterBar>
  </>;
}
