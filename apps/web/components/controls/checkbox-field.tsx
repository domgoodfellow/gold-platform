import type { ReactNode } from 'react';
import { Checkbox } from '@gold/ui/components/checkbox';
import { cx } from '../class-names';
import { FieldLabel } from './inputs';

/**
 * One accessible checkbox: a real `<label for>`, not a hand-rolled `<label><input/>text</label>`.
 * The source-owned `Checkbox` is a Radix button, not a native input, so its click-through depends
 * on `FieldLabel`'s `htmlFor` pointing at its `id` — a button is a labelable element, so this
 * still gets the same click-anywhere-on-the-text behavior a native checkbox had.
 */
export function CheckboxField({
  id,
  name,
  label,
  defaultChecked,
  disabled,
  className,
}: {
  id: string;
  name: string;
  label: ReactNode;
  defaultChecked?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cx('flex items-center gap-2', className)}>
      <Checkbox id={id} name={name} defaultChecked={defaultChecked} disabled={disabled} />
      <FieldLabel htmlFor={id} className="font-normal">
        {label}
      </FieldLabel>
    </div>
  );
}
