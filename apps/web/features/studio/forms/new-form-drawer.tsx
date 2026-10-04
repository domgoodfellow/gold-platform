'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/controls/button';
import { FormActions, FormError, FormField } from '@/components/controls/form';
import { TextInput } from '@/components/controls/inputs';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import { createFormAction } from '@/app/organizations/[organizationId]/studio/forms/actions';

/**
 * Name a blank form, or the form a template is about to become. The business owns the result from
 * the moment it exists: the template contributes its starting questions and nothing after that.
 */
export function NewFormDrawer({ organizationId, templateKey, defaultName = '', triggerLabel = 'New form', triggerTone = 'primary', triggerSize = 'default', title }: {
  organizationId: string;
  templateKey?: string;
  defaultName?: string;
  triggerLabel?: string;
  triggerTone?: 'primary' | 'secondary';
  triggerSize?: 'default' | 'small';
  title?: string;
}) {
  const [open, setOpen] = useState(false);
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
        <PageDrawerHeader><PageDrawerTitle>{title ?? (templateKey ? 'Use this template' : 'New blank form')}</PageDrawerTitle></PageDrawerHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <FormField id={`new-form-name-${templateKey ?? 'blank'}`} label="Form name" hint="Only you see this. You can change it later.">
            {(control) => <TextInput {...control} value={name} maxLength={120} required autoFocus onChange={(event) => setName(event.target.value)} />}
          </FormField>
          <FormError>{error}</FormError>
          <FormActions>
            <Button disabled={pending || name.trim() === ''}>{pending ? 'Creating…' : 'Create form'}</Button>
          </FormActions>
        </form>
      </PageDrawerContent>
    </PageDrawer>
  );
}
