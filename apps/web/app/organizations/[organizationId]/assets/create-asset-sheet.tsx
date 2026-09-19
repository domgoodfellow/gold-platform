'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { PackagePlus } from 'lucide-react';
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

  return (
    <CreateAssetSheetContext.Provider value={() => setOpen(true)}>
      {children}
      <PageDrawer open={open} onOpenChange={setOpen}>
        <PageDrawerContent>
          <PageDrawerHeader>
            <PageDrawerTitle>New asset</PageDrawerTitle>
            <PageDrawerDescription>
              What work is about — machines, vehicles, properties, customer-owned equipment.
            </PageDrawerDescription>
          </PageDrawerHeader>
          <div className="px-4 pb-4">
            <CreateAssetForm
              organizationId={organizationId}
              customers={customers}
              locations={locations}
              definitions={definitions}
              onCreated={() => setOpen(false)}
            />
          </div>
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
