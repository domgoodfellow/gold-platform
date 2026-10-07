'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/controls/button';
import { SelectInput, TextInput } from '@/components/controls/inputs';
import { FormField, FormError } from '@/components/controls/form';
import { PageDrawer, PageDrawerContent, PageDrawerHeader, PageDrawerTitle, PageDrawerTrigger } from '@/components/panels/page-drawer';
import { moveOpportunityAction, saveOpportunityStageAction } from '@/app/organizations/[organizationId]/opportunities/actions';
import type { OpportunityStage } from '@/lib/domain/opportunities/opportunities';

export function OpportunityStageControl({ organizationId, opportunityId, title, stageId, stages }: { organizationId: string; opportunityId: string; title: string; stageId: string | null; stages: OpportunityStage[] }) {
  const [state, action, pending] = useActionState(moveOpportunityAction, { error: null, savedId: null });
  const prefix = useId();
  return <form action={action} className="space-y-2">
    <input type="hidden" name="organizationId" value={organizationId} /><input type="hidden" name="opportunityId" value={opportunityId} />
    <FormField id={prefix} label={`Stage for ${title}`}>{(props) => <SelectInput {...props} name="stageId" defaultValue={stageId ?? ''}><option value="">Unstaged</option>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</SelectInput>}</FormField>
    <Button type="submit" tone="secondary" size="small" disabled={pending}>{pending ? 'Moving…' : 'Move'}</Button>
    <FormError>{state.error}</FormError>
  </form>;
}
export function OpportunityStageSheet({ organizationId, stage, nextPosition = 0 }: { organizationId: string; stage?: OpportunityStage; nextPosition?: number }) {
  const [open, setOpen] = useState(false);
  return <PageDrawer open={open} onOpenChange={setOpen}>
    <PageDrawerTrigger asChild><Button tone="secondary">{stage ? `Edit ${stage.name}` : 'New opportunity stage'}</Button></PageDrawerTrigger>
    <PageDrawerContent><PageDrawerHeader><PageDrawerTitle>{stage ? 'Edit opportunity stage' : 'New opportunity stage'}</PageDrawerTitle></PageDrawerHeader>
      <StageForm organizationId={organizationId} stage={stage} nextPosition={nextPosition} onSaved={() => setOpen(false)} />
    </PageDrawerContent>
  </PageDrawer>;
}
function StageForm({ organizationId, stage, nextPosition, onSaved }: { organizationId: string; stage?: OpportunityStage; nextPosition: number; onSaved: () => void }) {
  const [state, action, pending] = useActionState(saveOpportunityStageAction, { error: null, savedId: null });
  const prefix = useId();
  const router = useRouter();
  useEffect(() => { if (state.savedId) { onSaved(); router.refresh(); } }, [state.savedId, onSaved, router]);
  return <form action={action} className="space-y-4 p-4" onReset={(event) => event.preventDefault()}>
    <input type="hidden" name="organizationId" value={organizationId} /><input type="hidden" name="id" value={stage?.id ?? ''} />
    <FormField id={`${prefix}-name`} label="Name">{(props) => <TextInput {...props} name="name" required maxLength={64} defaultValue={stage?.name ?? ''} />}</FormField>
    <FormField id={`${prefix}-position`} label="Position">{(props) => <TextInput {...props} name="position" type="number" min={0} step={1} required defaultValue={stage?.position ?? nextPosition} />}</FormField>
    <FormField id={`${prefix}-kind`} label="Classification" hint="Open, Won or Lost. Once used, a stage keeps its classification. Only one Won and one Lost stage may be configured.">{(props) => <SelectInput {...props} name="kind" defaultValue={stage?.kind ?? 'open'}><option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option></SelectInput>}</FormField>
    <FormError>{state.error}</FormError><Button disabled={pending} type="submit">{pending ? 'Saving…' : 'Save stage'}</Button>
  </form>;
}
