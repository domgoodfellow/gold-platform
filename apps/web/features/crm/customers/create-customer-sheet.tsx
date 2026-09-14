'use client';

import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/controls/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@gold/ui/components/sheet';
import { useIsMobile } from '@gold/ui/hooks/use-mobile';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { CreateCustomerForm } from './create-customer-form';

export function CreateCustomerSheet({
  organizationId,
  definitions,
  defaultOpen = false,
}: {
  organizationId: string;
  definitions: FieldDefinition[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const mobile = useIsMobile();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button"><UserPlus aria-hidden /> New customer</Button>
      </SheetTrigger>
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
  );
}
