'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type FocusEvent } from 'react';
import { Combobox, ComboboxInput, type ComboboxOption } from '@gold/ui/components/combobox';
import { returnFocusAfterPointer } from '@gold/ui/components/focus-return';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@gold/ui/components/select';
import { cx } from '../class-names';
import type { ControlSize } from './inputs';

/** One choice: the domain value that is submitted, and the words a person reads. */
export type SelectOption = ComboboxOption;

/** Radix reserves the empty string for "nothing chosen", so a real "None"/"Any" choice travels under this key inside the control only. */
const EMPTY = '\u0000none';
/** Above this many options the field is searchable. */
export const SEARCHABLE_FROM = 12;

const SMALL = 'h-7 pl-2 pr-1.5 text-sm';

export type SelectFieldProps = {
  options: readonly SelectOption[];
  /** Submitted with the form under this name, exactly as a native field would be. */
  name?: string;
  form?: string;
  id?: string;
  /** Controlled value; pair with `onValueChange`. */
  value?: string;
  /** Uncontrolled starting value. Without one (or with one that is not an option) the first enabled option is chosen, as a native select would, unless `placeholder` is given. */
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Submit the field's form as soon as a choice is made (a one-control form such as a stage picker). */
  submitOnChange?: boolean;
  /** Shown while nothing is chosen. Giving one means "start with nothing chosen". */
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  /** Search the options; defaults to on above `SEARCHABLE_FROM` options. */
  searchable?: boolean;
  size?: ControlSize;
  className?: string;
  title?: string;
  autoFocus?: boolean;
  onBlur?: (event: FocusEvent<HTMLButtonElement>) => void;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-busy'?: boolean;
};

function startingValue(options: readonly SelectOption[], value: string | undefined, placeholder: string | undefined) {
  if (value !== undefined && options.some(option => option.value === value)) return value;
  if (placeholder !== undefined) return value ?? '';
  return options.find(option => !option.disabled)?.value ?? '';
}

/**
 * The one single-value choice for forms and filters. A short list is a styled Select; a long one (or
 * `searchable`) is a searchable Combobox — the same trigger either way. It belongs to its form like a
 * native field: a hidden text input carries `name`, `form`, `required` and the current value, so
 * FormData, server actions, constraint validation and `form.reset()` behave as before, and choosing
 * an option raises one `change` event inside the form for listeners there (dirty tracking, filter
 * forms that submit on change). Handlers receive the value, never an event.
 */
