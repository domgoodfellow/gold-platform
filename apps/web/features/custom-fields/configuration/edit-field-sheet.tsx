'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/controls/button';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerDescription,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import {
  CUSTOM_FIELD_ENTITY_LABELS,
  FIELD_KIND_LABELS,
  type FieldDefinition,
} from '@/lib/domain/fields/field-definitions';
import { EditFieldForm } from './field-form';

/** Identity is metadata, never a disabled control: key, kind and entity cannot be changed. */
export function EditFieldSheet({
  organizationId,
  definition,
}: {
  organizationId: string;
  definition: FieldDefinition;
}) {
  const [open, setOpen] = useState(false);

  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild>
        <Button type="button" tone="secondary" size="small" aria-label={`Edit ${definition.label}`}>
          <Pencil aria-hidden className="size-4" /> Edit
        </Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>Edit {definition.label}</PageDrawerTitle>
          <PageDrawerDescription>Change how this field appears; its identity stays fixed.</PageDrawerDescription>
        </PageDrawerHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-subtle">Key</dt><dd><code>{definition.key}</code></dd>
          <dt className="text-subtle">Type</dt><dd>{FIELD_KIND_LABELS[definition.kind]}</dd>
          <dt className="text-subtle">Applies to</dt><dd>{CUSTOM_FIELD_ENTITY_LABELS[definition.entityType]}</dd>
        </dl>
        <EditFieldForm
          organizationId={organizationId}
          definition={definition}
          onUpdated={() => setOpen(false)}
        />
      </PageDrawerContent>
    </PageDrawer>
  );
}
