'use client';

import { useId, useRef } from 'react';
import { Button } from '@/components/controls/button';
import { Dialog } from '@/components/containers/dialog';
import { ProvisionForm } from '@/app/(platform)/platform/provision-form';

export function ProvisionOrganizationDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  return (
    <>
      <Button type="button" onClick={() => ref.current?.showModal()}>Provision organization</Button>
      <Dialog dialogRef={ref} className="w-[min(48rem,calc(100%-2rem))] p-6" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <div className="flex items-start justify-between gap-4">
          <div><h2 id={titleId} className="text-lg font-semibold">Provision organization</h2><p id={descriptionId} className="mt-1 text-sm text-muted-foreground">Create the tenant and assign its existing GOLD account owner.</p></div>
          <Button type="button" tone="secondary" size="small" onClick={() => ref.current?.close()}>Close</Button>
        </div>
        <div className="mt-6"><ProvisionForm compact /></div>
      </Dialog>
    </>
  );
}
