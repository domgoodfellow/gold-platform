'use client';

import { Settings2 } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { DividedList, EmptyState, GroupHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@gold/ui/components/sheet';
import { useIsMobile } from '@gold/ui/hooks/use-mobile';
import type { CallOutcome } from '@/lib/domain/reception/outcomes';
import { OutboundIdentity } from './outbound-identity';
import { CreateOutcomeForm } from './outcome-settings';

export function VoiceSettingsSheet({ organizationId, number, outcomes, mayManageIdentity, mayConfigureOutcomes, role }: {
  organizationId: string;
  number: string | null;
  outcomes: CallOutcome[];
  mayManageIdentity: boolean;
  mayConfigureOutcomes: boolean;
  role: string;
}) {
  const mobile = useIsMobile();
  return (
    <Sheet>
      <SheetTrigger asChild><Button type="button" tone="secondary"><Settings2 aria-hidden /> Voice settings</Button></SheetTrigger>
      <SheetContent side={mobile ? 'bottom' : 'right'} className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <SheetHeader><SheetTitle>Voice settings</SheetTitle><SheetDescription>Outbound identity and the words this business uses after a call.</SheetDescription></SheetHeader>
        <div className="space-y-8 px-4 pb-4">
          <section>
            <GroupHeading>Outbound identity</GroupHeading>
            {mayManageIdentity ? <OutboundIdentity organizationId={organizationId} number={number} /> : <Hint className="mt-2">{number ?? 'None set.'} Your role, {role}, cannot change it.</Hint>}
          </section>
          <section>
            <GroupHeading>Call outcomes</GroupHeading>
            {outcomes.length === 0 ? <EmptyState className="mt-2">No outcomes named.</EmptyState> : (
              <DividedList className="mt-2">{outcomes.map((outcome) => <li key={outcome.id} className="flex items-center justify-between gap-3 py-2"><span>{outcome.name}</span><span className="text-xs text-muted">{outcome.reached ? 'Reached' : 'Not reached'}</span></li>)}</DividedList>
            )}
            {mayConfigureOutcomes ? <div className="mt-4"><CreateOutcomeForm organizationId={organizationId} /></div> : <Hint className="mt-3">Your role, {role}, cannot change these words.</Hint>}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
