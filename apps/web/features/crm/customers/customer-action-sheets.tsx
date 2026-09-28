'use client';

import { useState } from 'react';
import { Pencil, Phone } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { PageDrawer, PageDrawerContent, PageDrawerDescription, PageDrawerHeader, PageDrawerTitle, PageDrawerTrigger } from '@/components/containers/page-drawer';
import type { Customer } from '@/lib/domain/customers/customers';
import type { CustomerStage } from '@/lib/domain/customers/stages';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { CallCustomerForm } from '@/features/communications/voice/call-customer-form';
import { EditCustomerForm } from './edit-customer-form';

export function EditCustomerSheet({ organizationId, customer, definitions, stages }: { organizationId: string; customer: Customer; definitions: FieldDefinition[]; stages: CustomerStage[] }) {
  const [open, setOpen] = useState(false);
  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild><Button type="button" tone="secondary"><Pencil aria-hidden /> Edit</Button></PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader><PageDrawerTitle>Edit {customer.name}</PageDrawerTitle><PageDrawerDescription>Correct contact details, custom fields, or the current sales stage.</PageDrawerDescription></PageDrawerHeader>
        <div className="px-4 pb-4"><EditCustomerForm organizationId={organizationId} customer={customer} definitions={definitions} stages={stages} onUpdated={() => setOpen(false)} /></div>
      </PageDrawerContent>
    </PageDrawer>
  );
}

export function CallCustomerSheet({ organizationId, customer }: { organizationId: string; customer: Customer }) {
  return (
    <PageDrawer>
      <PageDrawerTrigger asChild><Button type="button"><Phone aria-hidden /> Call</Button></PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader><PageDrawerTitle>Call {customer.name}</PageDrawerTitle><PageDrawerDescription>Place a provider call, or record one made outside GildOps.</PageDrawerDescription></PageDrawerHeader>
        <div className="px-4 pb-4"><CallCustomerForm organizationId={organizationId} customerId={customer.id} customerName={customer.name} phone={customer.phone} /></div>
      </PageDrawerContent>
    </PageDrawer>
  );
}
