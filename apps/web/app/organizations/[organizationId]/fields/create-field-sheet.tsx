'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
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
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const label = CUSTOM_FIELD_ENTITY_LABELS[entityType];

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" size="small">
          <Plus aria-hidden className="size-4" /> New field
        </Button>
      </SheetTrigger>
      <SheetContent side={mobile ? 'bottom' : 'right'} className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>New field</SheetTitle>
          <SheetDescription>Add information recorded on {label}.</SheetDescription>
        </SheetHeader>
        <CreateFieldForm
          organizationId={organizationId}
          entityType={entityType}
          onCreated={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
