'use client';

import type { PublicHomepageSections } from '@gold/schemas';
import { Button } from '@/components/controls/button';
import { cx, FOCUS_RING } from '@/components/class-names';
import type { FormOption } from './website-editing';

const SECTION_LABEL: Record<PublicHomepageSections[number]['kind'], string> = {
  hero: 'Hero',
  problem: 'Problem',
  capabilities: 'Capabilities',
  process: 'Process',
  trust: 'Trust',
  cta: 'Closing action',
  form: 'Form',
};

export type StructureSelection = 'page' | PublicHomepageSections[number]['kind'];

/**
 * Page, then the six sections in the schema's own fixed order (never reordered, added to or
 * removed here — that is a future work order, not this one). Selecting an entry identifies it
 * here, highlights it in Canvas and populates Inspector: one selection, three panes.
 */
export function WebsiteStructure({ sections, selected, onSelect, forms, disabled, onAddForm, onRemoveForm }: {
  sections: PublicHomepageSections;
  selected: StructureSelection;
  onSelect: (selection: StructureSelection) => void;
  /** Forms the business could place; the form section is the one section that can be added or removed. */
  forms: FormOption[];
  disabled?: boolean;
  onAddForm: (form: FormOption) => void;
  onRemoveForm: () => void;
}) {
  const hasForm = sections.some((section) => section.kind === 'form');
  const rows: { key: StructureSelection; label: string }[] = [
    { key: 'page', label: 'Page' },
    ...sections.map((section) => ({ key: section.kind, label: SECTION_LABEL[section.kind] })),
  ];

  return (
    <nav aria-label="Website structure" className="flex flex-col gap-1">
      {rows.map((row) => (
        <button
          key={row.key}
          type="button"
          onClick={() => onSelect(row.key)}
          aria-current={selected === row.key ? 'true' : undefined}
          className={cx(
            'rounded px-2.5 py-2 text-left text-sm transition',
            FOCUS_RING,
            selected === row.key ? 'bg-foreground font-medium text-background' : 'text-muted hover:bg-secondary hover:text-foreground',
          )}
        >
          {row.label}
        </button>
      ))}
      <div className="mt-3 border-t border-border pt-3">
        {hasForm ? (
          <Button type="button" tone="secondary" size="small" disabled={disabled} onClick={onRemoveForm}>Remove form section</Button>
        ) : forms.length === 0 ? (
          <p className="text-xs text-muted">Create a form in Studio to place it here.</p>
        ) : (
          <label className="grid gap-1 text-xs text-muted">
            Add a form
            <select
              className="h-8 rounded-md border border-input bg-transparent px-2 text-sm text-foreground"
              disabled={disabled}
              value=""
              onChange={(event) => {
                const form = forms.find((candidate) => candidate.id === event.target.value);
                if (form) onAddForm(form);
              }}
            >
              <option value="">Choose a form…</option>
              {forms.map((form) => <option key={form.id} value={form.id}>{form.name}{form.published ? '' : ' (not published)'}</option>)}
            </select>
          </label>
        )}
      </div>
    </nav>
  );
}
