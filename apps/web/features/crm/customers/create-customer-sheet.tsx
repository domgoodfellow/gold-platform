'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { UserPlus } from 'lucide-react';
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
import { CreateCustomerForm } from './create-customer-form';

const CreateCustomerSheetContext = createContext<(() => void) | null>(null);

/**
 * Hosts the one Sheet instance for this collection. The header trigger and the empty-state
 * trigger both open it through the same function, so a business sees the same form — never a
 * second, auto-opened one — whichever button it presses.
 */
export function CreateCustomerSheetProvider({
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
    <CreateCustomerSheetContext.Provider value={() => setOpen(true)}>
      {children}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side={mobile ? 'bottom' : 'right'} className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>New customer</SheetTitle>
            <SheetDescription>Add the identity and contact details this business knows today.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <CreateCustomerForm
              organizationId={organizationId}
              definitions={definitions}
              onCreated={() => setOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </CreateCustomerSheetContext.Provider>
  );
}

export function CreateCustomerTrigger({
  children = (
    <>
      <UserPlus aria-hidden /> New customer
    </>
  ),
}: {
  children?: ReactNode;
}) {
  const open = useContext(CreateCustomerSheetContext);
  return (
    <Button type="button" onClick={() => open?.()}>
      {children}
    </Button>
  );
}
