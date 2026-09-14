'use client';

import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/controls/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@gold/ui/components/sheet';
import { useIsMobile } from '@gold/ui/hooks/use-mobile';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { CreateResourceForm } from './create-resource-form';

const CreateResourceSheetContext = createContext<(() => void) | null>(null);

/**
 * Hosts the one Sheet instance for this collection. The header trigger and the empty-state
 * trigger both open it through the same function, so a business sees the same form — never a
 * second, auto-opened one — whichever button it presses.
 */
export function CreateResourceSheetProvider({
  organizationId,
  definitions,
  children,
}: {
  organizationId: string;
  definitions: FieldDefinition[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const mobile = useIsMobile();
  const formId = useId();

  return (
    <CreateResourceSheetContext.Provider value={() => setOpen(true)}>
      {children}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side={mobile ? 'bottom' : 'right'}
          className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-lg"
        >
          <SheetHeader className="border-b border-border">
            <SheetTitle>New resource</SheetTitle>
            <SheetDescription>
              People, vehicles and equipment that work is scheduled against.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-4">
            <CreateResourceForm
              organizationId={organizationId}
              definitions={definitions}
              onCreated={() => setOpen(false)}
              formId={formId}
              onPendingChange={setPending}
            />
          </div>
          <SheetFooter className="flex-row justify-end border-t border-border">
            <Button type="button" tone="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} disabled={pending}>
              {pending ? 'Adding…' : 'Add resource'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </CreateResourceSheetContext.Provider>
  );
}

export function CreateResourceTrigger({
  children = (
    <>
      <UserPlus aria-hidden /> Add resource
    </>
  ),
}: {
  children?: ReactNode;
}) {
  const open = useContext(CreateResourceSheetContext);
  return (
    <Button type="button" onClick={() => open?.()}>
      {children}
    </Button>
  );
}
