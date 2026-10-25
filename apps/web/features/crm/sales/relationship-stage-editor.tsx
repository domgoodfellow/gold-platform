'use client';
import { useActionState, useEffect, useId, useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { FormError, FormField } from '@/components/controls/form';
import { TextInput } from '@/components/controls/inputs';
import { useDrawerFormSubmit } from '@/components/controls/use-drawer-form-submit';
import { useFormDirty } from '@/components/controls/use-form-dirty';
import { ConfirmSubmit } from '@/components/controls/confirm-submit';
import { DialogBody, DialogFooterBar, StepHeader } from '@/components/panels/dialog-layout';
import { GuardedDialog, useGuardedDialogClose, useGuardedDialogDirty } from '@/components/panels/guarded-dialog';
import type { CustomerStage } from '@/lib/domain/customers/stages';
import { createStageAction, deleteStageAction, moveStageAction, renameStageAction, type FormState } from '@/app/organizations/[organizationId]/crm/contacts/stages/actions';

const INITIAL: FormState = { error: null };

/**
 * Add or rename one relationship stage in a focused dialog. Nothing here proposes a word: a
 * platform that seeds no stages may not seed one through a placeholder either.
 */
export function RelationshipStageDialog({ organizationId, stage, triggerTone = 'secondary' }: { organizationId: string; stage?: CustomerStage; triggerTone?: 'primary' | 'secondary' | 'ghost' }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return <>
    {stage ? <Button type="button" tone="ghost" size="small" aria-label={`Rename ${stage.name}`} onClick={() => { setKey(value => value + 1); setOpen(true); }}><Pencil aria-hidden /></Button>
      : <Button type="button" tone={triggerTone} onClick={() => { setKey(value => value + 1); setOpen(true); }}><Plus aria-hidden /> Add stage</Button>}
    <GuardedDialog open={open} onOpenChange={setOpen} className="w-[min(28rem,calc(100%-1rem))]">
      <StageForm key={key} organizationId={organizationId} stage={stage} onSaved={() => setOpen(false)} />
    </GuardedDialog>
  </>;
}

function StageForm({ organizationId, stage, onSaved }: { organizationId: string; stage?: CustomerStage; onSaved: () => void }) {
  const formId = useId();
  const [state, action, pending] = useActionState(stage ? renameStageAction : createStageAction, INITIAL);
  const { ref, dirty, onChange } = useFormDirty();
  useGuardedDialogDirty(dirty);
  const { onSubmit, errorRef } = useDrawerFormSubmit(action, state, pending);
  const cancel = useGuardedDialogClose();
  // A completed save returns a new state; only a completed one without an error closes the dialog.
  useEffect(() => { if (state !== INITIAL && !state.error) onSaved(); }, [state, onSaved]);
  return <>
    <StepHeader title={stage ? 'Rename stage' : 'Add stage'} />
    <DialogBody>
      <form id={formId} ref={ref} onSubmit={onSubmit} onChange={onChange} className="flex flex-col gap-3">
        <input type="hidden" name="organizationId" value={organizationId} />
        {stage ? <input type="hidden" name="id" value={stage.id} /> : null}
        <FormField id={`${formId}-name`} label="Stage name">{field => <TextInput {...field} name="name" required maxLength={64} defaultValue={stage?.name ?? ''} autoFocus />}</FormField>
        <div ref={errorRef} tabIndex={-1} className="outline-none"><FormError>{state.error}</FormError></div>
      </form>
    </DialogBody>
    <DialogFooterBar>
      <Button type="submit" form={formId} disabled={pending}>{pending ? 'Saving…' : stage ? 'Save name' : 'Add stage'}</Button>
      <Button type="button" tone="secondary" onClick={cancel}>Cancel</Button>
    </DialogFooterBar>
  </>;
}

/** Keyboard-reachable reordering through the existing position column: each move is one persisted step. */
export function StageMoveControls({ organizationId, stage, first, last }: { organizationId: string; stage: CustomerStage; first: boolean; last: boolean }) {
  return <>{([['up', ArrowUp, first], ['down', ArrowDown, last]] as const).map(([direction, Icon, disabled]) => <form key={direction} action={moveStageAction}>
    <input type="hidden" name="organizationId" value={organizationId} /><input type="hidden" name="id" value={stage.id} /><input type="hidden" name="direction" value={direction} />
    <Button type="submit" tone="ghost" size="small" disabled={disabled} aria-label={`Move ${stage.name} ${direction}`}><Icon aria-hidden /></Button>
  </form>)}</>;
}

/** Removal is offered only for a stage nothing uses, and still asks first; the database refuses otherwise. */
export function DeleteStageControl({ organizationId, stage }: { organizationId: string; stage: CustomerStage }) {
  const [state, action, pending] = useActionState(deleteStageAction, INITIAL);
  const formId = `delete-stage-${stage.id}`;
  return <form id={formId} action={action} className="flex items-center gap-2">
    <input type="hidden" name="organizationId" value={organizationId} /><input type="hidden" name="id" value={stage.id} />
    <ConfirmSubmit formId={formId} label={<Trash2 aria-hidden />} ariaLabel={`Remove ${stage.name}`} confirmLabel={`Remove ${stage.name}?`} description="No contact is on this stage. Removing it cannot be undone." tone="ghost" size="small" pending={pending} />
    {state.error ? <FormError>{state.error}</FormError> : null}
  </form>;
}
