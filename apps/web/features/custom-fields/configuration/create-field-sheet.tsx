'use client';

import { useId, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/controls/button';
import {
  PageDrawer,
  PageDrawerClose,
  PageDrawerContent,
  PageDrawerDescription,
  PageDrawerFooter,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import {
  CUSTOM_FIELD_ENTITY_LABELS,
  type CustomFieldEntity,
} from '@/lib/domain/fields/field-definitions';
import { CreateFieldForm } from './field-form';

/** One bounded creation surface, scoped to its host entity. Its actions stay in the footer. */
export function CreateFieldSheet({
  organizationId,
  entityType,
}: {
  organizationId: string;
  entityType: CustomFieldEntity;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const formId = useId();
  const label = CUSTOM_FIELD_ENTITY_LABELS[entityType];

  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild>
        <Button type="button" size="small">
          <Plus aria-hidden className="size-4" /> New field
        </Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>New field</PageDrawerTitle>
          <PageDrawerDescription>Add information recorded on {label}.</PageDrawerDescription>
        </PageDrawerHeader>
        <CreateFieldForm
          organizationId={organizationId}
          entityType={entityType}
          formId={formId}
          onCreated={() => setOpen(false)}
          onPendingChange={setPending}
        />
        <PageDrawerFooter>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? 'Adding…' : 'Add field'}
          </Button>
          <PageDrawerClose asChild>
            <Button type="button" tone="secondary">Cancel</Button>
          </PageDrawerClose>
        </PageDrawerFooter>
      </PageDrawerContent>
    </PageDrawer>
  );
}
