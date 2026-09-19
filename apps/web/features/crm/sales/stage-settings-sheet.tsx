'use client';

import { Settings2 } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { DividedList, EmptyState } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { PageDrawer, PageDrawerContent, PageDrawerDescription, PageDrawerHeader, PageDrawerTitle, PageDrawerTrigger } from '@/components/containers/page-drawer';
import type { CustomerStage } from '@/lib/domain/customers/stages';
import { CreateStageForm, EditStageForm } from './stage-settings';

export function StageSettingsSheet({ organizationId, stages, mayConfigure, role }: { organizationId: string; stages: CustomerStage[]; mayConfigure: boolean; role: string }) {
  return (
    <PageDrawer>
      <PageDrawerTrigger asChild><Button type="button" tone="secondary"><Settings2 aria-hidden /> Stages</Button></PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>Pipeline stages</PageDrawerTitle>
          <PageDrawerDescription>The words this business uses for where a relationship has got to.</PageDrawerDescription>
        </PageDrawerHeader>
        <div className="space-y-6 px-4 pb-4">
          {stages.length === 0 ? <EmptyState>No stages named.</EmptyState> : (
            <DividedList>{stages.map((stage) => <li key={stage.id}>{mayConfigure ? <EditStageForm organizationId={organizationId} stage={stage} /> : <div className="py-3">{stage.name}</div>}</li>)}</DividedList>
          )}
          {mayConfigure ? <CreateStageForm organizationId={organizationId} /> : <Hint>Your role, {role}, cannot change these words.</Hint>}
        </div>
      </PageDrawerContent>
    </PageDrawer>
  );
}
