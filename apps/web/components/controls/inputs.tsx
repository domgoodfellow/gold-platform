import type { ComponentProps } from 'react';
import { Input } from '@gold/ui/components/input';
import { Label } from '@gold/ui/components/label';
import { Textarea } from '@gold/ui/components/textarea';
import { cx } from '../class-names';

/** Shadows the native `size` attribute (visible width in characters), unused here and repurposed. A choice is `SelectField` (select-field.tsx). */
export type ControlSize = 'default' | 'small';

export function TextInput({
  size = 'default',
  variant = 'default',
  className,
  ...props
}: Omit<ComponentProps<'input'>, 'size'> & { size?: ControlSize; variant?: 'default' | 'filled' }) {
  return <Input {...props} variant={variant} className={cx(size === 'small' && 'h-7 px-2 text-sm', className)} />;
}

export function TextArea({
  size = 'default',
  className,
  ...props
}: ComponentProps<'textarea'> & { size?: ControlSize }) {
  return <Textarea {...props} className={cx(size === 'small' && 'min-h-16 px-2 py-1 text-sm', className)} />;
}

/** Names the input; `Hint` explains it. */
export function FieldLabel({ className, ...props }: ComponentProps<'label'>) {
  return <Label {...props} className={className} />;
}

export function Hint({
  weight = 'muted',
  className,
  ...props
}: ComponentProps<'p'> & { weight?: 'muted' | 'subtle' }) {
  return (
    <p {...props} className={cx('text-sm', weight === 'muted' ? 'text-muted' : 'text-subtle', className)} />
  );
}

/** Renders nothing when there's nothing to say, so callers don't need their own ternary. */
export function ErrorText({
  children,
  className,
  ...props
}: ComponentProps<'p'>) {
  if (!children) return null;
  return (
    <p {...props} className={cx('text-sm text-danger', className)}>
      {children}
    </p>
  );
}
