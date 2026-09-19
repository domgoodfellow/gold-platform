'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/controls/button';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerDescription,
  PageDrawerHeader,
  PageDrawerTitle,
} from '@/components/containers/page-drawer';
import type { SelectOption } from '@/components/controls/optional-select';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { WorkItem } from '@/lib/domain/work-items/work-items';
import { EditWorkItemForm } from './details-form';

export function EditWorkItemSheet({
  organizationId,
  workItem,
  customers,
  locations,
  assets,
  assetsEnabled,
  definitions,
}: {
  organizationId: string;
  workItem: WorkItem;
  customers: SelectOption[];
  locations: SelectOption[];
  assets: SelectOption[];
  assetsEnabled: boolean;
  definitions: FieldDefinition[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <Button type="button" tone="secondary" onClick={() => setOpen(true)} className="mt-3">
        <Pencil aria-hidden /> Correct job details
      </Button>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>Correct job details</PageDrawerTitle>
          <PageDrawerDescription>Title, customer, location and asset.</PageDrawerDescription>
        </PageDrawerHeader>
        <div className="px-4 pb-4">
          <EditWorkItemForm
            organizationId={organizationId}
            workItem={workItem}
            customers={customers}
            locations={locations}
            assets={assets}
            assetsEnabled={assetsEnabled}
            definitions={definitions}
            onUpdated={() => setOpen(false)}
          />
        </div>
      </PageDrawerContent>
    </PageDrawer>
  );
}
