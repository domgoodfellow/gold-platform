'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/controls/button';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerDescription,
  PageDrawerHeader,
  PageDrawerTitle,
} from '@/components/panels/page-drawer';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { CreateCustomerForm } from './create-customer-form';

const CreateCustomerSheetContext = createContext<(() => void) | null>(null);

/**
 * Hosts the one PageDrawer instance for this collection. The header trigger and the empty-state
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

  return (
    <CreateCustomerSheetContext.Provider value={() => setOpen(true)}>
      {children}
      <PageDrawer open={open} onOpenChange={setOpen}>
        <PageDrawerContent>
          <PageDrawerHeader>
            <PageDrawerTitle>New customer</PageDrawerTitle>
            <PageDrawerDescription>Add the identity and contact details this business knows today.</PageDrawerDescription>
          </PageDrawerHeader>
          <div>
            <CreateCustomerForm
              organizationId={organizationId}
              definitions={definitions}
              onCreated={() => setOpen(false)}
            />
          </div>
        </PageDrawerContent>
      </PageDrawer>
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
