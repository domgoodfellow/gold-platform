'use client';
import { BusinessLabel } from '@/lib/context/business-vocabulary';

import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/controls/button';
import {
  PageDrawer,
  PageDrawerClose,
  PageDrawerContent,
  PageDrawerDescription,
  PageDrawerFooter,
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
  defaultOpen = false,
  initialType='',
}: {
  organizationId: string;
  definitions: FieldDefinition[];
  children: ReactNode;
  defaultOpen?: boolean;
  initialType?: 'person'|'company'|'';
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [pending, setPending] = useState(false);
  const formId = useId();

  return (
    <CreateCustomerSheetContext.Provider value={() => setOpen(true)}>
      {children}
      <PageDrawer open={open} onOpenChange={setOpen}>
        <PageDrawerContent>
          <PageDrawerHeader>
            <PageDrawerTitle><BusinessLabel>Add contact</BusinessLabel></PageDrawerTitle>
            <PageDrawerDescription>Add the identity and contact details this business knows today.</PageDrawerDescription>
          </PageDrawerHeader>
          <CreateCustomerForm
            organizationId={organizationId}
            definitions={definitions}
            formId={formId}
            initialType={initialType}
            onCreated={() => setOpen(false)}
            onPendingChange={setPending}
          />
          <PageDrawerFooter>
            <Button type="submit" form={formId} disabled={pending}>
              {pending ? 'Adding…' : 'Add contact'}
            </Button>
            <PageDrawerClose asChild>
              <Button type="button" tone="secondary">Cancel</Button>
            </PageDrawerClose>
          </PageDrawerFooter>
        </PageDrawerContent>
      </PageDrawer>
    </CreateCustomerSheetContext.Provider>
  );
}

export function CreateCustomerTrigger({
  children = (
    <>
      <UserPlus aria-hidden /> <BusinessLabel>Add contact</BusinessLabel>
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
