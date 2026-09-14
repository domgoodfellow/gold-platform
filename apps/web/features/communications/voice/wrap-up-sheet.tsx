'use client';

import { ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@gold/ui/components/sheet';
import { useIsMobile } from '@gold/ui/hooks/use-mobile';
import type { Call } from '@/lib/domain/reception/calls';
import type { CallOutcome } from '@/lib/domain/reception/outcomes';
import { WrapUpCallForm } from './wrap-up-form';

export function WrapUpCallSheet({ organizationId, call, outcomes }: { organizationId: string; call: Call; outcomes: CallOutcome[] }) {
  const mobile = useIsMobile();
  return (
    <Sheet>
      <SheetTrigger asChild><Button type="button" tone="text" size="tiny"><ClipboardCheck aria-hidden /> Wrap up</Button></SheetTrigger>
      <SheetContent side={mobile ? 'bottom' : 'right'} className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <SheetHeader><SheetTitle>Wrap up call</SheetTitle><SheetDescription>Record how the call went without changing the network’s status.</SheetDescription></SheetHeader>
        <div className="px-4 pb-4"><WrapUpCallForm organizationId={organizationId} callId={call.id} outcomes={outcomes} note={call.note} outcomeId={call.outcome?.id ?? null} /></div>
      </SheetContent>
    </Sheet>
  );
}
