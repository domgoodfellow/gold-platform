'use client';

import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { formatPhoneForDisplay } from '@/lib/display/phone';
import { TextInput } from './inputs';

/** Show the readable number at rest; edit and submit the original value. */
export function PhoneInput({
  value, defaultValue = '', name, onChange, onFocus, onBlur, pattern, disabled, ...props
}: Omit<ComponentProps<typeof TextInput>, 'value' | 'defaultValue' | 'ref'> & {
  value?: string;
  defaultValue?: string;
}) {
  const [draft, setDraft] = useState(defaultValue);
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const raw = value ?? draft;
  const display = formatPhoneForDisplay(raw);
  const displayPattern = !pattern || display === raw ? pattern
    : new RegExp(`^(?:${pattern})$`).test(raw) ? '\\([0-9]{3}\\)[0-9]{3}-[0-9]{4}' : '(?!)';

  useEffect(() => {
    if (value !== undefined) return;
    const form = input.current?.form;
    const reset = () => setDraft(defaultValue);
    form?.addEventListener('reset', reset);
    return () => form?.removeEventListener('reset', reset);
  }, [value, defaultValue]);

  return <>
    {name ? <input type="hidden" name={name} value={raw} disabled={disabled} form={props.form} /> : null}
    <TextInput
      {...props}
      ref={input}
      type="tel"
      disabled={disabled}
      value={focused ? raw : display}
      pattern={focused ? pattern : displayPattern}
      onFocus={(event) => { setFocused(true); onFocus?.(event); }}
      onBlur={(event) => { setFocused(false); onBlur?.(event); }}
      onChange={(event) => { setDraft(event.target.value); onChange?.(event); }}
    />
  </>;
}
