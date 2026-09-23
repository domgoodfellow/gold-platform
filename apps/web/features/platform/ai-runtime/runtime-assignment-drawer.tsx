'use client';

import { Button } from '@/components/controls/button';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/containers/page-drawer';
import type { AiCapability } from '@/lib/domain/ai/runtime';
import { RuntimeAssignmentForm, type RuntimeAccount, type RuntimeService } from './runtime-assignment-form';

/**
 * One capability's own drawer, uncontrolled and independent of every other row's — `PageDrawer`
 * stacks by design, which is what lets each row open its own without a page-level singleton
 * "Configure" mode (that mechanism is for one workspace-wide panel; this is a list of two rows,
 * each with its own subject).
 */
export function RuntimeAssignmentDrawer({
  capability,
  label,
  services,
  accounts,
  current,
  triggerLabel,
}: {
  capability: AiCapability;
  label: string;
  services: RuntimeService[];
  accounts: RuntimeAccount[];
  current?: { providerServiceId: string; providerAccountId: string; model: string };
  triggerLabel: string;
}) {
  return (
    <PageDrawer>
      <PageDrawerTrigger asChild>
        <Button type="button" tone="secondary" size="small">
          {triggerLabel}
        </Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>{label}</PageDrawerTitle>
        </PageDrawerHeader>
        <div className="flex flex-col gap-4 p-4">
          <RuntimeAssignmentForm capability={capability} services={services} accounts={accounts} current={current} />
        </div>
      </PageDrawerContent>
    </PageDrawer>
  );
}
