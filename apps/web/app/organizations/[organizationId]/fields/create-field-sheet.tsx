'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/controls/button';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerDescription,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/containers/page-drawer';
import {
  CUSTOM_FIELD_ENTITY_LABELS,
  type CustomFieldEntity,
} from '@/lib/domain/fields/field-definitions';
import { CreateFieldForm } from './create-field-form';

/** One bounded creation surface, scoped to its host entity. */
export function CreateFieldSheet({
  organizationId,
  entityType,
}: {
  organizationId: string;
  entityType: CustomFieldEntity;
}) {
  const [open, setOpen] = useState(false);
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
          onCreated={() => setOpen(false)}
        />
      </PageDrawerContent>
    </PageDrawer>
  );
}
