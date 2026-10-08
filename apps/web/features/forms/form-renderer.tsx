'use client';

import { useId, type ReactNode } from 'react';
import type { FormDefinition, FormField as FormFieldDefinition } from '@gold/schemas';
import { Checkbox } from '@gold/ui/components/checkbox';
import { Button } from '@/components/controls/button';
import { FormField } from '@/components/controls/form';
import { FieldLabel, Hint, ErrorText, SelectInput, TextArea, TextInput } from '@/components/controls/inputs';
import { cx } from '@/components/class-names';

/**
 * The one place a form definition becomes fields on a screen. The Studio builder's preview and the
 * hosted public form both render through this, so what an author previews is what a visitor gets.
 * It is controlled and knows nothing about where answers go: the caller owns the values, the
 * errors and what Submit does.
 */

export type FormValues = Record<string, string | boolean | string[]>;
export type FormErrors = Record<string, string | undefined>;

type FieldProps = {
  field: FormFieldDefinition;
  id: string;
  value: string | boolean | string[] | undefined;
  error?: string;
  disabled?: boolean;
  onChange: (value: string | boolean | string[]) => void;
};

function ChoiceGroup({ field, id, value, error, disabled, onChange }: FieldProps & { field: Extract<FormFieldDefinition, { type: 'radio' | 'checkbox' }> }) {
  const hintId = field.description ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const selected = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [];
  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
      aria-invalid={error ? true : undefined}
      disabled={disabled}
    >
      <legend className="mb-1 text-sm font-medium leading-snug">
        {field.label}
        {field.required ? null : <span className="ml-1 font-normal text-subtle">(optional)</span>}
      </legend>
      {field.description ? <Hint id={hintId}>{field.description}</Hint> : null}
      {field.options.map((option, index) => {
        const optionId = `${id}-${index}`;
        const checked = selected.includes(option.value);
        return (
          <div key={option.value} className="flex items-center gap-2">
            {field.type === 'radio' ? (
              <input
                id={optionId}
                type="radio"
                name={id}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="size-4 accent-[var(--accent)]"
              />
            ) : (
              <Checkbox
                id={optionId}
                checked={checked}
                onCheckedChange={(next) => onChange(next === true ? [...selected, option.value] : selected.filter((item) => item !== option.value))}
              />
            )}
            <FieldLabel htmlFor={optionId} className="font-normal">{option.label}</FieldLabel>
          </div>
        );
      })}
      <ErrorText id={errorId}>{error}</ErrorText>
    </fieldset>
  );
}

function RenderedField({ field, id, value, error, disabled, onChange }: FieldProps) {
  if (field.type === 'radio' || field.type === 'checkbox') {
    return <ChoiceGroup field={field} id={id} value={value} error={error} disabled={disabled} onChange={onChange} />;
  }

  if (field.type === 'consent') {
    const errorId = error ? `${id}-error` : undefined;
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-start gap-2">
          <Checkbox
            id={id}
            checked={value === true}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            onCheckedChange={(next) => onChange(next === true)}
            className="mt-0.5"
          />
          <FieldLabel htmlFor={id} className="font-normal leading-snug">
            {field.label}
            {field.required ? null : <span className="ml-1 text-subtle">(optional)</span>}
          </FieldLabel>
        </div>
        {field.description ? <Hint>{field.description}</Hint> : null}
        <ErrorText id={errorId}>{error}</ErrorText>
      </div>
    );
  }

  const text = typeof value === 'string' ? value : '';
  return (
    <FormField id={id} label={field.label} hint={field.description} error={error} optional={!field.required}>
      {(control) => {
        switch (field.type) {
          case 'long_text':
            return <TextArea {...control} value={text} disabled={disabled} placeholder={field.placeholder} maxLength={field.maxLength ?? 4000} onChange={(event) => onChange(event.target.value)} rows={4} />;
          case 'select':
            return (
              <SelectInput {...control} value={text} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
                <option value="">{field.placeholder || 'Choose…'}</option>
                {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </SelectInput>
            );
          default: {
            const type = field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';
            return (
              <TextInput
                {...control}
                type={type}
                inputMode={field.type === 'number' ? 'decimal' : undefined}
                value={text}
                disabled={disabled}
                placeholder={field.placeholder}
                min={field.type === 'number' ? field.min : undefined}
                max={field.type === 'number' ? field.max : undefined}
                step={field.type === 'number' ? 'any' : undefined}
                maxLength={field.type === 'short_text' ? field.maxLength ?? 500 : undefined}
                autoComplete={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : undefined}
                onChange={(event) => onChange(event.target.value)}
              />
            );
          }
        }
      }}
    </FormField>
  );
}

