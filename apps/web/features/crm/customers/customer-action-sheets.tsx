'use client';

import { useState, type ComponentProps, type ReactNode } from 'react';
import { Pencil, Phone } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@gold/ui/components/sheet';
import { useIsMobile } from '@gold/ui/hooks/use-mobile';
import type { Customer } from '@/lib/domain/customers/customers';
import type { CustomerStage } from '@/lib/domain/customers/stages';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { CallCustomerForm } from '@/features/communications/voice/call-customer-form';
import { EditCustomerForm } from './edit-customer-form';

function ResponsiveContent({ children, ...props }: ComponentProps<typeof SheetContent> & { children: ReactNode }) {
  const mobile = useIsMobile();
  return <SheetContent side={mobile ? 'bottom' : 'right'} className="max-h-[90vh] overflow-y-auto sm:max-w-xl" {...props}>{children}</SheetContent>;
}

export function EditCustomerSheet({ organizationId, customer, definitions, stages }: { organizationId: string; customer: Customer; definitions: FieldDefinition[]; stages: CustomerStage[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild><Button type="button" tone="secondary"><Pencil aria-hidden /> Edit</Button></SheetTrigger>
      <ResponsiveContent>
        <SheetHeader><SheetTitle>Edit {customer.name}</SheetTitle><SheetDescription>Correct contact details, custom fields, or the current sales stage.</SheetDescription></SheetHeader>
        <div className="px-4 pb-4"><EditCustomerForm organizationId={organizationId} customer={customer} definitions={definitions} stages={stages} onUpdated={() => setOpen(false)} /></div>
      </ResponsiveContent>
    </Sheet>
  );
}

export function CallCustomerSheet({ organizationId, customer }: { organizationId: string; customer: Customer }) {
  return (
    <Sheet>
      <SheetTrigger asChild><Button type="button"><Phone aria-hidden /> Call</Button></SheetTrigger>
      <ResponsiveContent>
        <SheetHeader><SheetTitle>Call {customer.name}</SheetTitle><SheetDescription>Place a provider call, or record one made outside GOLD.</SheetDescription></SheetHeader>
        <div className="px-4 pb-4"><CallCustomerForm organizationId={organizationId} customerId={customer.id} phone={customer.phone} /></div>
      </ResponsiveContent>
    </Sheet>
  );
}
