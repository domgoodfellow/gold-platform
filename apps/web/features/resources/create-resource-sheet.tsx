'use client';

import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { UserPlus } from 'lucide-react';
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
import type { AvailableMember } from './member-options';
import { CreateResourceForm } from './create-resource-form';

const CreateResourceSheetContext = createContext<(() => void) | null>(null);

/**
 * Hosts the one PageDrawer instance for this collection. The header trigger and the empty-state
 * trigger both open it through the same function, so a business sees the same form — never a
 * second, auto-opened one — whichever button it presses.
 */
export function CreateResourceSheetProvider({
  organizationId,
  definitions,
  availableMembers,
  children,
}: {
  organizationId: string;
  definitions: FieldDefinition[];
  /** Members not already representing another Resource — see `member-options.ts`. */
  availableMembers: AvailableMember[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const formId = useId();

  return (
    <CreateResourceSheetContext.Provider value={() => setOpen(true)}>
      {children}
      <PageDrawer open={open} onOpenChange={setOpen}>
        <PageDrawerContent className="flex flex-col gap-0 p-0">
          <PageDrawerHeader className="border-b border-border">
            <PageDrawerTitle>New resource</PageDrawerTitle>
            <PageDrawerDescription>
              People, vehicles and equipment that work is scheduled against.
            </PageDrawerDescription>
          </PageDrawerHeader>
          <div className="flex-1 overflow-y-auto p-4">
            <CreateResourceForm
              organizationId={organizationId}
              definitions={definitions}
              availableMembers={availableMembers}
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
              {pending ? 'Adding…' : 'Add resource'}
            </Button>
          </PageDrawerFooter>
        </PageDrawerContent>
      </PageDrawer>
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