/**
 * The questions alone — no `<form>`, title or button — so a host that already is a form (a booking
 * asking its business's own questions) renders the same fields the hosted form does, rather than a
 * second renderer of its own. `FormRenderer` is this plus the title, the confirmation and a submit.
 */
export function FormFields({
  definition,
  idPrefix,
  values,
  errors = {},
  disabled,
  onChange,
  onSelectField,
  selectedFieldId,
}: {
  definition: FormDefinition;
  idPrefix: string;
  values: FormValues;
  errors?: FormErrors;
  disabled?: boolean;
  onChange: (fieldId: string, value: string | boolean | string[]) => void;
  onSelectField?: (fieldId: string) => void;
  selectedFieldId?: string;
}) {
  return (
    <>
      {definition.fields.length === 0 ? <Hint>This form has no questions yet.</Hint> : null}
      {definition.fields.map((field) => <div key={field.id}
        onFocusCapture={onSelectField ? () => onSelectField(field.id) : undefined}
        onClick={onSelectField ? () => onSelectField(field.id) : undefined}
        className={onSelectField ? cx('rounded-md p-2 ring-1 ring-transparent hover:ring-border', selectedFieldId === field.id && 'ring-foreground') : undefined}
      >
        <RenderedField
          key={field.id}
          field={field}
          id={`${idPrefix}-${field.id}`}
          value={values[field.id]}
          error={errors[field.id]}
          disabled={disabled}
          onChange={(value) => onChange(field.id, value)}
        />
      </div>)}
    </>
  );
}

export function FormRenderer({
  definition,
  values,
  errors = {},
  disabled,
  onChange,
  onSubmit,
  footer,
  submitDisabled,
  showTitle = true,
  className,
  onSelectField,
  selectedFieldId,
}: {
  definition: FormDefinition;
  values: FormValues;
  errors?: FormErrors;
  disabled?: boolean;
  onChange: (fieldId: string, value: string | boolean | string[]) => void;
  /** Absent in a preview: the button is shown and does nothing. */
  onSubmit?: () => void;
  /** Form-level feedback and anything a host adds beneath the questions, such as a failure message. */
  footer?: ReactNode;
  submitDisabled?: boolean;
  /** A page that already has a heading for the form (a website section) draws the form without its own. */
  showTitle?: boolean;
  className?: string;
  onSelectField?: (fieldId: string) => void;
  selectedFieldId?: string;
}) {
  const prefix = useId();
  return (
    <form
      noValidate
      className={cx('flex flex-col gap-5', className)}
      aria-labelledby={`${prefix}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      <div>
        <h2 id={`${prefix}-title`} className={showTitle ? 'text-xl font-semibold tracking-tight' : 'sr-only'}>{definition.title}</h2>
        {definition.description ? <p className="mt-1 text-sm text-muted">{definition.description}</p> : null}
      </div>

      <FormFields definition={definition} idPrefix={prefix} values={values} errors={errors} disabled={disabled} onChange={onChange} onSelectField={onSelectField} selectedFieldId={selectedFieldId} />
      {footer}
      <div>
        <Button type="submit" disabled={disabled || submitDisabled}>{definition.submitLabel}</Button>
      </div>
    </form>
  );
}
