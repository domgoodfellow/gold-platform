'use client';

import { useState } from 'react';
import { Button } from '@/components/controls/button';
import { DividedList, GroupHeading } from '@/components/surfaces/section';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import { FormRenderer, type FormValues } from '@/features/forms/form-renderer';
import type { FormTemplate } from '@/lib/domain/forms/forms';
import { NewFormDrawer } from './new-form-drawer';

function PreviewButton({ template, organizationId }: { template: FormTemplate; organizationId: string }) {
  const [values, setValues] = useState<FormValues>({});
  return (
    <PageDrawer>
      <PageDrawerTrigger asChild><Button tone="secondary" size="small" aria-label={`Preview ${template.name}`}>Preview</Button></PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader><PageDrawerTitle>{template.name}</PageDrawerTitle></PageDrawerHeader>
        <div className="grid gap-5">
          <FormRenderer definition={template.definition} values={values} onChange={(id, value) => setValues((current) => ({ ...current, [id]: value }))} />
          <div className="border-t border-border pt-4">
            <NewFormDrawer organizationId={organizationId} templateKey={template.key} defaultName={template.name} triggerLabel="Use template" />
          </div>
        </div>
      </PageDrawerContent>
    </PageDrawer>
  );
}

/**
 * Platform starters for forms, by category. A template is a way to begin: using one makes a new
 * form the business owns outright, and nothing a later edit to the starter does reaches it.
 */
export function TemplateList({ organizationId, templates }: { organizationId: string; templates: FormTemplate[] }) {
  const categories = [...new Set(templates.map((template) => template.category))];
  return (
    <div className="grid gap-8">
      {categories.map((category) => (
        <section key={category} aria-label={category}>
          <GroupHeading>{category}</GroupHeading>
          <DividedList className="mt-2 text-sm">
            {templates.filter((template) => template.category === category).map((template) => (
              <li key={template.key} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
                <div className="min-w-0">
                  <p className="font-medium">{template.name}</p>
                  <p className="text-muted">{template.description}</p>
                  <p className="text-xs text-subtle">Form · {template.definition.fields.length} questions</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <PreviewButton template={template} organizationId={organizationId} />
                  <NewFormDrawer organizationId={organizationId} templateKey={template.key} defaultName={template.name} triggerLabel="Use template" triggerTone="secondary" triggerSize="small" />
                </div>
              </li>
            ))}
          </DividedList>
        </section>
      ))}
    </div>
  );
}
