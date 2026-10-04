'use client';

import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { FORM_FIELD_TYPES, FORM_FIELD_TYPE_LABEL, FORM_MAX_FIELDS, type FormDefinition, type FormFieldType } from '@gold/schemas';
import { Button } from '@/components/controls/button';
import { cx, FOCUS_RING } from '@/components/class-names';

export type FormSelection = 'form' | string;

/**
 * The form's questions in order, with the one control set that changes that order. Moving a field
 * is two buttons per row — a keyboard reaches every position, and nothing here is drag-only. The
 * list holds identity (each row is a field id); the label shown is only the author's current copy.
 */
export function FormStructure({ definition, selected, disabled, onSelect, onAdd, onMove, onRemove }: {
  definition: FormDefinition;
  selected: FormSelection;
  disabled?: boolean;
  onSelect: (selection: FormSelection) => void;
  onAdd: (type: FormFieldType) => void;
  onMove: (fieldId: string, delta: -1 | 1) => void;
  onRemove: (fieldId: string) => void;
}) {
  const full = definition.fields.length >= FORM_MAX_FIELDS;
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Form structure" className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => onSelect('form')}
          aria-current={selected === 'form' ? 'true' : undefined}
          className={cx('rounded-md px-2 py-1.5 text-left text-sm font-medium transition', FOCUS_RING, selected === 'form' ? 'bg-secondary' : 'hover:bg-secondary')}
        >
          Form settings
        </button>
        {definition.fields.length === 0 ? <p className="px-2 py-1 text-sm text-muted">No questions yet. Add one below.</p> : null}
        <ol className="flex flex-col gap-1">
          {definition.fields.map((field, index) => (
            <li key={field.id} className={cx('flex items-center gap-1 rounded-md', selected === field.id && 'bg-secondary')}>
              <button
                type="button"
                onClick={() => onSelect(field.id)}
                aria-current={selected === field.id ? 'true' : undefined}
                className={cx('min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-sm transition', FOCUS_RING, selected !== field.id && 'hover:bg-secondary')}
              >
                <span className="block truncate font-medium">{field.label}</span>
                <span className="block text-xs text-subtle">{FORM_FIELD_TYPE_LABEL[field.type]}{field.required ? ' · required' : ''}</span>
              </button>
              <Button type="button" tone="text" size="tiny" disabled={disabled || index === 0} aria-label={`Move “${field.label}” up`} onClick={() => onMove(field.id, -1)}><ArrowUp aria-hidden className="size-3.5" /></Button>
              <Button type="button" tone="text" size="tiny" disabled={disabled || index === definition.fields.length - 1} aria-label={`Move “${field.label}” down`} onClick={() => onMove(field.id, 1)}><ArrowDown aria-hidden className="size-3.5" /></Button>
              <Button type="button" tone="text" size="tiny" disabled={disabled} aria-label={`Remove “${field.label}”`} onClick={() => onRemove(field.id)}><Trash2 aria-hidden className="size-3.5" /></Button>
            </li>
          ))}
        </ol>
      </nav>

      <div role="group" aria-label="Add a question" className="flex flex-col gap-1 border-t border-border pt-3">
        <p className="px-2 text-xs uppercase tracking-wide text-subtle">Add a question</p>
        <div className="flex flex-wrap gap-1.5 px-1">
          {FORM_FIELD_TYPES.map((type) => (
            <Button key={type} type="button" tone="secondary" size="tiny" disabled={disabled || full} onClick={() => onAdd(type)}>
              {FORM_FIELD_TYPE_LABEL[type]}
            </Button>
          ))}
        </div>
        {full ? <p className="px-2 text-xs text-muted">A form can have up to {FORM_MAX_FIELDS} questions.</p> : null}
      </div>
    </div>
  );
}
