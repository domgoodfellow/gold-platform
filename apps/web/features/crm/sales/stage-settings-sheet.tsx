'use client';

import { Settings2 } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { DividedList, EmptyState } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@gold/ui/components/sheet';
import { useIsMobile } from '@gold/ui/hooks/use-mobile';
import type { CustomerStage } from '@/lib/domain/customers/stages';
import { CreateStageForm, EditStageForm } from './stage-settings';

export function StageSettingsSheet({ organizationId, stages, mayConfigure, role }: { organizationId: string; stages: CustomerStage[]; mayConfigure: boolean; role: string }) {
  const mobile = useIsMobile();
  return (
    <Sheet>
      <SheetTrigger asChild><Button type="button" tone="secondary"><Settings2 aria-hidden /> Stages</Button></SheetTrigger>
      <SheetContent side={mobile ? 'bottom' : 'right'} className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Pipeline stages</SheetTitle>
          <SheetDescription>The words this business uses for where a relationship has got to.</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 px-4 pb-4">
          {stages.length === 0 ? <EmptyState>No stages named.</EmptyState> : (
            <DividedList>{stages.map((stage) => <li key={stage.id}>{mayConfigure ? <EditStageForm organizationId={organizationId} stage={stage} /> : <div className="py-3">{stage.name}</div>}</li>)}</DividedList>
          )}
          {mayConfigure ? <CreateStageForm organizationId={organizationId} /> : <Hint>Your role, {role}, cannot change these words.</Hint>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
