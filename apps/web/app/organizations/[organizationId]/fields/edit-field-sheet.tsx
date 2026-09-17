'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
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
  FIELD_KIND_LABELS,
  type FieldDefinition,
} from '@/lib/domain/fields/field-definitions';
import { EditFieldForm } from './create-field-form';

/** Identity is metadata, never a disabled control: key, kind and entity cannot be changed. */
export function EditFieldSheet({
  organizationId,
  definition,
}: {
  organizationId: string;
  definition: FieldDefinition;
}) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" tone="secondary" size="small" aria-label={`Edit ${definition.label}`}>
          <Pencil aria-hidden className="size-4" /> Edit
        </Button>
      </SheetTrigger>
      <SheetContent side={mobile ? 'bottom' : 'right'} className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Edit {definition.label}</SheetTitle>
          <SheetDescription>Change how this field appears; its identity stays fixed.</SheetDescription>
        </SheetHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-4 pb-4 text-sm">
          <dt className="text-subtle">Key</dt><dd><code>{definition.key}</code></dd>
          <dt className="text-subtle">Type</dt><dd>{FIELD_KIND_LABELS[definition.kind]}</dd>
          <dt className="text-subtle">Applies to</dt><dd>{CUSTOM_FIELD_ENTITY_LABELS[definition.entityType]}</dd>
        </dl>
        <EditFieldForm
          organizationId={organizationId}
          definition={definition}
          onUpdated={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
