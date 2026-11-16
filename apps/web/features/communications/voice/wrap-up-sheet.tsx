'use client';

import { useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { PageDrawer, PageDrawerContent, PageDrawerDescription, PageDrawerHeader, PageDrawerTitle, PageDrawerTrigger } from '@/components/panels/page-drawer';
import type { Call } from '@/lib/domain/reception/calls';
import type { CallOutcome } from '@/lib/domain/reception/outcomes';
import { WrapUpCallForm } from './wrap-up-form';

/**
 * `prominent` is the trigger where wrapping up is the next step, such as straight after a call; in
 * a list it stays a row action. With `onSaved` the drawer closes once the outcome is saved and
 * says so, which is how the Dialer knows a call's outcome is resolved.
 */
export function WrapUpCallSheet({ organizationId, call, outcomes, prominent = false, onSaved }: { organizationId: string; call: Pick<Call, 'id' | 'note' | 'outcome'>; outcomes: CallOutcome[]; prominent?: boolean; onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild><Button type="button" tone={prominent ? 'primary' : 'text'} size={prominent ? 'default' : 'tiny'}><ClipboardCheck aria-hidden /> Wrap up</Button></PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader><PageDrawerTitle>Wrap up call</PageDrawerTitle><PageDrawerDescription>Record how the call went.</PageDrawerDescription></PageDrawerHeader>
        <div><WrapUpCallForm organizationId={organizationId} callId={call.id} outcomes={outcomes} note={call.note} outcomeId={call.outcome?.id ?? null} onSaved={onSaved ? () => { setOpen(false); onSaved(); } : undefined} /></div>
      </PageDrawerContent>
    </PageDrawer>
  );
}
