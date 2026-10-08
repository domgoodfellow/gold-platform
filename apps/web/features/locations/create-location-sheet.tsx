'use client';

import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { MapPinPlus } from 'lucide-react';
import { Button } from '@/components/controls/button';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerDescription,
  PageDrawerFooter,
  PageDrawerHeader,
  PageDrawerTitle,
} from '@/components/panels/page-drawer';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { CreateLocationForm } from './create-location-form';

const CreateLocationSheetContext = createContext<(() => void) | null>(null);

/**
 * Hosts the one PageDrawer instance for this collection. The header trigger and the empty-state
 * trigger both open it through the same function, so a business sees the same form — never a
 * second, auto-opened one — whichever button it presses.
 *
 * Linking an existing customer to an existing place is a different act from creating one and
 * keeps its own interaction on this page (out of scope for this PageDrawer).
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
  const [pending, setPending] = useState(false);
  const formId = useId();

  return (
    <CreateLocationSheetContext.Provider value={() => setOpen(true)}>
      {children}
      <PageDrawer open={open} onOpenChange={setOpen}>
        <PageDrawerContent className="flex flex-col gap-0 p-0">
          <PageDrawerHeader className="border-b border-border">
            <PageDrawerTitle>New location</PageDrawerTitle>
            <PageDrawerDescription>Places where this organization works.</PageDrawerDescription>
          </PageDrawerHeader>
          <div className="min-w-0">
            <CreateLocationForm
              organizationId={organizationId}
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
              {pending ? 'Adding…' : 'Add location'}
            </Button>
          </PageDrawerFooter>
        </PageDrawerContent>
      </PageDrawer>
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
