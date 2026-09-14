'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { MapPinPlus } from 'lucide-react';
import { Button } from '@/components/controls/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@gold/ui/components/sheet';
import { useIsMobile } from '@gold/ui/hooks/use-mobile';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { CreateLocationForm } from './location-forms';

const CreateLocationSheetContext = createContext<(() => void) | null>(null);

/**
 * Hosts the one Sheet instance for this collection. The header trigger and the empty-state
 * trigger both open it through the same function, so a business sees the same form — never a
 * second, auto-opened one — whichever button it presses.
 *
 * Linking an existing customer to an existing place is a different act from creating one and
 * keeps its own inline form on this page (out of scope for this Sheet).
 */
export function CreateLocationSheetProvider({
  organizationId,
  definitions,
  children,
}: {
  organizationId: string;
  definitions: FieldDefinition[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const mobile = useIsMobile();

  return (
    <CreateLocationSheetContext.Provider value={() => setOpen(true)}>
      {children}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side={mobile ? 'bottom' : 'right'} className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>New location</SheetTitle>
            <SheetDescription>Places where this organization works.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <CreateLocationForm
              organizationId={organizationId}
              definitions={definitions}
              onCreated={() => setOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </CreateLocationSheetContext.Provider>
  );
}

export function CreateLocationTrigger({
  children = (
    <>
      <MapPinPlus aria-hidden /> Add location
    </>
  ),
}: {
  children?: ReactNode;
}) {
  const open = useContext(CreateLocationSheetContext);
  return (
    <Button type="button" onClick={() => open?.()}>
      {children}
    </Button>
  );
}
