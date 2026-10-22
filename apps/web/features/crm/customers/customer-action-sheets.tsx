'use client';

import { useState } from 'react';
import { Pencil, Phone } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { PageDrawer, PageDrawerContent, PageDrawerDescription, PageDrawerHeader, PageDrawerTitle, PageDrawerTrigger } from '@/components/panels/page-drawer';
import type { Contact } from '@/lib/domain/contacts/contacts';
import type { CustomerStage } from '@/lib/domain/customers/stages';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { CallCustomerForm } from '@/features/communications/voice/call-customer-form';
import { EditCustomerForm } from './edit-customer-form';

export function EditCustomerSheet({ organizationId, customer, definitions, stages }: { organizationId: string; customer: Contact; definitions: FieldDefinition[]; stages: CustomerStage[] }) {
  const [open, setOpen] = useState(false);
  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild><Button type="button" tone="secondary"><Pencil aria-hidden /> Edit</Button></PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader><PageDrawerTitle>Edit {customer.name}</PageDrawerTitle><PageDrawerDescription>Edit contact details, lifecycle, temperature, custom fields, or the relationship stage.</PageDrawerDescription></PageDrawerHeader>
        <div><EditCustomerForm organizationId={organizationId} customer={customer} definitions={definitions} stages={stages} onUpdated={() => setOpen(false)} /></div>
      </PageDrawerContent>
    </PageDrawer>
  );
}

export function CallCustomerSheet({ organizationId, customer }: { organizationId: string; customer: Contact }) {
  return (
    <PageDrawer>
      <PageDrawerTrigger asChild><Button type="button"><Phone aria-hidden /> Call</Button></PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader><PageDrawerTitle>Call {customer.name}</PageDrawerTitle><PageDrawerDescription>Place a provider call, or record one made outside GildOps.</PageDrawerDescription></PageDrawerHeader>
        <div><CallCustomerForm organizationId={organizationId} customerId={customer.id} customerName={customer.name} phone={customer.phone} /></div>
      </PageDrawerContent>
    </PageDrawer>
  );
}
