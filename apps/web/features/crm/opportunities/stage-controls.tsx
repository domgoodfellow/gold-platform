'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { SelectInput, TextInput } from '@/components/controls/inputs';
import { FormField, FormError } from '@/components/controls/form';
import { useFormDirty } from '@/components/controls/use-form-dirty';
import { DialogBody, DialogFooterBar, StepHeader } from '@/components/panels/dialog-layout';
import { GuardedDialog, useGuardedDialogClose, useGuardedDialogDirty } from '@/components/panels/guarded-dialog';
import { moveOpportunityAction, saveOpportunityStageAction } from '@/app/organizations/[organizationId]/crm/opportunities/actions';
import type { OpportunityStage } from '@/lib/domain/opportunities/opportunities';

/** Move one opportunity to another stage: a compact select and an explicit Move, persisted by the existing action. */
export function OpportunityStageControl({ organizationId, opportunityId, title, stageId, stages }: { organizationId: string; opportunityId: string; title: string; stageId: string | null; stages: OpportunityStage[] }) {
  const [state, action, pending] = useActionState(moveOpportunityAction, { error: null, savedId: null });
  return <form action={action} className="flex flex-col gap-1">
    <input type="hidden" name="organizationId" value={organizationId} /><input type="hidden" name="opportunityId" value={opportunityId} />
    <div className="flex items-center gap-1.5">
      <SelectInput aria-label={`Stage for ${title}`} name="stageId" size="small" defaultValue={stageId ?? ''} className="min-w-0 flex-1"><option value="">Unstaged</option>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</SelectInput>
      <Button type="submit" tone="secondary" size="small" disabled={pending}>{pending ? 'Moving…' : 'Move'}</Button>
    </div>
    <FormError>{state.error}</FormError>
  </form>;
}

/**
 * Add or edit one opportunity stage in a focused dialog — the single opportunity-stage editor,
 * opened from the configuration page. Opportunity stages are separate from contact lifecycle and
 * from relationship stages.
 */
export function OpportunityStageSheet({ organizationId, stage, nextPosition = 0 }: { organizationId: string; stage?: OpportunityStage; nextPosition?: number }) {
  // The trigger's emphasis follows whether this edits or creates, never anything about the stage's own words.
  const editing = Boolean(stage);
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return <>
    <Button type="button" tone={editing ? 'ghost' : 'primary'} size={editing ? 'small' : undefined} aria-label={stage ? `Edit ${stage.name}` : undefined} onClick={() => { setKey(value => value + 1); setOpen(true); }}>{stage ? 'Edit' : <><Plus aria-hidden /> New opportunity stage</>}</Button>
    <GuardedDialog open={open} onOpenChange={setOpen} className="w-[min(30rem,calc(100%-1rem))]">
      <StageForm key={key} organizationId={organizationId} stage={stage} nextPosition={nextPosition} onSaved={() => setOpen(false)} />
    </GuardedDialog>
  </>;
}
function StageForm({ organizationId, stage, nextPosition, onSaved }: { organizationId: string; stage?: OpportunityStage; nextPosition: number; onSaved: () => void }) {
  const [state, action, pending] = useActionState(saveOpportunityStageAction, { error: null, savedId: null });
  const prefix = useId();
  const router = useRouter();
  const { ref, dirty, onChange } = useFormDirty();
  useGuardedDialogDirty(dirty);
  const cancel = useGuardedDialogClose();
  useEffect(() => { if (state.savedId) { onSaved(); router.refresh(); } }, [state.savedId, onSaved, router]);
  return <>
    <StepHeader title={stage ? 'Edit opportunity stage' : 'New opportunity stage'} />
    <DialogBody>
      <form id={prefix} ref={ref} action={action} onChange={onChange} className="flex flex-col gap-4" onReset={(event) => event.preventDefault()}>
        <input type="hidden" name="organizationId" value={organizationId} /><input type="hidden" name="id" value={stage?.id ?? ''} />
        <FormField id={`${prefix}-name`} label="Name">{(props) => <TextInput {...props} name="name" required maxLength={64} defaultValue={stage?.name ?? ''} />}</FormField>
        <FormField id={`${prefix}-position`} label="Position">{(props) => <TextInput {...props} name="position" type="number" min={0} step={1} required defaultValue={stage?.position ?? nextPosition} />}</FormField>
        <FormField id={`${prefix}-kind`} label="Classification" hint="Once used, a stage keeps its classification. Only one Won and one Lost stage may be configured.">{(props) => <SelectInput {...props} name="kind" defaultValue={stage?.kind ?? 'open'}><option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option></SelectInput>}</FormField>
        <FormError>{state.error}</FormError>
      </form>
    </DialogBody>
    <DialogFooterBar>
      <Button type="submit" form={prefix} disabled={pending}>{pending ? 'Saving…' : 'Save stage'}</Button>
      <Button type="button" tone="secondary" onClick={cancel}>Cancel</Button>
    </DialogFooterBar>
  </>;
}
