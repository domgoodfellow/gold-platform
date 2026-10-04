'use client';

import { Plus, X } from 'lucide-react';
import { FORM_CHOICE_TYPES, FORM_FIELD_TYPE_LABEL, FORM_MAX_OPTIONS, newOptionValue, type FormDefinition, type FormField } from '@gold/schemas';
import { Button } from '@/components/controls/button';
import { Checkbox } from '@gold/ui/components/checkbox';
import { FieldLabel, Hint, TextArea, TextInput } from '@/components/controls/inputs';

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return <FieldLabel className="grid gap-1 text-sm">{label}{children}</FieldLabel>;
}

export function FormSettingsInspector({ definition, name, onName, onChange }: {
  definition: FormDefinition;
  name: string;
  onName: (value: string) => void;
  onChange: (next: FormDefinition) => void;
}) {
  return (
    <div className="grid gap-4">
      <h3 className="font-semibold">Form settings</h3>
      <Labelled label="Form name">
        <TextInput value={name} maxLength={120} onChange={(event) => onName(event.target.value)} />
        <Hint>Only you see this name. The public address stays the same if you change it.</Hint>
      </Labelled>
      <Labelled label="Title shown to visitors">
        <TextInput value={definition.title} maxLength={120} onChange={(event) => onChange({ ...definition, title: event.target.value })} />
      </Labelled>
      <Labelled label="Introduction">
        <TextArea rows={3} value={definition.description ?? ''} maxLength={600} onChange={(event) => onChange({ ...definition, description: event.target.value })} />
      </Labelled>
      <Labelled label="Submit button label">
        <TextInput value={definition.submitLabel} maxLength={40} onChange={(event) => onChange({ ...definition, submitLabel: event.target.value })} />
      </Labelled>
      <fieldset className="grid gap-3 border-t border-border pt-4">
        <legend className="text-sm font-medium">After a visitor submits</legend>
        <Labelled label="Confirmation title">
          <TextInput value={definition.confirmation.title} maxLength={120} onChange={(event) => onChange({ ...definition, confirmation: { ...definition.confirmation, title: event.target.value } })} />
        </Labelled>
        <Labelled label="Confirmation message">
          <TextArea rows={3} value={definition.confirmation.message} maxLength={600} onChange={(event) => onChange({ ...definition, confirmation: { ...definition.confirmation, message: event.target.value } })} />
        </Labelled>
      </fieldset>
    </div>
  );
}

function numberOrUndefined(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function FieldInspector({ field, onChange }: { field: FormField; onChange: (next: FormField) => void }) {
  const set = (patch: Record<string, unknown>) => onChange({ ...field, ...patch } as FormField);
  const hasPlaceholder = field.type !== 'radio' && field.type !== 'checkbox' && field.type !== 'consent';

  return (
    <div className="grid gap-4">
      <div>
        <h3 className="font-semibold">{FORM_FIELD_TYPE_LABEL[field.type]}</h3>
        <p className="font-mono text-xs text-subtle">{field.id}</p>
      </div>
      <Labelled label={field.type === 'consent' ? 'Statement' : 'Question'}>
        <TextInput value={field.label} maxLength={160} onChange={(event) => set({ label: event.target.value })} />
      </Labelled>
      <Labelled label="Help text">
        <TextInput value={field.description ?? ''} maxLength={300} onChange={(event) => set({ description: event.target.value })} />
      </Labelled>
      {hasPlaceholder ? (
        <Labelled label="Placeholder">
          <TextInput value={field.placeholder ?? ''} maxLength={120} onChange={(event) => set({ placeholder: event.target.value })} />
        </Labelled>
      ) : null}
      <CheckboxFieldControlled id={`required-${field.id}`} label="Required" checked={field.required === true} onChange={(checked) => set({ required: checked })} />

      {field.type === 'short_text' || field.type === 'long_text' ? (
        <Labelled label="Longest answer (characters)">
          <TextInput type="number" min={1} max={4000} value={field.maxLength ?? ''} onChange={(event) => set({ maxLength: numberOrUndefined(event.target.value) })} />
        </Labelled>
      ) : null}

      {field.type === 'number' ? (
        <div className="grid grid-cols-2 gap-3">
          <Labelled label="Smallest">
            <TextInput type="number" value={field.min ?? ''} onChange={(event) => set({ min: numberOrUndefined(event.target.value) })} />
          </Labelled>
          <Labelled label="Largest">
            <TextInput type="number" value={field.max ?? ''} onChange={(event) => set({ max: numberOrUndefined(event.target.value) })} />
          </Labelled>
        </div>
      ) : null}

      {FORM_CHOICE_TYPES.includes(field.type) && 'options' in field ? (
        <fieldset className="grid gap-2 border-t border-border pt-4">
          <legend className="text-sm font-medium">Choices</legend>
          {field.options.map((option, index) => (
            <div key={option.value} className="flex items-center gap-1">
              <TextInput
                aria-label={`Choice ${index + 1}`}
                value={option.label}
                maxLength={120}
                onChange={(event) => set({ options: field.options.map((entry, i) => (i === index ? { ...entry, label: event.target.value } : entry)) })}
              />
              <Button type="button" tone="text" size="tiny" disabled={field.options.length <= 1} aria-label={`Remove choice ${index + 1}`} onClick={() => set({ options: field.options.filter((_, i) => i !== index) })}>
                <X aria-hidden className="size-3.5" />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              tone="secondary"
              size="small"
              disabled={field.options.length >= FORM_MAX_OPTIONS}
              onClick={() => {
                const label = `Choice ${field.options.length + 1}`;
                set({ options: [...field.options, { value: newOptionValue(label, new Set(field.options.map((entry) => entry.value))), label }] });
              }}
            >
              <Plus aria-hidden className="size-3.5" /> Add choice
            </Button>
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}

/** `CheckboxField` is uncontrolled and form-bound; the builder's inspector edits state, not a form. */
function CheckboxFieldControlled({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(next) => onChange(next === true)} />
      <FieldLabel htmlFor={id} className="font-normal">{label}</FieldLabel>
    </div>
  );
}