export function SelectField({
  options, name, form, id, value, defaultValue, onValueChange, submitOnChange, placeholder, required, disabled, searchable,
  size = 'default', className, ...trigger
}: SelectFieldProps) {
  const controlled = value !== undefined;
  const [initial] = useState(() => startingValue(options, controlled ? value : defaultValue, placeholder));
  const [own, setOwn] = useState(initial);
  const current = controlled ? value : own;
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const resetting = useRef(false);

  // The hidden input is the form's copy of the value; it is uncontrolled so React never rewinds it.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (input && input.value !== current) input.value = current;
  }, [current]);

  useEffect(() => {
    const owner = inputRef.current?.form;
    if (!owner) return;
    // form.reset() (React runs one after every completed form action) restores the input's default,
    // and the visible choice follows it. Radix Select also answers a reset by reporting its first
    // value as a change; that is not a choice — reported, it would resubmit a submit-on-change form
    // with the old value — so reports are ignored until the reset is over. Capture runs first.
    const reset = () => {
      resetting.current = true;
      window.setTimeout(() => {
        resetting.current = false;
        if (!controlled) setOwn(inputRef.current?.value ?? initial);
      });
    };
    owner.addEventListener('reset', reset, true);
    return () => owner.removeEventListener('reset', reset, true);
  }, [controlled, initial]);

  const search = searchable ?? options.length > SEARCHABLE_FROM;

  const choose = useCallback((next: string) => {
    const input = inputRef.current;
    if (!controlled) setOwn(next);
    if (input && input.value !== next) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, next);
      // Radix Select already raises `change` from its own hidden select inside a form; the
      // searchable list has no such element, so it announces the change from the form's copy.
      if (search) {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    onValueChange?.(next);
    if (submitOnChange && input?.value === next) input.form?.requestSubmit();
  }, [controlled, onValueChange, search, submitOnChange]);
  const label = trigger['aria-label'];
  const formCopy = (
    <input
      ref={inputRef}
      type="text"
      tabIndex={-1}
      aria-hidden
      autoComplete="off"
      data-slot="select-field-value"
      name={name}
      form={form}
      required={required}
      disabled={disabled}
      defaultValue={initial}
      // The browser focuses an invalid required field to explain it; send that to the visible trigger.
      onFocus={() => triggerRef.current?.focus()}
      className="pointer-events-none absolute bottom-0 left-1/2 h-px w-px -translate-x-1/2 opacity-0"
    />
  );

  if (search) {
    return (
      <span data-slot="select-field" className={cx('relative inline-flex min-w-48 max-w-full', className)}>
        <Combobox
          ref={triggerRef}
          id={id}
          options={options}
          value={current}
          onValueChange={choose}
          placeholder={placeholder ?? 'Select…'}
          searchLabel={label}
          disabled={disabled}
          aria-required={required || undefined}
          className={cx(size === 'small' && SMALL)}
          {...trigger}
        />
        {formCopy}
      </span>
    );
  }

  const hasEmpty = options.some(option => option.value === '');
  const groups: { group?: string; options: SelectOption[] }[] = [];
  for (const option of options) {
    const existing = groups.find(entry => entry.group === option.group);
    if (existing) existing.options.push(option);
    else groups.push({ group: option.group, options: [option] });
  }
  const item = (option: SelectOption) => (
    <SelectItem key={option.value} value={option.value === '' ? EMPTY : option.value} data-value={option.value} disabled={option.disabled} description={option.description}>
      {option.label}
    </SelectItem>
  );

  return (
    <span data-slot="select-field" className={cx('relative inline-flex max-w-full', className)}>
      <Select
        value={current === '' ? (hasEmpty ? EMPTY : '') : current}
        // Radix never gives an item the empty string, so '' here is its hidden native select failing to
        // match a value whose option arrives in the same update — not a choice. Ignoring it keeps the value.
        onValueChange={next => { if (next !== '' && !resetting.current) choose(next === EMPTY ? '' : next); }}
        disabled={disabled}
        form={form}
      >
        <SelectTrigger ref={triggerRef} id={id} aria-required={required || undefined} className={cx(size === 'small' && SMALL)} {...trigger}>
          {/* Sized to the longest choice, as a native select is, so the box does not jump as the choice changes. */}
          <span className="grid grid-cols-[minmax(0,max-content)]">
            <span className="col-start-1 row-start-1 truncate"><SelectValue placeholder={placeholder ?? ''} /></span>
            {options.map(option => <span key={option.value} aria-hidden className="invisible col-start-1 row-start-1 h-0 overflow-hidden whitespace-nowrap">{option.label}</span>)}
          </span>
        </SelectTrigger>
        <SelectContent onCloseAutoFocus={event => returnFocusAfterPointer(event, triggerRef.current)}>
          {groups.map(({ group, options: members }) => group
            ? <SelectGroup key={group}><SelectLabel>{group}</SelectLabel>{members.map(item)}</SelectGroup>
            : members.map(item))}
        </SelectContent>
      </Select>
      {formCopy}
    </span>
  );
}

/**
 * A free-text field that suggests values — the replacement for `<input list>` with a `<datalist>`.
 * Text that matches no suggestion is kept exactly as typed.
 */
export function SuggestionField({ size = 'default', className, ...props }: Omit<ComponentProps<typeof ComboboxInput>, 'size'> & { size?: ControlSize }) {
  return <ComboboxInput {...props} className={cx(size === 'small' && 'h-7 px-2 text-sm', className)} />;
}
