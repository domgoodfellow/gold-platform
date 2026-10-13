'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { PageDrawer, PageDrawerContent, PageDrawerHeader, PageDrawerTitle, PageDrawerTrigger } from '@/components/panels/page-drawer';
import { CreateTypeForm } from './work-config-forms';

/**
 * Creating a kind of work is its own task, apart from editing one. On success the person lands on
 * the new type's Workflow tab — a type with no stages cannot hold work, so that is the next step.
 */
export function NewTypeDrawer({
  organizationId,
  typeHrefPrefix,
  defaultOpen = false,
}: {
  organizationId: string;
  /** A type's address up to and including `type=`; the new type's id is appended. A function cannot cross from a server page. */
  typeHrefPrefix: string;
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild>
        <Button size="small" tone="secondary">
          <Plus size={16} aria-hidden />
          New type
        </Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>New work type</PageDrawerTitle>
        </PageDrawerHeader>
        <CreateTypeForm
          organizationId={organizationId}
          onCreated={(typeId) => {
            setOpen(false);
            router.push(`${typeHrefPrefix}${typeId}&tab=workflow`);
          }}
        />
      </PageDrawerContent>
    </PageDrawer>
  );
}
