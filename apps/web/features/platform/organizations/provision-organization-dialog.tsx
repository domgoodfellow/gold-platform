'use client';

import { Button } from '@/components/controls/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/containers/dialog';
import { ProvisionForm } from '@/app/(platform)/platform/provision-form';

export function ProvisionOrganizationDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="small">Provision organization</Button>
      </DialogTrigger>
      <DialogContent className="w-[min(48rem,calc(100%-2rem))] max-w-none">
        <DialogHeader>
          <DialogTitle>Provision organization</DialogTitle>
          <DialogDescription>Create the tenant and assign its existing GOLD account owner.</DialogDescription>
        </DialogHeader>
        <ProvisionForm compact />
      </DialogContent>
    </Dialog>
  );
}
