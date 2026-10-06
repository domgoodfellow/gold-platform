'use client';

import { useState } from 'react';
import type { SectionKind, SectionPattern, WebsiteSection } from '@gold/schemas';
import { Button } from '@/components/controls/button';
import { FieldLabel, Hint, SelectInput } from '@/components/controls/inputs';
import { GroupHeading } from '@/components/surfaces/section';
import {
  PageDrawer, PageDrawerContent, PageDrawerDescription, PageDrawerHeader, PageDrawerTitle,
} from '@/components/panels/page-drawer';
import { newId, sectionFromPattern } from '@/lib/domain/public-site/composition';
import { SECTION_GROUPS, SECTION_REGISTRY, type SectionGroup } from '@/lib/domain/public-site/section-registry';
import type { FormOption } from './types';

type Choice = { key: string; name: string; description: string; make: () => WebsiteSection };

function ChoiceRow({ choice, onAdd }: { choice: Choice; onAdd: (section: WebsiteSection) => void }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3">
      <div className="min-w-0">
        <p className="font-medium">{choice.name}</p>
        <p className="text-sm text-muted">{choice.description}</p>
      </div>
      <Button type="button" tone="secondary" size="small" aria-label={`Add ${choice.name}`} onClick={() => onAdd(choice.make())}>Add</Button>
    </li>
  );
}

function FormChoice({ forms, onAdd }: { forms: FormOption[]; onAdd: (section: WebsiteSection) => void }) {
  const definition = SECTION_REGISTRY.form;
  const [formId, setFormId] = useState('');
  if (forms.length === 0) {
    return <Hint className="py-3">Create a form in Studio to place it on a page.</Hint>;
  }
  const chosen = forms.find((form) => form.id === formId);
  return (
    <div className="grid gap-2 py-3">
      <p className="font-medium">{definition.label}</p>
      <p className="text-sm text-muted">{definition.description}</p>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
        <FieldLabel className="grid gap-1 text-xs">
          Form
          <SelectInput size="small" value={formId} onChange={(event) => setFormId(event.target.value)}>
            <option value="">Choose a form…</option>
            {forms.map((form) => <option key={form.id} value={form.id}>{form.name}{form.published ? '' : ' (not published)'}</option>)}
          </SelectInput>
        </FieldLabel>
        <Button
          type="button" tone="secondary" size="small" disabled={!chosen} aria-label="Add form section"
          onClick={() => { if (chosen) onAdd(definition.create(newId(), { formId: chosen.id, name: chosen.name })); }}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

/**
 * The section chooser. Every entry comes from the section registry — a blank section of each
 * registered kind — and from the platform's section patterns, which become real sections of a
 * registered kind with nothing left pointing back at the pattern. There is no second hand-kept list.
 */
export function SectionLibrary({ open, onOpenChange, forms, patterns, onAdd }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  forms: FormOption[];
  patterns: SectionPattern[];
  onAdd: (section: WebsiteSection) => void;
}) {
  const kinds = Object.keys(SECTION_REGISTRY) as SectionKind[];
  const choicesIn = (group: SectionGroup): Choice[] => [
    ...kinds
      .filter((kind) => SECTION_REGISTRY[kind].group === group && !SECTION_REGISTRY[kind].reference)
      .map((kind) => {
        const definition = SECTION_REGISTRY[kind];
        return { key: `kind:${kind}`, name: definition.label, description: definition.description, make: () => definition.create(newId()) };
      }),
    ...patterns
      .filter((pattern) => SECTION_REGISTRY[pattern.kind].group === group)
      .map((pattern) => ({ key: `pattern:${pattern.key}`, name: pattern.name, description: pattern.description, make: () => sectionFromPattern(pattern) })),
  ];

  return (
    <PageDrawer open={open} onOpenChange={onOpenChange}>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>Add section</PageDrawerTitle>
          <PageDrawerDescription>Sections are added to the end of the current page. Move them from the structure.</PageDrawerDescription>
        </PageDrawerHeader>
        <div className="grid gap-6">
          {SECTION_GROUPS.map((group) => {
            const choices = choicesIn(group);
            const hasForm = group === 'Forms';
            if (choices.length === 0 && !hasForm) return null;
            return (
              <section key={group} aria-label={group}>
                <GroupHeading>{group}</GroupHeading>
                <ul className="divide-y divide-border">
                  {choices.map((choice) => <ChoiceRow key={choice.key} choice={choice} onAdd={onAdd} />)}
                </ul>
                {hasForm ? <FormChoice forms={forms} onAdd={onAdd} /> : null}
              </section>
            );
          })}
        </div>
      </PageDrawerContent>
    </PageDrawer>
  );
}
