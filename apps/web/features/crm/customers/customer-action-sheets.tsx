'use client';

import { Phone } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { PageDrawer, PageDrawerContent, PageDrawerDescription, PageDrawerHeader, PageDrawerTitle, PageDrawerTrigger } from '@/components/panels/page-drawer';
import type { Contact } from '@/lib/domain/contacts/contacts';
import { CallCustomerForm } from '@/features/communications/voice/call-customer-form';

// Editing moved to EditContactDialog (V1.4). Calling keeps its contextual drawer.
export function CallCustomerSheet({ organizationId, customer }: { organizationId: string; customer: Contact }) {
  return (
    <PageDrawer>
      <PageDrawerTrigger asChild><Button type="button"><Phone aria-hidden /> Call</Button></PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader><PageDrawerTitle>Call {customer.name}</PageDrawerTitle><PageDrawerDescription>Call from GildOps, or log a call made elsewhere.</PageDrawerDescription></PageDrawerHeader>
        <div><CallCustomerForm organizationId={organizationId} customerId={customer.id} customerName={customer.name} phone={customer.phone} /></div>
      </PageDrawerContent>
    </PageDrawer>
  );
}
