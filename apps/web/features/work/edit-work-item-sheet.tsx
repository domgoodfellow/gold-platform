'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/controls/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@gold/ui/components/sheet';
import { useIsMobile } from '@gold/ui/hooks/use-mobile';
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
  const mobile = useIsMobile();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button type="button" tone="secondary" onClick={() => setOpen(true)} className="mt-3">
        <Pencil aria-hidden /> Correct job details
      </Button>
      <SheetContent side={mobile ? 'bottom' : 'right'} className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Correct job details</SheetTitle>
          <SheetDescription>Title, customer, location and asset.</SheetDescription>
        </SheetHeader>
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
      </SheetContent>
    </Sheet>
  );
}
