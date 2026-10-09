'use client';

import { useId, useState, useTransition } from 'react';
import { Button } from '@/components/controls/button';
import { FormError, FormField } from '@/components/controls/form';
import { TextInput } from '@/components/controls/inputs';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerBody,
  PageDrawerClose,
  PageDrawerFooter,
  PageDrawerDescription,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import { createFormAction } from '@/app/organizations/[organizationId]/studio/forms/actions';

/**
 * Name a blank form, or the form a template is about to become. The business owns the result from
 * the moment it exists: the template contributes its starting questions and nothing after that.
 */
export function NewFormDrawer({ organizationId, templateKey, defaultName = '', triggerLabel = 'New form', triggerTone = 'primary', triggerSize = 'default', title, defaultOpen = false }: {
  organizationId: string;
  templateKey?: string;
  defaultName?: string;
  triggerLabel?: string;
  triggerTone?: 'primary' | 'secondary';
  triggerSize?: 'default' | 'small';
  title?: string;
  defaultOpen?: boolean;
}) {
  const formId = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      // On success the action redirects to the new form's builder and this never resolves with a value.
      const result = await createFormAction({ organizationId, name, templateKey });
      if (result?.error) setError(result.error);
    });
  };

  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild><Button tone={triggerTone} size={triggerSize}>{triggerLabel}</Button></PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>{title ?? (templateKey ? 'Use this template' : 'New blank form')}</PageDrawerTitle>
          <PageDrawerDescription>{templateKey ? 'Start with these questions and make them your own.' : 'Name your form, then add questions in the builder.'}</PageDrawerDescription>
        </PageDrawerHeader>
        <PageDrawerBody>
        <form
          id={formId}
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <FormField id={`${formId}-name`} label="Form name" hint="Only you see this. You can change it later.">
            {(control) => <TextInput {...control} value={name} maxLength={120} required autoFocus onChange={(event) => setName(event.target.value)} />}
          </FormField>
          <FormError>{error}</FormError>
        </form>
        </PageDrawerBody>
        <PageDrawerFooter>
          <PageDrawerClose asChild><Button tone="secondary" disabled={pending}>Cancel</Button></PageDrawerClose>
          <Button form={formId} disabled={pending || name.trim() === ''}>{pending ? 'Creating…' : 'Create form'}</Button>
        </PageDrawerFooter>
      </PageDrawerContent>
    </PageDrawer>
  );
}
