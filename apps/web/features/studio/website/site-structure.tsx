'use client';

import { useState } from 'react';
import type { PageTemplate, WebsiteContent } from '@gold/schemas';
import { Button } from '@/components/controls/button';
import { FieldLabel, Hint, TextInput } from '@/components/controls/inputs';
import { cx, FOCUS_RING } from '@/components/class-names';
import { sectionLabel } from '@/lib/domain/public-site/section-registry';
import { pagePath } from '@/lib/domain/public-site/paths';
import type { Selection } from './types';
import { SelectField } from '@/components/controls/select-field';

/** An icon-less text button small enough to sit on a row; the label is the name a screen reader gets. */
function RowButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cx('rounded px-1.5 py-0.5 text-xs text-muted transition hover:bg-secondary hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent', FOCUS_RING)}
    >
      {children}
    </button>
  );
}

/** Adding a page: blank, or a copy of a page template. Either way it is the business's own page from then on. */
function AddPage({ templates, disabled, onAdd }: { templates: PageTemplate[]; disabled: boolean; onAdd: (name: string, templateKey: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [templateKey, setTemplateKey] = useState('');

  if (!open) {
    return <Button type="button" tone="secondary" size="small" disabled={disabled} onClick={() => setOpen(true)}>Add page</Button>;
  }
  const submit = () => {
    const chosen = templates.find((template) => template.key === templateKey);
    onAdd(name.trim() || chosen?.page.name || 'New page', templateKey || null);
    setOpen(false); setName(''); setTemplateKey('');
  };
  return (
    <div className="grid gap-3 rounded-md border border-border p-3">
      <FieldLabel className="grid gap-1 text-xs">
        Page name
        <TextInput size="small" value={name} onChange={(event) => setName(event.target.value)} />
      </FieldLabel>
      <FieldLabel className="grid gap-1 text-xs">
        Start from
        <SelectField size="small" value={templateKey} onValueChange={(next) => setTemplateKey(next)} options={[{ value: '', label: 'A blank page' }, ...templates.map((template) => ({ value: template.key, label: template.name }))]} />
      </FieldLabel>
      <div className="flex gap-2">
        <Button type="button" size="small" onClick={submit}>Add page</Button>
        <Button type="button" tone="secondary" size="small" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

/**
 * The website as a tree: its pages, and under the current page its sections in order. Selecting a
 * page shows it in Canvas; selecting a section populates Inspector. Every row has buttons for what
 * it can do — move, duplicate, remove — because dragging is never the only way to reorder.
 */
export function SiteStructure({
  content, pageId, selected, disabled, pageTemplates,
  onSelectPage, onSelect, onAddPage, onAddSection, onMoveSection, onDuplicateSection, onRemoveSection,
}: {
  content: WebsiteContent;
  pageId: string;
  selected: Selection;
  disabled?: boolean;
  pageTemplates: PageTemplate[];
  onSelectPage: (pageId: string) => void;
  onSelect: (selection: Selection) => void;
  onAddPage: (name: string, templateKey: string | null) => void;
  onAddSection: () => void;
  onMoveSection: (sectionId: string, direction: 'up' | 'down') => void;
  onDuplicateSection: (sectionId: string) => void;
  onRemoveSection: (sectionId: string) => void;
}) {
  return (
    <nav aria-label="Website structure" className="flex flex-col gap-1">
      <ul className="flex flex-col gap-1">
        {content.pages.map((page) => {
          const current = page.id === pageId;
          return (
            <li key={page.id}>
              <button
                type="button"
                onClick={() => { onSelectPage(page.id); onSelect('page'); }}
                aria-current={current ? 'page' : undefined}
                className={cx(
                  'flex w-full items-baseline justify-between gap-2 rounded px-2.5 py-2 text-left text-sm transition',
                  FOCUS_RING,
                  current && selected === 'page' ? 'bg-foreground font-medium text-background' : current ? 'bg-secondary font-medium' : 'text-muted hover:bg-secondary hover:text-foreground',
                )}
              >
                <span className="truncate">{page.name}</span>
                <span className="shrink-0 font-mono text-xs opacity-70">{pagePath(page)}</span>
              </button>
              {current ? (
                <ol aria-label={`Sections of ${page.name}`} className="ml-3 mt-1 flex flex-col gap-0.5 border-l border-border pl-2">
                  {page.sections.length === 0 ? <li className="px-2 py-1 text-xs text-subtle">No sections yet</li> : null}
                  {page.sections.map((section, index) => {
                    const isSelected = selected !== 'page' && selected.sectionId === section.id;
                    return (
                      <li key={section.id} className={cx('flex items-center justify-between gap-1 rounded', isSelected && 'bg-secondary')}>
                        <button
                          type="button"
                          onClick={() => onSelect({ sectionId: section.id })}
                          aria-current={isSelected ? 'true' : undefined}
                          className={cx('min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left text-sm', FOCUS_RING, isSelected ? 'font-medium' : 'text-muted hover:text-foreground')}
                        >
                          {sectionLabel(section.kind)}
                        </button>
                        <span className="flex shrink-0">
                          <RowButton label={`Move ${sectionLabel(section.kind)} up`} disabled={disabled || index === 0} onClick={() => onMoveSection(section.id, 'up')}>↑</RowButton>
                          <RowButton label={`Move ${sectionLabel(section.kind)} down`} disabled={disabled || index === page.sections.length - 1} onClick={() => onMoveSection(section.id, 'down')}>↓</RowButton>
                          <RowButton label={`Duplicate ${sectionLabel(section.kind)}`} disabled={disabled} onClick={() => onDuplicateSection(section.id)}>⧉</RowButton>
                          <RowButton label={`Remove ${sectionLabel(section.kind)}`} disabled={disabled} onClick={() => onRemoveSection(section.id)}>✕</RowButton>
                        </span>
                      </li>
                    );
                  })}
                  <li className="px-1 pt-1">
                    <Button type="button" tone="secondary" size="small" disabled={disabled} onClick={onAddSection}>Add section</Button>
                  </li>
                </ol>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="mt-3 border-t border-border pt-3">
        <AddPage templates={pageTemplates} disabled={!!disabled} onAdd={onAddPage} />
        {disabled ? <Hint className="mt-2 text-xs">Read-only while in review.</Hint> : null}
      </div>
    </nav>
  );
}
