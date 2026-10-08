'use client';

import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { PackagePlus } from 'lucide-react';
import { Button } from '@/components/controls/button';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerDescription,
  PageDrawerFooter,
  PageDrawerHeader,
  PageDrawerTitle,
} from '@/components/panels/page-drawer';
import type { SelectOption } from '@/components/controls/optional-select';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { CreateAssetForm } from './create-asset-form';

const CreateAssetSheetContext = createContext<(() => void) | null>(null);

/**
 * Hosts the one PageDrawer instance for this collection. The header trigger and the empty-state
 * trigger both open it through the same function, so a business sees the same form — never a
 * second, auto-opened one — whichever button it presses.
 */
export function CreateAssetSheetProvider({
  organizationId,
  customers,
  locations,
  definitions,
  children,
}: {
  organizationId: string;
  customers: SelectOption[];
  locations: SelectOption[];
  definitions: FieldDefinition[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const formId = useId();

  return (
    <CreateAssetSheetContext.Provider value={() => setOpen(true)}>
      {children}
      <PageDrawer open={open} onOpenChange={setOpen}>
        <PageDrawerContent className="flex flex-col gap-0 p-0">
          <PageDrawerHeader className="border-b border-border">
            <PageDrawerTitle>New asset</PageDrawerTitle>
            <PageDrawerDescription>
              What work is about — machines, vehicles, properties, customer-owned equipment.
            </PageDrawerDescription>
          </PageDrawerHeader>
          <div className="min-w-0">
            <CreateAssetForm
              organizationId={organizationId}
              customers={customers}
              locations={locations}
              definitions={definitions}
              onCreated={() => setOpen(false)}
              formId={formId}
              onPendingChange={setPending}
            />
          </div>
          <PageDrawerFooter className="flex-row justify-end border-t border-border">
            <Button type="button" tone="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} disabled={pending}>
              {pending ? 'Adding…' : 'Add asset'}
            </Button>
          </PageDrawerFooter>
        </PageDrawerContent>
      </PageDrawer>
    </CreateAssetSheetContext.Provider>
  );
}

export function CreateAssetTrigger({
  children = (
    <>
      <PackagePlus aria-hidden /> Add asset
    </>
  ),
}: {
  children?: ReactNode;
}) {
  const open = useContext(CreateAssetSheetContext);
  return (
    <Button type="button" onClick={() => open?.()}>
      {children}
    </Button>
  );
}
