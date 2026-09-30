'use client';

import { ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { PageDrawer, PageDrawerContent, PageDrawerDescription, PageDrawerHeader, PageDrawerTitle, PageDrawerTrigger } from '@/components/panels/page-drawer';
import type { Call } from '@/lib/domain/reception/calls';
import type { CallOutcome } from '@/lib/domain/reception/outcomes';
import { WrapUpCallForm } from './wrap-up-form';

export function WrapUpCallSheet({ organizationId, call, outcomes }: { organizationId: string; call: Call; outcomes: CallOutcome[] }) {
  return (
    <PageDrawer>
      <PageDrawerTrigger asChild><Button type="button" tone="text" size="tiny"><ClipboardCheck aria-hidden /> Wrap up</Button></PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader><PageDrawerTitle>Wrap up call</PageDrawerTitle><PageDrawerDescription>Record how the call went without changing the network’s status.</PageDrawerDescription></PageDrawerHeader>
        <div className="px-4 pb-4"><WrapUpCallForm organizationId={organizationId} callId={call.id} outcomes={outcomes} note={call.note} outcomeId={call.outcome?.id ?? null} /></div>
      </PageDrawerContent>
    </PageDrawer>
  );
}
